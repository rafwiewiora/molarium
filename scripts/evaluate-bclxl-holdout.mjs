import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueFor = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const runDir = resolve(root, valueFor('--run',
  'outputs/design-history/bclxl-hit-only-prospective-smoke'));
const stepId = valueFor('--step', 'compound-6');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

// The prediction manifest and checkpoint are read and verified before the
// holdout path is even resolved.  This ordering is the evaluation boundary.
const manifestBytes = await readFile(join(runDir, 'prediction-manifest.json'));
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.status, 'predictions-frozen-holdouts-unopened');
const frozen = manifest.checkpoints.find((entry) => entry.stepId === stepId);
assert(frozen, `No frozen checkpoint for ${stepId}`);
const predictionBytes = await readFile(join(runDir, frozen.filename));
assert.equal(digest(predictionBytes), frozen.sha256, 'frozen prediction hash changed');
const prediction = JSON.parse(predictionBytes);
assert.equal(prediction.frozenBeforeHoldoutAccess, true);

const hitProteinPath = join(root, 'design-history/structures/generated/3spf-protein.pdb');
const hitLigandPath = join(root, 'design-history/structures/generated/3spf-ligand.pdb');
const holdoutPath = join(root, 'design-history/structures/generated/3sp7-aligned-protein.pdb');
const [hitProteinBytes, hitLigandBytes, holdoutBytes] = await Promise.all([
  readFile(hitProteinPath), readFile(hitLigandPath), readFile(holdoutPath),
]);

const pdbAtoms = (bytes) => String(bytes).split(/\r?\n/)
  .filter((line) => line.startsWith('ATOM') || line.startsWith('HETATM'))
  .map((line) => ({ record:line.slice(0, 6).trim(), atomName:line.slice(12, 16).trim(),
    residueName:line.slice(17, 20).trim(), chain:line.slice(21, 22).trim() || 'A',
    residueIndex:Number.parseInt(line.slice(22, 26), 10) || 0,
    point:[Number(line.slice(30, 38)), Number(line.slice(38, 46)), Number(line.slice(46, 54))] }));
const hitAll = [...pdbAtoms(hitProteinBytes), ...pdbAtoms(hitLigandBytes)];
const center = [0, 1, 2].map((axis) =>
  hitAll.reduce((sum, atom) => sum + atom.point[axis], 0) / hitAll.length);
const centeredResidue = (bytes, residueName, residueIndex) => Object.fromEntries(
  pdbAtoms(bytes).filter((atom) => atom.record === 'ATOM'
    && atom.residueName === residueName && atom.residueIndex === residueIndex)
    .map((atom) => [atom.atomName, atom.point.map((value, axis) => value - center[axis])]));
const predictedResidue = (residueName, residueIndex) => Object.fromEntries(
  prediction.pocket.atoms.filter((atom) => atom.residueName === residueName
    && atom.residueIndex === residueIndex)
    .map((atom) => [atom.atomName, atom.coordinatesAngstrom]));
const hit = centeredResidue(hitProteinBytes, 'TYR', 101);
const holdout = centeredResidue(holdoutBytes, 'TYR', 101);
const predicted = predictedResidue('TYR', 101);
const distance = (first, second, atomName) => Math.hypot(...first[atomName]
  .map((value, axis) => value - second[atomName][axis]));
const rmsd = (first, second, atomNames) => Math.sqrt(atomNames.reduce((sum, atomName) =>
  sum + distance(first, second, atomName) ** 2, 0) / atomNames.length);
const backbone = ['N', 'CA', 'C', 'O'];
const sidechain = ['CB', 'CG', 'CD1', 'CD2', 'CE1', 'CE2', 'CZ', 'OH'];
for (const atomName of [...backbone, ...sidechain])
  assert(hit[atomName] && predicted[atomName] && holdout[atomName], `TYR101 ${atomName} missing`);

const evaluation = {
  schema:'molarium.design-prediction-holdout-evaluation/v1',
  routeId:manifest.routeId, stepId,
  boundary:{ predictionManifestSha256:digest(manifestBytes),
    frozenPredictionSha256:frozen.sha256, freezeActionSequence:frozen.freezeActionSequence,
    holdoutOpenedOnlyAfterFreezeVerification:true },
  holdout:{ role:'evaluation-only', pdbId:'3SP7',
    alignedProteinSha256:digest(holdoutBytes) },
  tyr101:{
    hitToPrediction:{ backboneRmsdAngstrom:rmsd(hit, predicted, backbone),
      sidechainRmsdAngstrom:rmsd(hit, predicted, sidechain),
      hydroxylDisplacementAngstrom:distance(hit, predicted, 'OH') },
    hitToHoldout:{ backboneRmsdAngstrom:rmsd(hit, holdout, backbone),
      sidechainRmsdAngstrom:rmsd(hit, holdout, sidechain),
      hydroxylDisplacementAngstrom:distance(hit, holdout, 'OH') },
    predictionToHoldout:{ backboneRmsdAngstrom:rmsd(predicted, holdout, backbone),
      sidechainRmsdAngstrom:rmsd(predicted, holdout, sidechain),
      hydroxylDisplacementAngstrom:distance(predicted, holdout, 'OH') },
  },
};
await writeFile(join(runDir, `${stepId}-holdout-evaluation.json`),
  `${JSON.stringify(evaluation, null, 2)}\n`);
console.log(JSON.stringify(evaluation.tyr101, null, 2));
