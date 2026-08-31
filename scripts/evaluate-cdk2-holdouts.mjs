import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCoreTransform, fittedCoreTransform } from '../docking/constraints.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueFor = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const runDir = resolve(root, valueFor('--run',
  'outputs/design-history/cdk2-hit-only-prospective-smoke'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Verify every frozen prediction and the complete Agent API audit before an
// evaluation registry or holdout coordinate path is read or resolved.
const manifestBytes = await readFile(join(runDir, 'prediction-manifest.json'));
const predictionManifest = JSON.parse(manifestBytes);
assert.equal(predictionManifest.campaignId, 'cdk2-hit-only');
assert.equal(predictionManifest.status, 'predictions-frozen-holdouts-unopened');
assert.equal(predictionManifest.protocol.initialCoordinateInput, 'PDB 1H1Q/2A6 only');
assert.equal(predictionManifest.protocol.sequentialPredictedReferences, true);
const predictions = new Map();
for (const frozen of predictionManifest.checkpoints) {
  const bytes = await readFile(join(runDir, frozen.filename));
  assert.equal(digest(bytes), frozen.sha256, `${frozen.stepId}: frozen prediction hash changed`);
  const checkpoint = JSON.parse(bytes);
  assert.equal(checkpoint.frozenBeforeHoldoutAccess, true);
  assert.equal(checkpoint.parameterization.maximumCoordinateDisplacementAngstrom, 0);
  predictions.set(frozen.stepId, { frozen, checkpoint });
}
const auditBytes = await readFile(join(runDir, 'chemist-action-audit.json'));
assert.equal(digest(auditBytes), predictionManifest.agentApi.auditSha256,
  'Agent API audit hash changed');
const audit = JSON.parse(auditBytes).records;
const firstFreeze = predictionManifest.checkpoints.find((entry) => entry.stepId === 'add-meta-chloro');
const recapture = audit.find((entry) =>
  entry.requestId === 'add-meta-chloro-capture-predicted-reference');
const secondStage = audit.find((entry) =>
  entry.requestId === 'replace-chloro-with-sulfonamide-stage');
assert(recapture && secondStage
  && recapture.sequence > firstFreeze.freezeActionSequence
  && recapture.sequence < secondStage.sequence,
  'the second design step did not capture the frozen first prediction as its reference');

// Prediction integrity is now established. Only below this line may the
// evaluation registry disclose and open the two later crystal structures.
const benchmarkPath = join(root, 'docking/benchmark/manifest.v0.1.json');
const benchmarkBytes = await readFile(benchmarkPath);
const benchmark = JSON.parse(benchmarkBytes);
const campaignPath = join(root,
  'design-history/structures/generated/cdk2-prospective-campaign.json');
const campaignBytes = await readFile(campaignPath);
assert.equal(digest(campaignBytes), predictionManifest.inputs.campaign.sha256,
  'registered pre-freeze campaign changed');
const campaign = JSON.parse(campaignBytes);

const evaluations = [
  { stepId:'add-meta-chloro',
    caseId:'paired-cdk2-1h1q-2a6-to-1h1r-6cp' },
  { stepId:'replace-chloro-with-sulfonamide',
    caseId:'paired-cdk2-1h1r-6cp-to-1oiu-n76' },
];

function pdbRows(text) {
  let model = 1;
  return String(text).split(/\r?\n/).flatMap((line) => {
    if (line.startsWith('MODEL ')) {
      model = Number(line.slice(10, 14).trim()) || model; return [];
    }
    if (model !== 1 || !line.startsWith('ATOM  ') && !line.startsWith('HETATM')) return [];
    const alternateLocation = line.slice(16, 17).trim();
    if (alternateLocation && alternateLocation !== 'A') return [];
    return [{ record:line.slice(0, 6).trim(), atomName:line.slice(12, 16).trim(),
      alternateLocation, residueName:line.slice(17, 20).trim(),
      chain:line.slice(21, 22).trim(), residueNumber:Number(line.slice(22, 26).trim()),
      insertionCode:line.slice(26, 27).trim(),
      point:[Number(line.slice(30, 38)), Number(line.slice(38, 46)),
        Number(line.slice(46, 54))] }];
  });
}

const flat = (points) => Float64Array.from(points.flat());
const coordinates = (positions, index) =>
  Array.from(positions.slice(index * 3, index * 3 + 3));
const rmsd = (first, second, indices = first.map((_, index) => index)) =>
  Math.sqrt(indices.reduce((sum, index) => sum + first[index].reduce((inner, value, axis) =>
    inner + (value - second[index][axis]) ** 2, 0), 0) / indices.length);
const pointDistance = (first, second) => Math.hypot(...first.map((value, axis) => value - second[axis]));

const hitCase = benchmark.cases.find((entry) =>
  entry.id === 'paired-cdk2-1h1q-2a6-to-1h1r-6cp');
assert(hitCase, 'registered CDK2 hit case missing');
const hitPdbPath = join(root, 'docking/benchmark', hitCase.reference.coordinateFile);
const hitPdbBytes = await readFile(hitPdbPath);
const hitRows = pdbRows(hitPdbBytes);
const hitLigandRows = hitRows.filter((atom) => atom.record === 'HETATM'
  && atom.residueName === hitCase.reference.ligandComponentId
  && atom.chain === hitCase.reference.ligandChain
  && atom.residueNumber === hitCase.reference.ligandResidueNumber);
const hitLigandByName = new Map(hitLigandRows.map((atom) => [atom.atomName, atom.point]));

function alignHoldout(caseEntry, holdoutRows) {
  const caKey = (atom) => `${atom.residueNumber}:${atom.insertionCode}:${atom.residueName}`;
  const referenceCa = new Map(hitRows.filter((atom) => atom.record === 'ATOM'
    && atom.atomName === 'CA' && atom.chain === hitCase.reference.ligandChain)
    .map((atom) => [caKey(atom), atom.point]));
  const holdoutCa = new Map(holdoutRows.filter((atom) => atom.record === 'ATOM'
    && atom.atomName === 'CA' && atom.chain === caseEntry.groundTruth.ligandChain)
    .map((atom) => [caKey(atom), atom.point]));
  const keys = [...referenceCa.keys()].filter((key) => holdoutCa.has(key)).sort();
  assert(keys.length >= 20, `${caseEntry.id}: insufficient C-alpha alignment atoms`);
  const reference = flat(keys.map((key) => referenceCa.get(key)));
  const mobile = flat(keys.map((key) => holdoutCa.get(key)));
  const pairs = keys.map((_, index) => [index, index]);
  const transform = fittedCoreTransform(reference, mobile, pairs);
  const alignedCa = applyCoreTransform(mobile, transform);
  const alignedCaPoints = keys.map((_, index) => coordinates(alignedCa, index));
  return { transform, atoms:keys.length,
    rmsdAngstrom:rmsd(keys.map((key) => referenceCa.get(key)), alignedCaPoints) };
}

function activeSiteRmsd(holdoutRows, alignment) {
  const ligandPoints = hitLigandRows.map((atom) => atom.point);
  const residueKey = (atom) => `${atom.residueNumber}:${atom.insertionCode}:${atom.residueName}`;
  const siteResidues = new Set(hitRows.filter((atom) => atom.record === 'ATOM'
    && atom.chain === hitCase.reference.ligandChain
    && ligandPoints.some((ligand) => pointDistance(atom.point, ligand) <= 6))
    .map(residueKey));
  const atomKey = (atom) => `${residueKey(atom)}:${atom.atomName}`;
  const reference = new Map(hitRows.filter((atom) => atom.record === 'ATOM'
    && atom.chain === hitCase.reference.ligandChain && siteResidues.has(residueKey(atom)))
    .map((atom) => [atomKey(atom), atom.point]));
  const mobile = new Map(holdoutRows.filter((atom) => atom.record === 'ATOM'
    && atom.chain === hitCase.reference.ligandChain && siteResidues.has(residueKey(atom)))
    .map((atom) => [atomKey(atom), atom.point]));
  const keys = [...reference.keys()].filter((key) => mobile.has(key)).sort();
  const aligned = applyCoreTransform(flat(keys.map((key) => mobile.get(key))), alignment.transform);
  return { radiusAngstrom:6, residues:siteResidues.size, matchedHeavyAtoms:keys.length,
    rmsdAngstrom:rmsd(keys.map((key) => reference.get(key)),
      keys.map((_, index) => coordinates(aligned, index))) };
}

const summary = [];
for (const spec of evaluations) {
  const caseEntry = benchmark.cases.find((entry) => entry.id === spec.caseId);
  const step = campaign.steps.find((entry) => entry.id === spec.stepId);
  const prediction = predictions.get(spec.stepId);
  assert(caseEntry && step && prediction, `${spec.stepId}: evaluation registration incomplete`);
  const holdoutPath = join(root, 'docking/benchmark', caseEntry.groundTruth.coordinateFile);
  const holdoutBytes = await readFile(holdoutPath);
  assert.equal(digest(holdoutBytes), caseEntry.groundTruth.coordinateSha256,
    `${spec.stepId}: holdout coordinate hash changed`);
  const holdoutRows = pdbRows(holdoutBytes);
  const alignment = alignHoldout(caseEntry, holdoutRows);
  const site = activeSiteRmsd(holdoutRows, alignment);

  const predictedHeavyByName = new Map(prediction.checkpoint.ligand.atoms
    .filter((atom) => atom.element !== 'H')
    .map((atom) => [atom.atomName, atom.coordinatesAngstrom]));
  const offsets = step.posePropagationMap.commonAtoms.map((mapping) => {
    const predictedName = step.productAtomNames[mapping.productAtomIndex];
    const predictedPoint = predictedHeavyByName.get(predictedName);
    const hitPoint = hitLigandByName.get(mapping.referenceAtomName);
    assert(predictedPoint && hitPoint,
      `${spec.stepId}: common atom ${mapping.referenceAtomName} is unavailable`);
    return predictedPoint.map((value, axis) => value - hitPoint[axis]);
  });
  const centeringOffset = [0, 1, 2].map((axis) =>
    offsets.reduce((sum, offset) => sum + offset[axis], 0) / offsets.length);
  const maximumCoreResidual = Math.max(...offsets.map((offset) =>
    Math.hypot(...offset.map((value, axis) => value - centeringOffset[axis]))));
  const predictedPoints = step.productAtomNames.map((name) => {
    const point = predictedHeavyByName.get(name);
    assert(point, `${spec.stepId}: predicted heavy atom ${name} missing`);
    return point.map((value, axis) => value - centeringOffset[axis]);
  });

  const holdoutSelection = caseEntry.groundTruth;
  const holdoutLigandByName = new Map(holdoutRows.filter((atom) => atom.record === 'HETATM'
    && atom.residueName === holdoutSelection.ligandComponentId
    && atom.chain === holdoutSelection.ligandChain
    && atom.residueNumber === holdoutSelection.ligandResidueNumber
    && atom.insertionCode === holdoutSelection.ligandInsertionCode)
    .map((atom) => [atom.atomName, atom.point]));
  const holdoutRaw = holdoutSelection.scoringAtomMap.map((mapping) => {
    const atom = holdoutLigandByName.get(mapping.analogueAtomName);
    assert(atom, `${spec.stepId}: holdout atom ${mapping.analogueAtomName} missing`);
    return atom;
  });
  assert.equal(holdoutRaw.length, predictedPoints.length,
    `${spec.stepId}: product-index evaluation map changed`);
  const alignedHoldoutFlat = applyCoreTransform(flat(holdoutRaw), alignment.transform);
  const holdoutPoints = holdoutRaw.map((_, index) => coordinates(alignedHoldoutFlat, index));
  const commonIndices = new Set(step.posePropagationMap.commonAtoms
    .map((entry) => entry.productAtomIndex));
  const allIndices = predictedPoints.map((_, index) => index);
  const inheritedIndices = allIndices.filter((index) => commonIndices.has(index));
  const editedIndices = allIndices.filter((index) => !commonIndices.has(index));
  const result = {
    schema:'molarium.design-prediction-holdout-evaluation/v1',
    campaignId:predictionManifest.campaignId, stepId:spec.stepId,
    predictedStateId:prediction.checkpoint.predictedStateId,
    boundary:{ predictionManifestSha256:digest(manifestBytes),
      frozenPredictionSha256:prediction.frozen.sha256,
      freezeActionSequence:prediction.frozen.freezeActionSequence,
      holdoutOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified:true,
      sequentialPredictedReference:spec.stepId === 'replace-chloro-with-sulfonamide' },
    holdout:{ role:'evaluation-only', pdbId:holdoutSelection.pdbId,
      ligandComponentId:holdoutSelection.ligandComponentId,
      coordinatePath:relative(root, holdoutPath), coordinateSha256:digest(holdoutBytes) },
    receptor:{ alignmentScope:'CDK2 chain A C-alpha atoms',
      alignmentAtoms:alignment.atoms, alignmentRmsdAngstrom:alignment.rmsdAngstrom,
      activeSiteHeavyAtoms:site },
    ligand:{ scoringMethod:'protein-CA-aligned frozen product-index/CCD-atom-name mapping',
      symmetryCorrection:false, heavyAtoms:allIndices.length,
      labelMappedRmsdAngstrom:rmsd(predictedPoints, holdoutPoints),
      inheritedRegionRmsdAngstrom:rmsd(predictedPoints, holdoutPoints, inheritedIndices),
      editedRegionRmsdAngstrom:rmsd(predictedPoints, holdoutPoints, editedIndices),
      predictionCenteringOffsetAngstrom:centeringOffset,
      maximumInheritedCoordinateResidualAngstrom:maximumCoreResidual },
  };
  await writeFile(join(runDir, `${spec.stepId}-holdout-evaluation.json`),
    `${JSON.stringify(result, null, 2)}\n`);
  summary.push({ stepId:spec.stepId, predictedStateId:result.predictedStateId,
    holdoutPdbId:result.holdout.pdbId,
    receptorCaRmsdAngstrom:result.receptor.alignmentRmsdAngstrom,
    activeSiteHeavyAtomRmsdAngstrom:result.receptor.activeSiteHeavyAtoms.rmsdAngstrom,
    ligandRmsdAngstrom:result.ligand.labelMappedRmsdAngstrom,
    editedRegionRmsdAngstrom:result.ligand.editedRegionRmsdAngstrom });
}

const report = {
  schema:'molarium.design-prediction-holdout-evaluation-summary/v1',
  campaignId:predictionManifest.campaignId,
  predictionManifestSha256:digest(manifestBytes),
  benchmarkManifestSha256:digest(benchmarkBytes),
  holdoutsOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified:true,
  results:summary,
};
await writeFile(join(runDir, 'holdout-evaluation-summary.json'),
  `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
