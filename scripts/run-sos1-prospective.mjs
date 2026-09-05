import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSidechainChiAnglesReproduced, COUPLED_SIDECHAIN_POSE_SELECTION_CRITERION,
  evaluatePostRelaxedBranchObjective, measureInspectedSidechainChiAngles,
  selectCoupledSidechainPoseBranch,
  uniqueSidechainRotamerCandidates } from '../docking/sidechain-rotamers.mjs';
import { MOLARIUM_CONSTRAINT_DOCK_PROTOCOL } from '../docking/protocol.mjs';
import { AUDIT_STATE_HASH_GUARDS, actionScriptFromAudit } from '../design-history/replay.mjs';
import { MOLECULAR_STATE_HASH_SCHEMA } from '../molecular-state-hash.mjs';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';
import { parseDiagnosticPhe890SeedChiDegrees,
  diagnosticPhe890ProtocolFields, diagnosticPhe890SeedChiIdentity,
  resolveDiagnosticPhe890Candidate } from './sos1-diagnostic-phe-selector.mjs';

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
const diagnosticPhe890SeedChiDegrees = parseDiagnosticPhe890SeedChiDegrees(valueFor(
  '--diagnostic-phe890-seed-chi-degrees'));
if (diagnosticPhe890CoordinateSha256 != null && diagnosticPhe890SeedChiDegrees != null)
  throw new Error('Specify only one diagnostic Phe890 selector');
const diagnosticPhe890 = diagnosticPhe890CoordinateSha256 != null
  || diagnosticPhe890SeedChiDegrees != null;
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
if (diagnosticPhe890
  && !['open-phe890-pocket', 'finish-bay-293'].includes(requestedStop))
  throw new Error('A diagnostic Phe890 branch is non-promotable and requires --stop-after open-phe890-pocket or finish-bay-293');
if (diagnosticPhe890 && valueFor('--output') == null)
  throw new Error('A diagnostic Phe890 branch requires an explicit --output directory');
const stepIds = allSteps.slice(0, stopIndex + 1);
const completeRouteRun = stepIds.length === allSteps.length;
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

async function commitFullSystemCampaignState({ stageId, filename, message, label,
  tags, requestPrefix }) {
  const campaignCommit = await execute('campaign.commitCurrent', {
    message, label, tags,
  }, `${requestPrefix}-commit-full-system`);
  const campaignVerification = await execute('campaign.verify', {},
    `${requestPrefix}-verify-full-system`);
  if (campaignVerification.result.campaignVerification?.valid !== true)
    throw new Error(`${stageId}: full-system Design History failed verification`);
  const campaignExport = await execute('campaign.export', {},
    `${requestPrefix}-export-full-system`);
  const campaignBytes = Buffer.from(campaignExport.result.campaignExport.serialized);
  await writeFile(join(output, filename), campaignBytes);
  return {
    schema:'molarium.full-system-checkpoint/v1', stageId,
    frozenBeforeHoldoutAccess:true,
    campaignId:campaignExport.result.campaignExport.campaignId,
    branch:campaignExport.result.campaignExport.branch,
    commitId:campaignCommit.result.campaignCommit.commitId,
    snapshotId:campaignCommit.result.campaignCommit.snapshotId,
    filename, sha256:digest(campaignBytes), bytes:campaignBytes.length,
    commitActionSequence:campaignCommit.sequence,
    exportActionSequence:campaignExport.sequence,
    verification:campaignVerification.result.campaignVerification,
  };
}

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

function requireAcceptedRelaxation(response, label, expectedHeavyBonds = null) {
  const optimization = response?.result?.optimization;
  const safeguard = optimization?.valenceSafeguard;
  if (optimization?.accepted !== true)
    throw new Error(`${label}: required relaxation was rejected and restored`);
  if (safeguard?.schema !== 'molarium.ligand-valence-safeguard/v1'
    || safeguard.accepted !== true || safeguard.complete !== true
    || !Number.isInteger(safeguard.checkedHeavyBonds)
    || safeguard.checkedHeavyBonds < 1
    || safeguard.expectedHeavyBonds !== safeguard.checkedHeavyBonds
    || safeguard.bondMeasurements?.length !== safeguard.checkedHeavyBonds
    || safeguard.bondMeasurements.some((bond) => bond.accepted !== true)
    || safeguard.violations?.length !== 0)
    throw new Error(`${label}: accepted relaxation lacks complete heavy-bond safeguard evidence`);
  if (expectedHeavyBonds != null && safeguard.checkedHeavyBonds !== expectedHeavyBonds)
    throw new Error(`${label}: valence safeguard did not inspect the exact staged product graph`);
  return response;
}

function requireRegisteredFeatureRefinement(refinement, staged, label) {
  const required = Array.from(staged?.result?.designStep?.poseTransferPlan
    ?.featureCorrespondences || []).filter((feature) => feature.required === true);
  if (!required.length) return refinement;
  const result = refinement?.result?.refinement;
  if (result?.selectedFeasible !== true)
    throw new Error(`${label}: selected pose is infeasible`);
  if (!Number.isFinite(result.selectedCore?.rmsdAngstrom)
    || !Number.isFinite(result.selectedCore?.maximumDisplacementAngstrom)
    || result.selectedCore.rmsdAngstrom
      > MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.coreConstraint.toleranceAngstrom
    || result.selectedCore.maximumDisplacementAngstrom
      > MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.coreConstraint.toleranceAngstrom)
    throw new Error(`${label}: selected pose moved its registered hard anchor`);
  if (result.requiredSpatialFeatureCount !== required.length)
    throw new Error(`${label}: selected pose did not evaluate every required spatial feature`);
  for (const expected of required) {
    const matches = (result.selectedSpatialFeatures || []).filter((feature) =>
      feature.id === expected.id
      && feature.registeredIntentId === expected.registeredIntentId);
    if (matches.length !== 1 || matches[0].required !== true
      || matches[0].satisfied !== true
      || matches[0].atomCount !== expected.mappingVariants[0].referenceAtomNames.length
      || matches[0].candidateVariantCount !== expected.mappingVariants.length)
      throw new Error(`${label}: required spatial-feature pose evidence is missing or incomplete`);
  }
  if (result.featureGuidedSeeding?.spatialFeatureMapCount
    !== required.reduce((sum, feature) => sum + feature.mappingVariants.length, 0))
    throw new Error(`${label}: pose seeding did not cover every registered feature map`);
  return refinement;
}

function requireRegisteredFeatureRelaxation(relaxation, staged, label) {
  const required = Array.from(staged?.result?.designStep?.poseTransferPlan
    ?.featureCorrespondences || []).filter((feature) => feature.required === true);
  if (!required.length) return relaxation;
  const retention = relaxation?.registeredPoseRetention;
  const before = retention?.before, after = retention?.after;
  if (retention?.accepted !== true || before?.active !== true
    || before?.accepted !== true || after?.active !== true
    || after?.accepted !== true)
    throw new Error(`${label}: coupled relaxation did not retain the registered pose islands`);
  if (retention.fixedAtomMotion?.accepted !== true
    || !Number.isFinite(retention.fixedAtomMotion.rmsdAngstrom)
    || !Number.isFinite(retention.fixedAtomMotion.maximumDisplacementAngstrom)
    || !Number.isFinite(retention.fixedAtomMotion
      .maximumFloat32RoundTripResidualAngstrom)
    || retention.fixedAtomMotion.maximumFloat32RoundTripResidualAngstrom
      > retention.fixedAtomMotion.toleranceAngstrom)
    throw new Error(`${label}: registered fixed atoms moved during coupled relaxation`);
  for (const [phase, evidence] of [['before', before], ['after', after]]) {
    if (!Number.isFinite(evidence.hardAnchor?.rmsdAngstrom)
      || !Number.isFinite(evidence.hardAnchor?.maxDisplacementAngstrom)
      || !Array.isArray(evidence.fixedCoordinatesAngstrom?.atomIds)
      || !Array.isArray(evidence.fixedCoordinatesAngstrom?.positions))
      throw new Error(`${label}: registered hard-anchor evidence is incomplete ${phase} coupled relaxation`);
  }
  if (!Array.isArray(before.features) || before.features.length !== required.length
    || !Array.isArray(after.features) || after.features.length !== required.length)
    throw new Error(`${label}: pre/post-relax registered feature count is not exact`);
  const beforeFixed = Array.from(before.fixedAtomIds || []);
  const afterFixed = Array.from(after.fixedAtomIds || []);
  if (new Set(beforeFixed).size !== beforeFixed.length
    || new Set(afterFixed).size !== afterFixed.length
    || JSON.stringify(beforeFixed) !== JSON.stringify(afterFixed))
    throw new Error(`${label}: registered retained atom identities changed during relaxation`);
  for (const expected of required) {
    const expectedMaps = expected.mappingVariants.length;
    const byPhase = [before, after].map((evidence) => evidence.features.filter((feature) =>
      feature.id === expected.id
      && feature.registeredIntentId === expected.registeredIntentId));
    for (const matches of byPhase) {
      const measured = matches[0];
      if (matches.length !== 1 || measured.accepted !== true
        || measured.toleranceAngstrom !== expected.restraint.toleranceAngstrom
        || measured.symmetryVariantCount !== expectedMaps
        || measured.rmsdAngstrom > expected.restraint.toleranceAngstrom
        || !Number.isFinite(measured.rmsdAngstrom)
        || !Number.isFinite(measured.centroidDisplacementAngstrom)
        || !Number.isFinite(measured.planeNormalAngleDegrees)
        || !Array.isArray(measured.productAtomIds)
        || measured.productAtomIds.length
          !== expected.mappingVariants[0].referenceAtomNames.length
        || new Set(measured.productAtomIds).size !== measured.productAtomIds.length)
        throw new Error(`${label}: required retained feature lacks complete pre/post-relax evidence`);
    }
    if (JSON.stringify(byPhase[0][0].productAtomIds)
      !== JSON.stringify(byPhase[1][0].productAtomIds))
      throw new Error(`${label}: required retained feature atom identities changed during relaxation`);
  }
  return relaxation;
}

function requireSaneInspectedLigand(inspection, label) {
  requireCompleteInspection(inspection, `${label} ligand`);
  const atoms = inspection?.result?.atoms || [];
  const byId = new Map(atoms.map((atom) => [atom.atomId, atom]));
  if (byId.size !== atoms.length) throw new Error(`${label}: duplicate ligand atom identity`);
  const heavyBonds = [];
  for (const bond of inspection?.result?.bonds || []) {
    const first = byId.get(bond.atomIds?.[0]), second = byId.get(bond.atomIds?.[1]);
    if (!first || !second || first.element === 'H' || second.element === 'H') continue;
    heavyBonds.push(bond);
    const distanceAngstrom = Math.hypot(...first.coordinatesAngstrom.map((value, axis) =>
      value - second.coordinatesAngstrom[axis]));
    if (!Number.isFinite(distanceAngstrom) || distanceAngstrom < 0.85
      || distanceAngstrom > 2.2)
      throw new Error(`${label}: heavy-atom bond ${bond.atomIds.join('-')} is ${distanceAngstrom.toFixed(3)} Å`);
  }
  if (atoms.filter((atom) => atom.element !== 'H').length > 1 && !heavyBonds.length)
    throw new Error(`${label}: ligand inspection has no heavy-atom graph edges`);
  return inspection;
}

function requireExactStagedProductGraph(inspection, staged, label) {
  const expected = staged?.result?.designStep?.productHeavyGraph;
  if (!expected || expected.atomCount !== staged.result.designStep.productHeavyAtoms
    || expected.atoms?.length !== expected.atomCount
    || expected.bonds?.length !== expected.bondCount)
    throw new Error(`${label}: staged product graph evidence is incomplete`);
  const atoms = inspection.result.atoms.filter((atom) => atom.element !== 'H');
  if (atoms.length !== expected.atomCount)
    throw new Error(`${label}: inspected ligand heavy-atom count differs from staged product`);
  const byId = new Map(inspection.result.atoms.map((atom) => [atom.atomId, atom]));
  const actualAtoms = atoms.map((atom) => ({ atomName:atom.atomName,
    element:atom.element, formalCharge:atom.formalCharge,
    aromatic:Boolean(atom.aromatic) }))
    .sort((first, second) => first.atomName.localeCompare(second.atomName));
  if (actualAtoms.some((atom) => typeof atom.atomName !== 'string' || !atom.atomName)
    || new Set(actualAtoms.map((atom) => atom.atomName)).size !== actualAtoms.length
    || JSON.stringify(actualAtoms) !== JSON.stringify(expected.atoms))
    throw new Error(`${label}: inspected ligand atom graph differs from staged product`);
  const actualBonds = inspection.result.bonds.flatMap((bond) => {
    const first = byId.get(bond.atomIds?.[0]), second = byId.get(bond.atomIds?.[1]);
    if (!first || !second || first.element === 'H' || second.element === 'H') return [];
    return [{ atomNames:[first.atomName, second.atomName].sort(),
      order:Number(bond.order || 1), aromatic:Boolean(bond.aromatic) }];
  }).sort((first, second) => first.atomNames.join('\0').localeCompare(
    second.atomNames.join('\0')));
  if (actualBonds.length !== expected.bondCount
    || JSON.stringify(actualBonds) !== JSON.stringify(expected.bonds))
    throw new Error(`${label}: inspected ligand bond graph differs from staged product`);
  return inspection;
}

function requireCompleteInspection(inspection, label) {
  const atoms = inspection?.result?.atoms;
  if (!Array.isArray(atoms) || !atoms.length
    || inspection.result.truncated !== false
    || !Number.isInteger(inspection.result.totalAtomCount)
    || inspection.result.totalAtomCount !== atoms.length)
    throw new Error(`${label}: coordinate inspection is incomplete`);
  if (atoms.some((atom) => !Array.isArray(atom.coordinatesAngstrom)
    || atom.coordinatesAngstrom.length !== 3
    || !atom.coordinatesAngstrom.every(Number.isFinite)))
    throw new Error(`${label}: coordinate inspection contains invalid coordinates`);
  return inspection;
}

function periodicDistanceDegrees(first, second, period = 360) {
  return Math.abs(((Number(first) - Number(second) + period / 2) % period + period)
    % period - period / 2);
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
  changedLigandAtomIds, expectedProductHeavyBondCount,
  onSelectedRotamerApplied = null } = {}) {
  let ensemble = await enumeratePhe890(stepId);
  const availableCandidates = uniqueSidechainRotamerCandidates(ensemble.candidates,
    { maximum:diagnosticPhe890 ? 32 : branchCount });
  const diagnosticCandidate = resolveDiagnosticPhe890Candidate({ ...ensemble,
    candidates:availableCandidates }, {
    coordinateSha256:diagnosticPhe890CoordinateSha256,
    seedChiDegrees:diagnosticPhe890SeedChiDegrees,
  });
  const diagnosticSeedChiIdentity = diagnosticPhe890SeedChiDegrees == null ? null
    : diagnosticPhe890SeedChiIdentity(ensemble, diagnosticPhe890SeedChiDegrees);
  const candidates = diagnosticCandidate == null ? availableCandidates : [diagnosticCandidate];
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
    const appliedSeedPocket = await execute('session.inspect', {
      scope:'pocket', includeCoordinates:true, maximumAtoms:500,
    }, `${stepId}-inspect-applied-phe890-seed-${candidate.rank}`);
    const appliedSeedChiDegrees = measureInspectedSidechainChiAngles({
      atoms:appliedSeedPocket.result.atoms, residue:PHE890,
    });
    assertSidechainChiAnglesReproduced(candidate.chiDegrees, appliedSeedChiDegrees);
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
    if (diagnosticPhe890)
      requireAcceptedRelaxation(relaxed, `${stepId} diagnostic branch ${candidate.rank}`,
        expectedProductHeavyBondCount);
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
      seedChiDegrees:candidate.chiDegrees, appliedSeedChiDegrees, relaxedChiDegrees,
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
    if (diagnosticPhe890) {
      const selected = branches[0];
      const selectorLabel = diagnosticPhe890CoordinateSha256 != null
        ? 'exact candidate coordinate SHA' : 'unique seed chi vector';
      return {
        schema:'molarium.sidechain-branch-decision/v1', residue:'PHE A890',
        coordinateInputClass:'registered-hit-only', branchCount:1,
        publicationEligible:false, diagnosticOnly:true,
        deterministicFinalReplayVerified:false,
        diagnosticReason:`single ${selectorLabel} proxy; branch competition was not rerun`,
        diagnosticSelector:diagnosticSeedChiIdentity,
        enumeration:{ inputCoordinateSha256:ensemble.inputCoordinateSha256,
          inputChiDegrees:ensemble.inputChiDegrees,
          generatedCandidateCount:ensemble.generatedCandidateCount,
          retainedCandidateCount:ensemble.candidates.length,
          branchSampling:`one ${selectorLabel}-selected candidate from the complete current enumeration` },
        branches,
        selected:{ candidateIndex:selected.candidateIndex,
          candidateRank:selected.candidateRank, source:selected.source,
          chiDegrees:selected.chiDegrees, seedChiDegrees:selected.seedChiDegrees,
          appliedSeedChiDegrees:selected.appliedSeedChiDegrees,
          relaxedChiDegrees:selected.relaxedChiDegrees,
          selectedCoordinateSha256:selected.selectedCoordinateSha256,
          criterion:`diagnostic ${selectorLabel}; non-promotable`,
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
  if (onSelectedRotamerApplied)
    await onSelectedRotamerApplied({ applied, candidate:finalCandidate, ensemble });
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
  requireAcceptedRelaxation(relaxation, `${stepId} selected branch`,
    expectedProductHeavyBondCount);
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
    'pose.updateReceptorReference', 'pose.addContact', 'pose.forgetContact', 'pose.refine',
    'pose.apply', 'pose.enumerateSidechainRotamers', 'pose.applySidechainRotamer',
    'protein.parameterize', 'optimization.run', 'history.undo', 'session.inspect',
    'campaign.create', 'campaign.commitCurrent', 'campaign.verify', 'campaign.export']) {
    if (!description.actions[action]) throw new Error(`Public action is missing: ${action}`);
  }

  await execute('designRoute.load', { routeId:'sos1-hit-only' }, 'route-load-hit');
  await execute('view.setMode', { mode:'build' }, 'route-enter-build');
  console.log('route: preparing the registered 5OVE/AXE hit complex');
  await execute('protein.prepare', {
    pH:7.4, histidine:'auto', repairMissingHeavy:true,
    ligandPolicy:'ccd', waterPolicy:'retain', gapPolicy:'cap',
  }, 'route-prepare-hit');
  const campaignId = `sos1-run-${digest(Buffer.from(
    relative(root, output) || basename(output))).slice(0, 16)}`;
  await execute('campaign.create', {
    campaignId,
    title:'SOS1 hit-only prospective design route',
    description:'Full-system checkpoints created by the public Chemist Actions API.',
    actorId:'agent.sos1-runner', actorName:'SOS1 prospective runner',
    initialCommitMessage:'Capture the prepared 5OVE/AXE coordinate boundary',
  }, 'route-create-design-history');
  await execute('pose.captureReference', { mode:'propagate' }, 'route-capture-hit');
  const boundary = await execute('designRoute.inspect', {}, 'route-inspect-boundary');
  let previousFrozenLigand = null;
  let retainedPhe890ChiDegrees = null;
  let diagnosticResolvedPhe890 = null;

  for (let stepIndex = 0; stepIndex < stepIds.length; stepIndex++) {
    const stepId = stepIds[stepIndex];
    console.log(`${stepId}: staging the reported graph against the preceding prediction`);
    const staged = await execute('designRoute.applyStep', { stepId }, `${stepId}-stage`);
    const intermediateFullSystemCampaigns = [];
    let rotamerDecision = null;
    let transientContactIds = [];
    let refinement, parameterization;
    let relaxation = { method:'none',
      interpretation:'Pose search only; receptor and selected pose were left unchanged.' };
    if (stepId === 'open-phe890-pocket') {
      intermediateFullSystemCampaigns.push(await commitFullSystemCampaignState({
        stageId:'compound-21-graph-edit-before-phe890-rotamer',
        filename:'compound-21-graph-edit-before-phe890-rotamer-campaign.json',
        message:'Freeze compound 21 graph edit before Phe890 movement',
        label:'compound 21 graph edit · Phe890 in',
        tags:['sos1-hit-only', 'pre-holdout', stepId, 'pre-refinement', 'graph-edit'],
        requestPrefix:`${stepId}-graph-edit-before-phe890-rotamer`,
      }));
      console.log(`${stepId}: ranking coupled Phe890 and ligand-pose branches`);
      const hingeContact = await execute('pose.addContact', {
        ligandAtom:{ componentId:'heterogen:A:1104::AWW', atomName:'N7' },
        receptorAtom:{ residueName:'ASN', chain:'A', residueIndex:879,
          insertionCode:'', atomName:'OD1' },
        ligandRole:'donor',
      }, `${stepId}-preserve-asn879-od1-contact`);
      const intendedContact = await execute('pose.addContact', {
        ligandAtom:{ componentId:'heterogen:A:1104::AWW', atomName:'OX3' },
        receptorAtom:{ residueName:'TYR', chain:'A', residueIndex:884,
          insertionCode:'', atomName:'O' },
        ligandRole:'donor',
      }, `${stepId}-add-tyr884-backbone-contact`);
      if (hingeContact.result.contact?.required !== true
        || intendedContact.result.contact?.required !== true
        || intendedContact.result.contact?.origin?.kind
          !== 'user-added-hydrogen-bond-hypothesis')
        throw new Error(`${stepId}: declared AWW H-bond intents were not installed`);
      transientContactIds = [hingeContact, intendedContact]
        .map((response) => response.result.contact.contactId);
      rotamerDecision = await choosePhe890Branch(stepId, {
        referenceLigand:previousFrozenLigand,
        hardAtomNames:staged.result.designStep.poseTransferPlan.hardConstraintAtomNames,
        changedLigandAtomIds:staged.result.designStep.addedHeavyAtomIds,
        expectedProductHeavyBondCount:staged.result.designStep.productHeavyGraph?.bondCount,
        onSelectedRotamerApplied:async () => {
          intermediateFullSystemCampaigns.push(await commitFullSystemCampaignState({
            stageId:'phe890-rotamer-before-coupled-relaxation',
            filename:'phe890-rotamer-before-coupled-relaxation-campaign.json',
            message:'Freeze selected Phe890 branch before ligand refinement',
            label:'compound 21 · selected Phe890-out branch · pre-refinement',
            tags:['sos1-hit-only', 'pre-holdout', stepId, 'pre-refinement',
              'selected-sidechain-rotamer'],
            requestPrefix:`${stepId}-selected-phe890-before-refinement`,
          }));
        },
      });
      refinement = rotamerDecision.selected.refinement;
      parameterization = rotamerDecision.selected.parameterization;
      relaxation = rotamerDecision.selected.optimization;
      if (diagnosticPhe890) diagnosticResolvedPhe890 = {
        inputCoordinateSha256:rotamerDecision.enumeration.inputCoordinateSha256,
        selectedCoordinateSha256:rotamerDecision.selected.selectedCoordinateSha256,
        seedChiDegrees:rotamerDecision.selected.seedChiDegrees,
        appliedSeedChiDegrees:rotamerDecision.selected.appliedSeedChiDegrees,
        semanticIdentity:rotamerDecision.diagnosticSelector,
      };
    } else {
      console.log(`${stepId}: fixed-receptor pose search`);
      const refined = requireCompleteSeedCoverage(await executeGuarded('pose.refine', {
        searchChains:fixedSearchChains,
        execution:poseExecution, featureSeedingProtocol:'v5' },
      `${stepId}-pose-refine`), stepId);
      requireRegisteredFeatureRefinement(refined, staged, stepId);
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
        requireAcceptedRelaxation(relaxed, stepId,
          staged.result.designStep.productHeavyGraph?.bondCount);
        relaxation = relaxed.result.optimization;
      }
    }
    if (relaxation?.accepted !== true)
      throw new Error(`${stepId}: checkpoint lacks an accepted required relaxation`);
    requireRegisteredFeatureRelaxation(relaxation, staged, stepId);
    const ligand = requireSaneInspectedLigand(await execute('session.inspect', {
      scope:'ligand', includeCoordinates:true, maximumAtoms:256,
    }, `${stepId}-freeze-ligand`), stepId);
    requireExactStagedProductGraph(ligand, staged, stepId);
    const pocket = requireCompleteInspection(await execute('session.inspect', {
      scope:'pocket', includeCoordinates:true, maximumAtoms:500,
    }, `${stepId}-freeze-pocket`), `${stepId} pocket`);
    let sidechainContinuity = null;
    if (stepId === 'open-phe890-pocket') {
      retainedPhe890ChiDegrees = measureInspectedSidechainChiAngles({
        atoms:pocket.result.atoms, residue:PHE890,
      });
    } else if (stepId === 'finish-bay-293' && retainedPhe890ChiDegrees) {
      const finalChiDegrees = measureInspectedSidechainChiAngles({
        atoms:pocket.result.atoms, residue:PHE890,
      });
      const differencesDegrees = retainedPhe890ChiDegrees.map((value, index) =>
        periodicDistanceDegrees(finalChiDegrees[index], value, index === 1 ? 180 : 360));
      sidechainContinuity = { schema:'molarium.sidechain-state-continuity/v1',
        residue:'PHE A890', source:'preceding frozen prediction',
        referenceChiDegrees:retainedPhe890ChiDegrees,
        finalChiDegrees, differencesDegrees, chiPeriodsDegrees:[360, 180],
        maximumDifferenceDegrees:30,
        accepted:differencesDegrees.every((value) => value <= 30) };
      if (!sidechainContinuity.accepted)
        throw new Error(`${stepId}: Phe890 left the selected predecessor rotamer basin`);
    }
    const current = await execute('designRoute.inspect', {}, `${stepId}-inspect-state`);
    const campaignFilename = `${stepId}-campaign.json`;
    const campaignRecord = await commitFullSystemCampaignState({
      stageId:stepId, filename:campaignFilename,
      message:`Freeze ${stepId} prospective molecular state`,
      label:`${stepId} prediction`,
      tags:['sos1-hit-only', 'pre-holdout', stepId], requestPrefix:stepId,
    });
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
      sidechainContinuity,
      intermediateFullSystemCampaigns,
      fullSystemCampaign:campaignRecord,
      ligand:ligand.result, pocket:pocket.result,
    };
    const bytes = Buffer.from(`${JSON.stringify(checkpoint, null, 2)}\n`);
    const filename = `${stepId}-prediction.json`;
    await writeFile(join(output, filename), bytes);
    checkpoints.push({ stepId, predictedStateId:checkpoint.predictedStateId,
      filename, sha256:digest(bytes), bytes:bytes.length,
      ligandCoordinateSha256:coordinateDigest(ligand),
      pocketCoordinateSha256:coordinateDigest(pocket),
      freezeActionSequence:pocket.sequence,
      intermediateFullSystemCampaigns,
      fullSystemCampaign:campaignRecord,
      ...(rotamerDecision ? { rotamerSelection:{
        inputCoordinateSha256:rotamerDecision.enumeration.inputCoordinateSha256,
        selectedCoordinateSha256:rotamerDecision.selected.selectedCoordinateSha256,
        seedChiDegrees:rotamerDecision.selected.seedChiDegrees,
        appliedSeedChiDegrees:rotamerDecision.selected.appliedSeedChiDegrees,
      } } : {}) });
    previousFrozenLigand = structuredClone(ligand.result);
    console.log(`${stepId}: frozen ${digest(bytes).slice(0, 12)}`);

    if (stepIndex < stepIds.length - 1) {
      if (stepId === 'open-phe890-pocket') {
        for (const [index, contactId] of transientContactIds.entries())
          await execute('pose.forgetContact', { contactId },
            `${stepId}-retire-contact-${index + 1}`);
      }
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
    status:completeRouteRun && !diagnosticPhe890 && relaxMethod !== 'none'
      ? 'predictions-frozen-holdouts-unopened' : 'diagnostic-non-promotable',
    publicationEligible:completeRouteRun && !diagnosticPhe890
      && relaxMethod !== 'none',
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
        ...diagnosticPhe890ProtocolFields({
          coordinateSha256:diagnosticPhe890CoordinateSha256,
          seedChiDegrees:diagnosticPhe890SeedChiDegrees,
          resolved:diagnosticResolvedPhe890,
        }),
        diagnosticOrigin:diagnosticPhe890SeedChiDegrees == null ? null : {
          priorRunnerCommit:'b9e0d2ca446e352ff6e69e0130330aa38e331d1b',
          priorCoordinateSha256:'d71e8fd1de31afb49c7bc54509f18cf59aa21b45e21cc51ee6a6f888e6fd2669',
          purpose:'reselect the same preregistered canonical seed-chi basin after the preceding coordinate state changed' },
        } },
      intermediateFullSystemCheckpoints:[
        'compound-21-graph-edit-before-phe890-rotamer',
        'phe890-rotamer-before-coupled-relaxation',
      ],
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
} catch (error) {
  let audit = [];
  try {
    audit = await browser.evaluate(`window.MolariumChemistActions?.history?.() || []`);
  } catch {
    // Preserve the original scientific failure even if the browser itself has exited.
  }
  const auditEnvelope = { schema:'molarium.chemist-actions/v1', routeId:'sos1-hit-only',
    status:'failed', records:audit };
  const auditBytes = Buffer.from(`${JSON.stringify(auditEnvelope, null, 2)}\n`);
  await writeFile(join(output, 'chemist-action-audit.json'), auditBytes);
  const lastRecord = audit.at(-1) || null;
  await writeFile(join(output, 'failed-run.json'), `${JSON.stringify({
    schema:'molarium.design-prediction-failure/v1', routeId:'sos1-hit-only',
    diagnostic:diagnosticPhe890, requestedStop, relaxMethod,
    error:{ name:String(error?.name || 'Error'), message:String(error?.message || error),
      stack:String(error?.stack || '') },
    completedCheckpoints:checkpoints,
    auditRecords:audit.length, auditSha256:digest(auditBytes), lastRecord,
  }, null, 2)}\n`);
  console.error(`Preserved failed-run.json with ${audit.length} public action records`);
  throw error;
} finally {
  await browser.close();
}
