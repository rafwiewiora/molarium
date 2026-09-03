import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COUPLED_SIDECHAIN_POSE_SELECTION_CRITERION,
  selectCoupledSidechainPoseBranch } from '../docking/sidechain-rotamers.mjs';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
};
const requestedStop = valueFor('--stop-after');
const relaxMethod = valueFor('--relax') || 'induced-fit-webgpu';
const branchCount = Number(valueFor('--rotamer-branches') || 4);
const branchSearchChains = Number(valueFor('--branch-search-chains') || 32);
const allSteps = ['scaffold-rewrite', 'fragment-merge', 'open-phe890-pocket', 'finish-bay-293'];
const stopIndex = requestedStop ? allSteps.indexOf(requestedStop) : allSteps.length - 1;
if (stopIndex < 0) throw new Error(`Unknown --stop-after step: ${requestedStop}`);
if (!['none', 'pocket-webgpu', 'induced-fit-webgpu'].includes(relaxMethod))
  throw new Error(`Unsupported --relax method: ${relaxMethod}`);
if (!Number.isInteger(branchCount) || branchCount < 1 || branchCount > 8)
  throw new Error('--rotamer-branches must be an integer from 1 to 8');
if (![8,16,32,64].includes(branchSearchChains))
  throw new Error('--branch-search-chains must be 8, 16, 32, or 64');
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

function circularAngleDistance(first, second) {
  const delta = Math.abs(Number(first) - Number(second)) % 360;
  return Math.min(delta, 360 - delta);
}

function diversePhe890Candidates(candidates, maximum) {
  if (maximum < 3) return candidates.slice(0, maximum);
  const selected = [];
  for (const target of [-60, 60, 180]) {
    const best = candidates.reduce((current, candidate) => {
      const distance = circularAngleDistance(candidate.chiDegrees[0], target);
      if (!current || distance < current.distance
        || distance === current.distance && candidate.rank < current.candidate.rank)
        return { candidate, distance };
      return current;
    }, null)?.candidate;
    if (best && !selected.includes(best)) selected.push(best);
  }
  for (const candidate of candidates) {
    if (selected.length >= maximum) break;
    if (!selected.includes(candidate)) selected.push(candidate);
  }
  return selected.sort((left, right) => left.rank - right.rank);
}

async function choosePhe890Branch(stepId) {
  let ensemble = await enumeratePhe890(stepId);
  const candidates = diversePhe890Candidates(ensemble.candidates, branchCount);
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
    const refined = await execute('pose.refine', { searchChains:branchSearchChains,
      featureSeedingProtocol:'v3' },
      `${stepId}-pose-branch-${candidate.rank}`);
    const selectedPoseIndex = Math.max(0,
      Number(refined.result.refinement.selectedRank || 1) - 1);
    await execute('pose.apply', { index:selectedPoseIndex,
      ...(refined.result.refinement.selectedFeasible ? {} : { allowInfeasible:true }) },
      `${stepId}-apply-pose-branch-${candidate.rank}`);
    const parameterized = await execute('protein.parameterize', {},
      `${stepId}-parameterize-branch-${candidate.rank}`);
    const relaxed = await execute('optimization.run', {
      method:'induced-fit-webgpu',
    }, `${stepId}-relax-phe890-branch-${candidate.rank}`);
    const ligand = await execute('session.inspect', {
      scope:'ligand', includeCoordinates:true, maximumAtoms:256,
    }, `${stepId}-inspect-ligand-branch-${candidate.rank}`);
    const pocket = await execute('session.inspect', {
      scope:'pocket', includeCoordinates:true, maximumAtoms:500,
    }, `${stepId}-inspect-pocket-branch-${candidate.rank}`);
    branches.push({
      candidateIndex:candidate.index, candidateRank:candidate.rank,
      source:candidate.source, chiDegrees:candidate.chiDegrees,
      prerankScore:candidate.score, prerankStericPenalty:candidate.stericPenalty,
      prerankLigandStericPenalty:candidate.ligandStericPenalty,
      prerankSevereClashes:candidate.severeClashes,
      selectedCoordinateSha256:applied.result.sidechainRotamer.selectedCoordinateSha256,
      receptorReference:receptorReference.result.receptorReference,
      refinement:refined.result.refinement,
      parameterization:parameterized.result.parameterization,
      relaxedLigandCoordinateSha256:coordinateDigest(ligand),
      relaxedPocketCoordinateSha256:coordinateDigest(pocket),
      optimization:relaxed.result.optimization,
    });
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
  const refinement = await execute('pose.refine', { searchChains:64,
    featureSeedingProtocol:'v3' },
    `${stepId}-pose-selected-phe890-branch`);
  const selectedPoseIndex = Math.max(0,
    Number(refinement.result.refinement.selectedRank || 1) - 1);
  await execute('pose.apply', { index:selectedPoseIndex },
    `${stepId}-apply-selected-phe890-pose`);
  const parameterization = await execute('protein.parameterize', {},
    `${stepId}-parameterize-selected-phe890-branch`);
  const relaxation = await execute('optimization.run', {
    method:'induced-fit-webgpu',
  }, `${stepId}-relax-selected-phe890-branch`);
  return {
    schema:'molarium.sidechain-branch-decision/v1', residue:'PHE A890',
    coordinateInputClass:'registered-hit-only', branchCount:branches.length,
    enumeration:{ inputCoordinateSha256:ensemble.inputCoordinateSha256,
      inputChiDegrees:ensemble.inputChiDegrees,
      generatedCandidateCount:ensemble.generatedCandidateCount,
      retainedCandidateCount:ensemble.candidates.length,
      branchSampling:'best-ranked representative of each canonical chi1 basin, then global rank' },
    branches, selected:{ candidateIndex:finalCandidate.index,
      candidateRank:finalCandidate.rank, source:finalCandidate.source,
      chiDegrees:finalCandidate.chiDegrees,
      selectedCoordinateSha256:applied.result.sidechainRotamer.selectedCoordinateSha256,
      criterion:COUPLED_SIDECHAIN_POSE_SELECTION_CRITERION,
      receptorReference:receptorReference.result.receptorReference,
      refinement:refinement.result.refinement,
      parameterization:parameterization.result.parameterization,
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
      rotamerDecision = await choosePhe890Branch(stepId);
      refinement = rotamerDecision.selected.refinement;
      parameterization = rotamerDecision.selected.parameterization;
      relaxation = rotamerDecision.selected.optimization;
    } else {
      console.log(`${stepId}: fixed-receptor pose search`);
      const refined = await execute('pose.refine', { searchChains:64,
        featureSeedingProtocol:'v3' }, `${stepId}-pose-refine`);
      const selectedIndex = Math.max(0,
        Number(refined.result.refinement.selectedRank || 1) - 1);
      await execute('pose.apply', { index:selectedIndex }, `${stepId}-pose-apply`);
      const parameterized = await execute('protein.parameterize', {},
        `${stepId}-parameterize-without-motion`);
      refinement = refined.result.refinement;
      parameterization = parameterized.result.parameterization;
      if (relaxMethod !== 'none') {
        console.log(`${stepId}: ${relaxMethod} relaxation`);
        const relaxed = await execute('optimization.run',
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
    console.log(`${stepId}: frozen ${digest(bytes).slice(0, 12)}`);

    if (stepIndex < stepIds.length - 1) {
      await execute('view.setMode', { mode:'build' }, `${stepId}-advance-build`);
      await execute('pose.captureReference', { mode:'propagate' },
        `${stepId}-capture-predicted-reference`);
    }
  }

  const audit = await browser.evaluate(`window.MolariumChemistActions.history()`);
  const auditBytes = Buffer.from(`${JSON.stringify({
    schema:description.schema, routeId:'sos1-hit-only', records:audit,
  }, null, 2)}\n`);
  await writeFile(join(output, 'chemist-action-audit.json'), auditBytes);
  const campaignPath = join(root,
    'design-history/structures/generated/sos1-prospective-campaign.json');
  const runnerPath = fileURLToPath(import.meta.url);
  const manifest = {
    schema:'molarium.design-prediction-run/v1',
    routeId:'sos1-hit-only',
    status:'predictions-frozen-holdouts-unopened',
    protocol:{ initialCoordinateInput:'PDB 5OVE/AXE only',
      sequentialPredictedReferences:true, relaxMethod,
      phe890Branching:{ stepId:'open-phe890-pocket', branchCount,
        sampling:'best-ranked representative of each canonical chi1 basin, then global rank',
        branchPoseSearchChains:branchSearchChains, finalPoseSearchChains:64,
        criterion:COUPLED_SIDECHAIN_POSE_SELECTION_CRITERION } },
    checkpoints,
    agentApi:{ schema:description.schema, actions:Object.keys(description.actions),
      auditRecords:audit.length, auditSha256:digest(auditBytes) },
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
