import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCoreTransform, fittedCoreTransform } from '../docking/constraints.mjs';
import { verifyCdk2PredictionRun } from './verify-cdk2-prediction-run.mjs';
import { verifyFrozenDesignRouteInput } from
  '../design-history/structures/design-route-provenance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1]
    : args.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
};
const runDir = join(root, 'outputs/design-history/cdk2-hit-only-prospective-smoke');
const generated = join(root, 'design-history/structures/generated');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Establish the frozen, Agent-API-produced prediction boundary before resolving
// or opening either later crystal structure. This is the same ordering enforced
// by the holdout evaluator; this script only makes post-evaluation movie assets.
const auditReplay = valueFor('--audit-replay');
const verified = await verifyCdk2PredictionRun({ runDir,
  replayDir:auditReplay ? resolve(root, auditReplay) : null });
const predictionManifestBytes = verified.manifestBytes;
const predictionManifest = verified.manifest;
const checkpoints = verified.predictions;
const actionAuditBytes = verified.auditBytes;
const actionAudit = verified.audit;

const campaignPath = join(generated, 'cdk2-prospective-campaign.json');
const campaignBytes = await readFile(campaignPath);
const campaignInput = verifyFrozenDesignRouteInput(
  campaignBytes, predictionManifest.inputs.campaign.sha256);
const campaign = JSON.parse(campaignBytes);

// The holdout registry and coordinate files are intentionally first resolved
// below the complete prediction/audit verification above.
const benchmarkPath = join(root, 'docking/benchmark/manifest.v0.1.json');
const benchmarkBytes = await readFile(benchmarkPath);
const benchmark = JSON.parse(benchmarkBytes);
const holdoutSummaryBytes = await readFile(join(runDir, 'holdout-evaluation-summary.json'));
const holdoutSummary = JSON.parse(holdoutSummaryBytes);
assert.equal(holdoutSummary.predictionManifestSha256, digest(predictionManifestBytes));
assert.equal(holdoutSummary.holdoutsOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified, true);

const specs = [
  { stepId:'add-meta-chloro', caseId:'paired-cdk2-1h1q-2a6-to-1h1r-6cp',
    predictedAsset:'cdk2-6cp-frozen-prediction.pdb', holdoutAsset:'cdk2-1h1r-6cp-aligned-holdout.pdb' },
  { stepId:'replace-chloro-with-sulfonamide', caseId:'paired-cdk2-1h1r-6cp-to-1oiu-n76',
    predictedAsset:'cdk2-n76-frozen-prediction.pdb', holdoutAsset:'cdk2-1oiu-n76-aligned-holdout.pdb' },
];

function pdbRows(text) {
  let model = 1;
  return String(text).split(/\r?\n/).flatMap((line) => {
    if (line.startsWith('MODEL ')) { model = Number(line.slice(10, 14).trim()) || model; return []; }
    if (model !== 1 || !line.startsWith('ATOM  ') && !line.startsWith('HETATM')) return [];
    const alternateLocation = line.slice(16, 17).trim();
    if (alternateLocation && alternateLocation !== 'A') return [];
    return [{ line, record:line.slice(0, 6).trim(), serial:Number(line.slice(6, 11)),
      atomName:line.slice(12, 16).trim(), alternateLocation,
      residueName:line.slice(17, 20).trim(), chain:line.slice(21, 22).trim(),
      residueNumber:Number(line.slice(22, 26).trim()), insertionCode:line.slice(26, 27).trim(),
      element:(line.slice(76, 78).trim() || line.slice(12, 14).trim()).replace(/[^A-Za-z]/g, ''),
      point:[Number(line.slice(30, 38)), Number(line.slice(38, 46)), Number(line.slice(46, 54))] }];
  });
}

const flat = (points) => Float64Array.from(points.flat());
const coordinates = (positions, index) => Array.from(positions.slice(index * 3, index * 3 + 3));
const distance = (first, second) => Math.hypot(...first.map((value, axis) => value - second[axis]));
const centroid = (points) => [0, 1, 2].map((axis) =>
  points.reduce((sum, point) => sum + point[axis], 0) / points.length);

function alignToHit(hitRows, holdoutRows, holdoutChain) {
  const key = (atom) => `${atom.residueNumber}:${atom.insertionCode}:${atom.residueName}`;
  const hitCa = new Map(hitRows.filter((atom) => atom.record === 'ATOM'
    && atom.atomName === 'CA' && atom.chain === 'A').map((atom) => [key(atom), atom.point]));
  const holdoutCa = new Map(holdoutRows.filter((atom) => atom.record === 'ATOM'
    && atom.atomName === 'CA' && atom.chain === holdoutChain).map((atom) => [key(atom), atom.point]));
  const keys = [...hitCa.keys()].filter((entry) => holdoutCa.has(entry)).sort();
  assert(keys.length >= 20, 'insufficient C-alpha atoms for holdout alignment');
  const pairs = keys.map((_, index) => [index, index]);
  return { transform:fittedCoreTransform(flat(keys.map((entry) => hitCa.get(entry))),
    flat(keys.map((entry) => holdoutCa.get(entry))), pairs), atoms:keys.length };
}

function atomNameField(name, element) {
  const clean = String(name).slice(0, 4);
  if (clean.length === 4) return clean;
  return String(element).length === 1 ? ` ${clean.padEnd(3)}` : clean.padEnd(4);
}

function pdbAtom({ serial, atomName, residueName, point, element }) {
  const [x, y, z] = point;
  return `HETATM${String(serial).padStart(5)} ${atomNameField(atomName, element)} ${residueName.padStart(3).slice(-3)} A1298    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00 20.00          ${String(element).padStart(2).slice(-2)}`;
}

function predictionPdb(checkpoint, step, evaluation, residueName) {
  const atoms = checkpoint.ligand.atoms.filter((atom) => atom.element !== 'H');
  const byName = new Map(atoms.map((atom) => [atom.atomName, atom]));
  const offset = evaluation.ligand.predictionCenteringOffsetAngstrom;
  const ordered = step.productAtomNames.map((name) => {
    const atom = byName.get(name);
    assert(atom, `${step.id}: predicted atom ${name} unavailable`);
    return { ...atom, point:atom.coordinatesAngstrom.map((value, axis) => value - offset[axis]) };
  });
  const indexById = new Map(ordered.map((atom, index) => [atom.atomId, index + 1]));
  const lines = ordered.map((atom, index) => pdbAtom({ serial:index + 1,
    atomName:atom.atomName, residueName, point:atom.point, element:atom.element }));
  for (const bond of checkpoint.ligand.bonds) {
    const first = indexById.get(bond.atomIds[0]);
    const second = indexById.get(bond.atomIds[1]);
    if (first && second) lines.push(`CONECT${String(first).padStart(5)}${String(second).padStart(5)}`);
  }
  lines.push('END');
  return { text:`${lines.join('\n')}\n`, points:new Map(ordered.map((atom) => [atom.atomName, atom.point])) };
}

function alignedHoldoutPdb(holdoutRows, selection, transform) {
  const selected = holdoutRows.filter((atom) => atom.record === 'HETATM'
    && atom.residueName === selection.ligandComponentId && atom.chain === selection.ligandChain
    && atom.residueNumber === selection.ligandResidueNumber
    && atom.insertionCode === selection.ligandInsertionCode);
  assert(selected.length, `${selection.pdbId}: holdout ligand unavailable`);
  const transformed = applyCoreTransform(flat(selected.map((atom) => atom.point)), transform);
  const lines = selected.map((atom, index) => pdbAtom({ serial:index + 1, atomName:atom.atomName,
    residueName:selection.ligandComponentId, point:coordinates(transformed, index), element:atom.element }));
  lines.push('END');
  return { text:`${lines.join('\n')}\n`, points:new Map(selected.map((atom, index) =>
    [atom.atomName, coordinates(transformed, index)])) };
}

const hitProteinPath = join(generated, 'cdk2-1h1q-protein.pdb');
const hitLigandPath = join(generated, 'cdk2-1h1q-ligand.pdb');
const [hitProteinBytes, hitLigandBytes] = await Promise.all([
  readFile(hitProteinPath), readFile(hitLigandPath),
]);
const hitRows = pdbRows(hitProteinBytes);
const hitLigandRows = pdbRows(hitLigandBytes).filter((atom) => atom.record === 'HETATM');
const hitPoints = hitLigandRows.map((atom) => atom.point);
const pocketResidues = new Set(hitRows.filter((atom) => atom.record === 'ATOM'
  && hitPoints.some((point) => distance(atom.point, point) <= 5.5))
  .map((atom) => `${atom.chain}:${atom.residueNumber}:${atom.insertionCode}:${atom.residueName}`));
const pocketLines = hitRows.filter((atom) => pocketResidues.has(
  `${atom.chain}:${atom.residueNumber}:${atom.insertionCode}:${atom.residueName}`)).map((atom) => atom.line);
pocketLines.push('END');
const pocketPath = join(generated, 'cdk2-1h1q-pocket.pdb');
await writeFile(pocketPath, `${pocketLines.join('\n')}\n`);

const assets = [];
const editTargets = {};
for (const spec of specs) {
  const frozen = checkpoints.get(spec.stepId);
  const step = campaign.steps.find((entry) => entry.id === spec.stepId);
  const caseEntry = benchmark.cases.find((entry) => entry.id === spec.caseId);
  assert(frozen && step && caseEntry, `${spec.stepId}: movie registration incomplete`);
  const evaluationPath = join(runDir, `${spec.stepId}-holdout-evaluation.json`);
  const evaluationBytes = await readFile(evaluationPath);
  const evaluation = JSON.parse(evaluationBytes);
  assert.equal(evaluation.boundary.frozenPredictionSha256, frozen.frozen.sha256);
  assert.equal(evaluation.boundary.holdoutOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified, true);
  const holdoutPath = join(root, 'docking/benchmark', caseEntry.groundTruth.coordinateFile);
  const holdoutBytes = await readFile(holdoutPath);
  assert.equal(digest(holdoutBytes), caseEntry.groundTruth.coordinateSha256);
  const holdoutRows = pdbRows(holdoutBytes);
  const alignment = alignToHit(hitRows, holdoutRows, caseEntry.groundTruth.ligandChain);
  const predicted = predictionPdb(frozen.checkpoint, step, evaluation,
    caseEntry.groundTruth.ligandComponentId);
  const holdout = alignedHoldoutPdb(holdoutRows, caseEntry.groundTruth, alignment.transform);
  const predictedPath = join(generated, spec.predictedAsset);
  const alignedPath = join(generated, spec.holdoutAsset);
  await Promise.all([writeFile(predictedPath, predicted.text), writeFile(alignedPath, holdout.text)]);
  const editedProductIndices = step.posePropagationMap.addedProductAtoms.map((entry) => entry.productAtomIndex);
  const predictedEdit = editedProductIndices.map((index) => predicted.points.get(step.productAtomNames[index]));
  const holdoutEdit = editedProductIndices.map((index) =>
    holdout.points.get(caseEntry.groundTruth.scoringAtomMap[index].analogueAtomName));
  editTargets[spec.stepId] = {
    predicted:centroid(predictedEdit), holdout:centroid(holdoutEdit),
    midpoint:centroid([...predictedEdit, ...holdoutEdit]),
  };
  for (const [path, role] of [[predictedPath, 'frozen-prediction'], [alignedPath, 'evaluation-only-holdout']]) {
    const bytes = await readFile(path);
    assets.push({ path:relative(root, path), role, stepId:spec.stepId,
      sha256:digest(bytes), bytes:bytes.length });
  }
  assets.push({ path:relative(root, holdoutPath), role:'source-holdout', stepId:spec.stepId,
    sha256:digest(holdoutBytes), bytes:holdoutBytes.length });
  assets.push({ path:relative(root, evaluationPath), role:'post-freeze-evaluation', stepId:spec.stepId,
    sha256:digest(evaluationBytes), bytes:evaluationBytes.length });
}

for (const [path, role] of [[hitProteinPath, 'allowed-hit-protein'],
  [hitLigandPath, 'allowed-hit-ligand'], [pocketPath, 'derived-hit-pocket']]) {
  const bytes = await readFile(path);
  assets.push({ path:relative(root, path), role, sha256:digest(bytes), bytes:bytes.length });
}

const movieManifest = {
  schema:'molarium.cdk2-prospective-movie-assets/v1',
  campaignId:'cdk2-hit-only',
  scientificStatus:'honest-first-blind-result',
  claim:'The movie replays frozen predictions, then reveals evaluation-only holdouts.',
  boundary:{ initialCoordinateInput:'PDB 1H1Q/2A6 only', sequentialPredictedReferences:true,
    predictionManifestSha256:digest(predictionManifestBytes),
    originalAgentApiAuditSha256:predictionManifest.agentApi.auditSha256,
    verifiedAgentApiAuditSha256:digest(actionAuditBytes), agentApiAuditRecords:actionAudit.length,
    auditProvenance:verified.auditProvenance,
    holdoutsOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified:true },
  checkpoints:predictionManifest.checkpoints,
  evaluation:holdoutSummary.results,
  editTargets,
  inputs:[
    { path:relative(root, campaignPath), sha256:digest(campaignBytes),
      ...(campaignInput.schemaMigration
        ? { schemaMigration:campaignInput.schemaMigration } : {}) },
    { path:relative(root, benchmarkPath), sha256:digest(benchmarkBytes) },
    { path:relative(root, join(runDir, 'prediction-manifest.json')), sha256:digest(predictionManifestBytes) },
    { path:verified.auditProvenance.mode === 'semantic-replay'
      ? relative(root, join(resolve(root, auditReplay), 'chemist-action-audit.json'))
      : relative(root, join(runDir, 'chemist-action-audit.json')),
      sha256:digest(actionAuditBytes), role:verified.auditProvenance.mode },
    { path:relative(root, join(runDir, 'holdout-evaluation-summary.json')), sha256:digest(holdoutSummaryBytes) },
  ],
  assets,
};
const manifestPath = join(generated, 'cdk2-prospective-movie-assets.json');
await writeFile(manifestPath, `${JSON.stringify(movieManifest, null, 2)}\n`);
console.log(JSON.stringify({ manifest:relative(root, manifestPath), editTargets, assets:assets.length }, null, 2));
