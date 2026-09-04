import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSidechainChiAnglesReproduced, COUPLED_SIDECHAIN_POSE_SELECTION_CRITERION,
  evaluatePostRelaxedBranchObjective, measureInspectedSidechainChiAngles,
  selectCoupledSidechainPoseBranch,
  uniqueSidechainRotamerCandidates } from '../docking/sidechain-rotamers.mjs';
import { MOLARIUM_CONSTRAINT_DOCK_PROTOCOL } from '../docking/protocol.mjs';
import { AUDIT_STATE_HASH_GUARDS, actionScriptFromAudit } from '../design-history/replay.mjs';
import { MOLECULAR_STATE_HASH_SCHEMA } from '../molecular-state-hash.mjs';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
};
const requestedStop = valueFor('--stop-after');
const diagnosticPhe890CoordinateSha256 = valueFor(
  '--diagnostic-phe890-coordinate-sha256');
const relaxMethod = valueFor('--relax') || 'induced-fit-webgpu';
const branchCount = Number(valueFor('--rotamer-branches') || 32);
const branchSearchChains = Number(valueFor('--branch-search-chains') || 32);
const fixedSearchChains = Number(valueFor('--fixed-search-chains') || 64);
const poseExecution = valueFor('--pose-execution') || 'auto';
const allSteps = ['scaffold-rewrite', 'fragment-merge', 'open-phe890-pocket', 'finish-bay-293'];
const PHE890 = Object.freeze({ residueName:'PHE', chain:'A', residueIndex:890,
  insertionCode:'' });
const stopIndex = requestedStop ? allSteps.indexOf(requestedStop) : allSteps.length - 1;
if (stopIndex < 0) throw new Error(`Unknown --stop-after step: ${requestedStop}`);
if (!['none', 'pocket-webgpu', 'induced-fit-webgpu'].includes(relaxMethod))
  throw new Error(`Unsupported --relax method: ${relaxMethod}`);
if (!Number.isInteger(branchCount) || branchCount < 1 || branchCount > 32)
  throw new Error('--rotamer-branches must be an integer from 1 to 32');
if (![8,16,32,64].includes(branchSearchChains))
  throw new Error('--branch-search-chains must be 8, 16, 32, or 64');
if (![8,16,32,64].includes(fixedSearchChains))
  throw new Error('--fixed-search-chains must be 8, 16, 32, or 64');
if (!['auto','serial'].includes(poseExecution))
  throw new Error('--pose-execution must be auto or serial');
if (diagnosticPhe890CoordinateSha256 != null
  && !/^[a-f0-9]{64}$/.test(diagnosticPhe890CoordinateSha256))
  throw new Error('--diagnostic-phe890-coordinate-sha256 must be a lowercase SHA-256 digest');
if (diagnosticPhe890CoordinateSha256 != null
  && requestedStop !== 'open-phe890-pocket')
  throw new Error('A diagnostic Phe890 branch is non-promotable and requires --stop-after open-phe890-pocket');
if (diagnosticPhe890CoordinateSha256 != null && valueFor('--output') == null)
  throw new Error('A diagnostic Phe890 branch requires an explicit --output directory');
const stepIds = allSteps.slice(0, stopIndex + 1);
const output = resolve(root, valueFor('--output')
  || 'outputs/design-history/sos1-hit-only-prospective');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const coordinateDigest = (inspection) => digest(Buffer.from(JSON.stringify(
  inspection.result.atoms.map((atom) => [atom.atomId, atom.coordinatesAngstrom]))));
await mkdir(output, { recursive:true });

const browser = await startMolariumBrowser({ root, appPath:'?prospective=sos1-hit-only',
  width:1600, height:1000 });
const execute = (action, actionArgs = {}, requestId = action) => browser.evaluate(
  `window.MolariumChemistActions.execute(${JSON.stringify({
    action, args:actionArgs, requestId,
  })})`);
const checkpoints = [];

function requirePublicationStateHashes(response, action, label) {
  const guard = AUDIT_STATE_HASH_GUARDS[action];
  if (!guard) throw new Error(`${label}: ${action} is not a state-guarded action`);
  const result = response?.result?.[guard.resultKey];
  if (result?.stateHashSchema !== MOLECULAR_STATE_HASH_SCHEMA)
    throw new Error(`${label}: ${action} did not return ${MOLECULAR_STATE_HASH_SCHEMA}`);
  for (const resultKey of Object.keys(guard.fields)) {
    if (typeof result[resultKey] !== 'string' || !/^[a-f0-9]{64}$/.test(result[resultKey]))
      throw new Error(`${label}: ${action} did not return a valid ${resultKey}`);
  }
  return response;
}

async function executeGuarded(action, actionArgs, requestId) {
  return requirePublicationStateHashes(await execute(action, actionArgs, requestId),
    action, requestId);
}

function requireCompleteSeedCoverage(response, label) {
  const refinement = response?.result?.refinement;
  if (!refinement?.coverageComplete
    || refinement.coverage?.allRequiredStrataCovered !== true)
    throw new Error(`${label} did not cover every required pose-seed stratum`);
  return response;
}

async function inspectPhe890(stepId) {
  const pocket = await execute('session.inspect', {
    scope:'pocket', includeCoordinates:false, maximumAtoms:500,
  }, `${stepId}-locate-phe890`);
  const atoms = pocket.result.atoms.filter((atom) => atom.residueName === 'PHE'
    && Number(atom.residueIndex) === 890 && atom.chain === 'A');
  if (!atoms.length) throw new Error('Phe890 is absent from the captured receptor site');
  return atoms.find((atom) => atom.atomName === 'CG') || atoms.find((atom) => atom.atomName === 'CB')
    || atoms[0];
}

async function enumeratePhe890(stepId, ordinal = 'initial') {
  const pheAtom = await inspectPhe890(stepId);
  const response = await execute('pose.enumerateSidechainRotamers', {
    receptorAtomId:pheAtom.atomId, maximumCandidates:32,
  }, `${stepId}-enumerate-phe890-${ordinal}`);
  return response.result.sidechainRotamers;
}

async function choosePhe890Branch(stepId, { referenceLigand, hardAtomNames,
  changedLigandAtomIds } = {}) {
  let ensemble = await enumeratePhe890(stepId);
  const availableCandidates = uniqueSidechainRotamerCandidates(ensemble.candidates,
    { maximum:diagnosticPhe890CoordinateSha256 == null ? branchCount : 32 });
  const candidates = diagnosticPhe890CoordinateSha256 == null ? availableCandidates
    : availableCandidates.filter((candidate) =>
      candidate.coordinateSha256 === diagnosticPhe890CoordinateSha256);
  if (diagnosticPhe890CoordinateSha256 != null && candidates.length !== 1)
    throw new Error('The diagnostic Phe890 coordinate SHA-256 does not identify exactly one current candidate');
  if (!candidates.length) throw new Error('Phe890 enumeration returned no candidates');
  const branches = [];
  for (let ordinal = 0; ordinal < candidates.length; ordinal++) {
    const candidate = candidates[ordinal];
    console.log(`${stepId}: jointly posing against Phe890 rotamer rank ${candidate.rank} `
      + `(${candidate.chiDegrees.map((value) => value.toFixed(0)).join(', ')} deg)`);
    const applied = await execute('pose.applySidechainRotamer', {
      coordinateSha256:candidate.coordinateSha256,
      expectedInputCoordinateSha256:ensemble.inputCoordinateSha256,
      expectedSelectedCoordinateSha256:candidate.coordinateSha256,
    }, `${stepId}-apply-phe890-branch-${candidate.rank}`);
    const receptorReference = await execute('pose.updateReceptorReference', {},
      `${stepId}-accept-receptor-branch-${candidate.rank}`);
    const refined = requireCompleteSeedCoverage(await executeGuarded('pose.refine', {
      searchChains:branchSearchChains,
      execution:poseExecution, featureSeedingProtocol:'v5' },
    `${stepId}-pose-branch-${candidate.rank}`), `${stepId} branch ${candidate.rank}`);
    const selectedPoseIndex = Math.max(0,
      Number(refined.result.refinement.selectedRank || 1) - 1);
    await executeGuarded('pose.apply', { index:selectedPoseIndex,
      ...(refined.result.refinement.selectedFeasible ? {} : { allowInfeasible:true }) },
      `${stepId}-apply-pose-branch-${candidate.rank}`);
    const parameterized = await execute('protein.parameterize', {},
      `${stepId}-parameterize-branch-${candidate.rank}`);
    const relaxed = await executeGuarded('optimization.run', {
      method:'induced-fit-webgpu',
    }, `${stepId}-relax-phe890-branch-${candidate.rank}`);
    const ligand = await execute('session.inspect', {
      scope:'ligand', includeCoordinates:true, maximumAtoms:256,
    }, `${stepId}-inspect-ligand-branch-${candidate.rank}`);
    const pocket = await execute('session.inspect', {
      scope:'pocket', includeCoordinates:true, maximumAtoms:500,
    }, `${stepId}-inspect-pocket-branch-${candidate.rank}`);
    const branchObjective = evaluatePostRelaxedBranchObjective({
      referenceLigand, ligand:ligand.result, pocket:pocket.result,
      hardAtomNames, changedLigandAtomIds,
      coreToleranceAngstrom:MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.coreConstraint.toleranceAngstrom,
    });
    const receptorAware = branchObjective.receptorAware;
    const relaxedChiDegrees = measureInspectedSidechainChiAngles({
      atoms:pocket.result.atoms, residue:PHE890,
    });
    branches.push({
      candidateIndex:candidate.index, candidateRank:candidate.rank,
      source:candidate.source, chiDegrees:candidate.chiDegrees,
      seedChiDegrees:candidate.chiDegrees, relaxedChiDegrees,
      prerankScore:candidate.score, prerankStericPenalty:candidate.stericPenalty,
      prerankLigandStericPenalty:candidate.ligandStericPenalty,
      prerankSevereClashes:candidate.severeClashes,
      selectedCoordinateSha256:applied.result.sidechainRotamer.selectedCoordinateSha256,
      receptorReference:receptorReference.result.receptorReference,
      refinement:refined.result.refinement,
      parameterization:parameterized.result.parameterization,
      relaxedLigandCoordinateSha256:coordinateDigest(ligand),
      relaxedPocketCoordinateSha256:coordinateDigest(pocket),
      postRelaxation:{
        receptorAware, branchObjective,
        topPoseEvidence:{
          schema:'molarium.coordinate-evidence/v1',
          ligand:ligand.result,
          pocket:pocket.result,
          ligandCoordinateSha256:coordinateDigest(ligand),
          pocketCoordinateSha256:coordinateDigest(pocket),
        },
      },
      optimization:relaxed.result.optimization,
    });
    if (diagnosticPhe890CoordinateSha256 != null) {
      const selected = branches[0];
      return {
        schema:'molarium.sidechain-branch-decision/v1', residue:'PHE A890',
        coordinateInputClass:'registered-hit-only', branchCount:1,
        publicationEligible:false, diagnosticOnly:true,
        deterministicFinalReplayVerified:false,
        diagnosticReason:'single exact-coordinate branch proxy; branch competition was not rerun',
        enumeration:{ inputCoordinateSha256:ensemble.inputCoordinateSha256,
          inputChiDegrees:ensemble.inputChiDegrees,
          generatedCandidateCount:ensemble.generatedCandidateCount,
          retainedCandidateCount:ensemble.candidates.length,
          branchSampling:'one exact coordinate-SHA-selected candidate from the complete current enumeration' },
        branches,
        selected:{ candidateIndex:selected.candidateIndex,
          candidateRank:selected.candidateRank, source:selected.source,
          chiDegrees:selected.chiDegrees, seedChiDegrees:selected.seedChiDegrees,
          relaxedChiDegrees:selected.relaxedChiDegrees,
          selectedCoordinateSha256:selected.selectedCoordinateSha256,
          criterion:'diagnostic exact candidate coordinate SHA; non-promotable',
          receptorReference:selected.receptorReference,
          refinement:selected.refinement, parameterization:selected.parameterization,
          postRelaxation:selected.postRelaxation, optimization:selected.optimization },
      };
    }
    await execute('history.undo', {}, `${stepId}-undo-branch-${candidate.rank}-relaxation`);
    await execute('history.undo', {}, `${stepId}-undo-branch-${candidate.rank}-pose`);
    await execute('history.undo', {}, `${stepId}-undo-branch-${candidate.rank}-rotamer`);
    await execute('view.setMode', { mode:'build' }, `${stepId}-return-build-${candidate.rank}`);
    if (ordinal < candidates.length - 1) ensemble = await enumeratePhe890(stepId, `branch-${ordinal + 2}`);
  }
  const selected = selectCoupledSidechainPoseBranch(branches);
  ensemble = await enumeratePhe890(stepId, 'final');
  const finalCandidate = ensemble.candidates.find((candidate) =>
    candidate.rank === selected.candidateRank
    && candidate.coordinateSha256 === selected.selectedCoordinateSha256);
  if (!finalCandidate) throw new Error('The selected Phe890 branch changed during deterministic replay');
  const applied = await execute('pose.applySidechainRotamer', {
    coordinateSha256:finalCandidate.coordinateSha256,
    expectedInputCoordinateSha256:ensemble.inputCoordinateSha256,
    expectedSelectedCoordinateSha256:finalCandidate.coordinateSha256,
  }, `${stepId}-apply-selected-phe890-branch`);
  const receptorReference = await execute('pose.updateReceptorReference', {},
    `${stepId}-accept-selected-receptor-branch`);
  const refinement = requireCompleteSeedCoverage(await executeGuarded('pose.refine', {
    searchChains:branchSearchChains,
    execution:poseExecution, featureSeedingProtocol:'v5' },
  `${stepId}-pose-selected-phe890-branch`), `${stepId} selected branch`);
  const selectedPoseIndex = Math.max(0,
    Number(refinement.result.refinement.selectedRank || 1) - 1);
  await executeGuarded('pose.apply', { index:selectedPoseIndex },
    `${stepId}-apply-selected-phe890-pose`);
  const parameterization = await execute('protein.parameterize', {},
    `${stepId}-parameterize-selected-phe890-branch`);
  const relaxation = await executeGuarded('optimization.run', {
    method:'induced-fit-webgpu',
  }, `${stepId}-relax-selected-phe890-branch`);
  const ligand = await execute('session.inspect', {
    scope:'ligand', includeCoordinates:true, maximumAtoms:256,
  }, `${stepId}-inspect-selected-ligand`);
  const pocket = await execute('session.inspect', {
    scope:'pocket', includeCoordinates:true, maximumAtoms:500,
  }, `${stepId}-inspect-selected-pocket`);
  const ligandCoordinateSha256 = coordinateDigest(ligand);
  const pocketCoordinateSha256 = coordinateDigest(pocket);
  const relaxedChiDegrees = measureInspectedSidechainChiAngles({
    atoms:pocket.result.atoms, residue:PHE890,
  });
  if (ligandCoordinateSha256 !== selected.relaxedLigandCoordinateSha256
    || pocketCoordinateSha256 !== selected.relaxedPocketCoordinateSha256)
    throw new Error('The selected post-relaxation branch changed during deterministic replay');
  assertSidechainChiAnglesReproduced(selected.relaxedChiDegrees, relaxedChiDegrees);
  const branchObjective = evaluatePostRelaxedBranchObjective({
    referenceLigand, ligand:ligand.result, pocket:pocket.result,
    hardAtomNames, changedLigandAtomIds,
    coreToleranceAngstrom:MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.coreConstraint.toleranceAngstrom,
  });
  const postRelaxation = {
    receptorAware:branchObjective.receptorAware, branchObjective,
    topPoseEvidence:{
      schema:'molarium.coordinate-evidence/v1',
      ligand:ligand.result,
      pocket:pocket.result,
      ligandCoordinateSha256,
      pocketCoordinateSha256,
    },
  };
  return {
    schema:'molarium.sidechain-branch-decision/v1', residue:'PHE A890',
    coordinateInputClass:'registered-hit-only', branchCount:branches.length,
    publicationEligible:true, diagnosticOnly:false,
    deterministicFinalReplayVerified:true,
    enumeration:{ inputCoordinateSha256:ensemble.inputCoordinateSha256,
      inputChiDegrees:ensemble.inputChiDegrees,
      generatedCandidateCount:ensemble.generatedCandidateCount,
      retainedCandidateCount:ensemble.candidates.length,
      branchSampling:'every unique complete chi-angle vector in ranked order, subject only to the explicit branch cap' },
    branches, selected:{ candidateIndex:finalCandidate.index,
      candidateRank:finalCandidate.rank, source:finalCandidate.source,
      chiDegrees:finalCandidate.chiDegrees,
      seedChiDegrees:finalCandidate.chiDegrees, relaxedChiDegrees,
      selectedCoordinateSha256:applied.result.sidechainRotamer.selectedCoordinateSha256,
      criterion:COUPLED_SIDECHAIN_POSE_SELECTION_CRITERION,
      receptorReference:receptorReference.result.receptorReference,
      refinement:refinement.result.refinement,
      parameterization:parameterization.result.parameterization,
      postRelaxation,
      optimization:relaxation.result.optimization },
  };
}

try {
  await waitFor(async () => browser.evaluate(
    `window.MolariumChemistActions?.schema==='molarium.chemist-actions/v1'`),
  90000, 'public Chemist Actions API');
  const description = await browser.evaluate(`window.MolariumChemistActions.describe()`);
  for (const action of ['designRoute.load', 'designRoute.applyStep',
    'designRoute.inspect', 'protein.prepare', 'pose.captureReference',
    'pose.updateReceptorReference', 'pose.refine',
    'pose.apply', 'pose.enumerateSidechainRotamers', 'pose.applySidechainRotamer',
    'protein.parameterize', 'optimization.run', 'history.undo', 'session.inspect']) {
    if (!description.actions[action]) throw new Error(`Public action is missing: ${action}`);
  }

  await execute('designRoute.load', { routeId:'sos1-hit-only' }, 'route-load-hit');
  await execute('view.setMode', { mode:'build' }, 'route-enter-build');
  console.log('route: preparing the registered 5OVE/AXE hit complex');
  await execute('protein.prepare', {
    pH:7.4, histidine:'auto', repairMissingHeavy:true,
    ligandPolicy:'ccd', waterPolicy:'retain', gapPolicy:'cap',
  }, 'route-prepare-hit');
  await execute('pose.captureReference', { mode:'propagate' }, 'route-capture-hit');
  const boundary = await execute('designRoute.inspect', {}, 'route-inspect-boundary');
  let previousFrozenLigand = null;

  for (let stepIndex = 0; stepIndex < stepIds.length; stepIndex++) {
    const stepId = stepIds[stepIndex];
    console.log(`${stepId}: staging the reported graph against the preceding prediction`);
    const staged = await execute('designRoute.applyStep', { stepId }, `${stepId}-stage`);
    let rotamerDecision = null;
    let refinement, parameterization;
    let relaxation = { method:'none',
      interpretation:'Pose search only; receptor and selected pose were left unchanged.' };
    if (stepId === 'open-phe890-pocket') {
      console.log(`${stepId}: ranking coupled Phe890 and ligand-pose branches`);
      rotamerDecision = await choosePhe890Branch(stepId, {
        referenceLigand:previousFrozenLigand,
        hardAtomNames:staged.result.designStep.poseTransferPlan.hardConstraintAtomNames,
        changedLigandAtomIds:staged.result.designStep.addedHeavyAtomIds,
      });
      refinement = rotamerDecision.selected.refinement;
      parameterization = rotamerDecision.selected.parameterization;
      relaxation = rotamerDecision.selected.optimization;
    } else {
      console.log(`${stepId}: fixed-receptor pose search`);
      const refined = requireCompleteSeedCoverage(await executeGuarded('pose.refine', {
        searchChains:fixedSearchChains,
        execution:poseExecution, featureSeedingProtocol:'v5' },
      `${stepId}-pose-refine`), stepId);
      const selectedIndex = Math.max(0,
        Number(refined.result.refinement.selectedRank || 1) - 1);
      await executeGuarded('pose.apply', { index:selectedIndex }, `${stepId}-pose-apply`);
      const parameterized = await execute('protein.parameterize', {},
        `${stepId}-parameterize-without-motion`);
      refinement = refined.result.refinement;
      parameterization = parameterized.result.parameterization;
      if (relaxMethod !== 'none') {
        console.log(`${stepId}: ${relaxMethod} relaxation`);
        const relaxed = await executeGuarded('optimization.run',
          { method:relaxMethod }, `${stepId}-complex-relax`);
        relaxation = relaxed.result.optimization;
      }
    }
    const ligand = await execute('session.inspect', {
      scope:'ligand', includeCoordinates:true, maximumAtoms:256,
    }, `${stepId}-freeze-ligand`);
    const pocket = await execute('session.inspect', {
      scope:'pocket', includeCoordinates:true, maximumAtoms:500,
    }, `${stepId}-freeze-pocket`);
    const current = await execute('designRoute.inspect', {}, `${stepId}-inspect-state`);
    const checkpoint = {
      schema:'molarium.design-prediction-checkpoint/v1',
      routeId:'sos1-hit-only', stepId,
      referenceStateId:staged.result.designStep.referenceStateId,
      predictedStateId:staged.result.designStep.stateId,
      frozenBeforeHoldoutAccess:true,
      boundary:boundary.result.designRoute,
      state:current.result.designRoute,
      staging:staged.result.designStep,
      refinement, parameterization,
      rotamerDecision, relaxation,
      ligand:ligand.result, pocket:pocket.result,
    };
    const bytes = Buffer.from(`${JSON.stringify(checkpoint, null, 2)}\n`);
    const filename = `${stepId}-prediction.json`;
    await writeFile(join(output, filename), bytes);
    checkpoints.push({ stepId, predictedStateId:checkpoint.predictedStateId,
      filename, sha256:digest(bytes), bytes:bytes.length,
      ligandCoordinateSha256:coordinateDigest(ligand),
      pocketCoordinateSha256:coordinateDigest(pocket),
      freezeActionSequence:pocket.sequence });
    previousFrozenLigand = structuredClone(ligand.result);
    console.log(`${stepId}: frozen ${digest(bytes).slice(0, 12)}`);

    if (stepIndex < stepIds.length - 1) {
      await execute('view.setMode', { mode:'build' }, `${stepId}-advance-build`);
      await execute('pose.captureReference', { mode:'propagate' },
        `${stepId}-capture-predicted-reference`);
    }
  }

  const audit = await browser.evaluate(`window.MolariumChemistActions.history()`);
  const auditEnvelope = { schema:description.schema, routeId:'sos1-hit-only', records:audit };
  const guardProbe = actionScriptFromAudit(auditEnvelope, { stateHashGuards:'required' });
  const auditBytes = Buffer.from(`${JSON.stringify(auditEnvelope, null, 2)}\n`);
  await writeFile(join(output, 'chemist-action-audit.json'), auditBytes);
  const campaignPath = join(root,
    'design-history/structures/generated/sos1-prospective-campaign.json');
  const runnerPath = fileURLToPath(import.meta.url);
  const manifest = {
    schema:'molarium.design-prediction-run/v1',
    routeId:'sos1-hit-only',
    status:diagnosticPhe890CoordinateSha256 == null
      ? 'predictions-frozen-holdouts-unopened' : 'diagnostic-non-promotable',
    publicationEligible:diagnosticPhe890CoordinateSha256 == null,
    protocol:{ initialCoordinateInput:'PDB 5OVE/AXE only',
      sequentialPredictedReferences:true, relaxMethod,
      fixedPoseSearchChains:fixedSearchChains,
      poseExecution,
      phe890Branching:{ stepId:'open-phe890-pocket', branchCount,
        sampling:'every unique complete chi-angle vector in ranked order, subject only to the explicit branch cap',
        branchPoseSearchChains:branchSearchChains,
        finalPoseSearchChains:branchSearchChains,
        featureSeedingProtocol:'v5',
        criterion:COUPLED_SIDECHAIN_POSE_SELECTION_CRITERION,
        diagnosticExactCoordinateSha256:diagnosticPhe890CoordinateSha256 || null,
        diagnosticOnly:diagnosticPhe890CoordinateSha256 != null } },
    checkpoints,
    agentApi:{ schema:description.schema, actions:Object.keys(description.actions),
      auditRecords:audit.length, auditSha256:digest(auditBytes),
      stateHashGuards:guardProbe.sourceAudit.stateHashGuards },
    inputs:{ campaign:{ path:relative(root, campaignPath),
      sha256:digest(await readFile(campaignPath)) },
      runner:{ path:relative(root, runnerPath), sha256:digest(await readFile(runnerPath)) } },
  };
  await writeFile(join(output, 'prediction-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${relative(root, join(output, 'prediction-manifest.json'))}`);
} finally {
  await browser.close();
}
