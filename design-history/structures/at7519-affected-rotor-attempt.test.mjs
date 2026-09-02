import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const run = join(root,
  'outputs/design-history/at7519-hit-only-prospective-attempt4-local-affected-rotors');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(join(run, 'prediction-manifest.json'));
const manifest = JSON.parse(manifestBytes);
const auditBytes = await readFile(join(run, 'chemist-action-audit.json'));
const evaluationBytes = await readFile(join(run, 'holdout-evaluation.json'));
const evaluation = JSON.parse(evaluationBytes);

assert.equal(manifest.status, 'predictions-frozen-holdouts-unopened');
assert.equal(manifest.protocol.holdoutCoordinateReads, 0);
assert.equal(manifest.checkpoints.length, 5);
assert.equal(new Set(manifest.checkpoints.map(
  (entry) => entry.receptorCoordinateSha256)).size, 1);
assert.equal(sha256(auditBytes), manifest.agentApi.auditSha256);
assert.equal(evaluation.status, 'post-freeze-evaluated');
assert.equal(evaluation.freezeProof.predictionManifestSha256, sha256(manifestBytes));
assert.deepEqual(evaluation.freezeProof.checkpointSha256,
  manifest.checkpoints.map((entry) => entry.sha256));

const checkpoints = new Map();
for (const entry of manifest.checkpoints) {
  const bytes = await readFile(join(run, entry.filename));
  assert.equal(sha256(bytes), entry.sha256);
  checkpoints.set(entry.stepId, JSON.parse(bytes));
}
const difluoro = checkpoints.get('lock-difluoro-torsion').refinement.featureGuidedSeeding;
assert.equal(difluoro.method, 'molarium-edit-region-axis-seeding/v4');
assert.equal(difluoro.uniqueSeedCount, 12);
assert.equal(difluoro.untargetedRotorCount, 0);
assert.equal(difluoro.affectedRotorCount, 1);
assert.equal(difluoro.releasedCoreAtomIndices.length, 5);
assert.equal(difluoro.selectedSeedAudit.method,
  'affected-existing-rotor-torsion-scan');
assert.equal(difluoro.selectedSeedAudit.axialAngleDegrees, 180);

const finish = checkpoints.get('finish-at7519').refinement.featureGuidedSeeding;
assert.equal(finish.uniqueSeedCount, 34);
assert.equal(finish.untargetedRotorCount, 1);
assert.equal(finish.affectedRotorCount, 2);
assert.equal(finish.releasedCoreAtomIndices.length, 8);
assert.equal(finish.selectedSeedAudit.method, 'untargeted-edit-region-torsion-scan');
assert.equal(finish.selectedSeedAudit.axialAngleDegrees, -150);

const results = new Map(evaluation.results.map((entry) => [entry.stepId, entry]));
assert.deepEqual(results.get('lock-difluoro-torsion').metrics, {
  heavyAtomCount:26,
  allHeavyAtomRmsdAngstrom:2.141514,
  preservedAtomRmsdAngstrom:1.919739,
  newAtomRmsdAngstrom:3.923558,
  centroidOffsetAngstrom:1.344468,
  affectedArylCarbonylTorsion:{
    definition:'absolute O=C-C(aryl)-C(ortho) dihedral folded to 0-90 degrees',
    productAtomIndices:[17,16,18,19],
    productAtomNames:['OX2','CX9','CX8','CX10'],
    predictedDegrees:29.349798, holdoutDegrees:65.613011,
    absoluteDifferenceDegrees:36.263213,
  },
});
assert.equal(results.get('finish-at7519').metrics.allHeavyAtomRmsdAngstrom, 2.367137);
assert.equal(results.get('finish-at7519').metrics.newAtomRmsdAngstrom, 2.733938);
assert.equal(results.get('finish-at7519').metrics.affectedArylCarbonylTorsion.predictedDegrees,
  29.273811);
assert.equal(results.get('finish-at7519').metrics.affectedArylCarbonylTorsion.holdoutDegrees,
  67.135559);

console.log('AT7519 attempt4 passed immutable freeze, affected-rotor, torsion, and holdout gates');
