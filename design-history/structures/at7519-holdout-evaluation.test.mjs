import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const evaluation = JSON.parse(await readFile(join(root,
  'design-history/structures/generated/at7519-holdout-evaluation.json'), 'utf8'));
const manifestBytes = await readFile(join(root, evaluation.freezeProof.predictionManifest));
const manifest = JSON.parse(manifestBytes);
const auditBytes = await readFile(join(root,
  'outputs/design-history/at7519-hit-only-prospective/chemist-action-audit.json'));
const audit = JSON.parse(auditBytes);

assert.equal(evaluation.schema, 'molarium.at7519-holdout-evaluation/v1');
assert.equal(evaluation.status, 'post-freeze-evaluated');
assert.equal(evaluation.freezeProof.holdoutCoordinateReadsBeforeFreeze, 0);
assert.equal(sha256(manifestBytes), evaluation.freezeProof.predictionManifestSha256);
assert.equal(sha256(auditBytes), evaluation.freezeProof.agentAuditSha256);
assert.equal(manifest.status, 'predictions-frozen-holdouts-unopened');
assert.equal(manifest.checkpoints.length, 5);
assert.deepEqual(evaluation.freezeProof.checkpointSha256,
  manifest.checkpoints.map((entry) => entry.sha256));
assert.equal(new Set(manifest.checkpoints.map(
  (entry) => entry.receptorCoordinateSha256)).size, 1,
  'the 2VTA receptor must not move between decisions');

const sideChainActions = new Set(['pose.enumerateSidechainRotamers',
  'pose.applySidechainRotamer', 'pose.updateReceptorReference']);
assert(!audit.records.some((record) => sideChainActions.has(record.action)),
  'the AT7519 run may not use a side-chain or receptor-motion action');
assert.deepEqual(evaluation.results.map((entry) => entry.holdout.pdbId),
  ['2VTL', '2VTN', '2VTO', '2VTP', '2VU3']);
assert.deepEqual(evaluation.results.map((entry) => entry.metrics.heavyAtomCount),
  [14, 19, 24, 26, 25]);
for (const result of evaluation.results) {
  assert(result.metrics.allHeavyAtomRmsdAngstrom > 0
    && result.metrics.allHeavyAtomRmsdAngstrom < 3,
  `${result.stepId} must be an independently aligned, finite placement result`);
  assert(result.matching.symmetryMappingsEvaluated >= 1);
  assert(result.holdout.alignedProteinCaRmsdAngstrom < 0.8,
    `${result.stepId} must use a conformationally stable CDK2 holdout`);
}
for (const asset of evaluation.emittedAssets) {
  const bytes = await readFile(join(root, asset.path));
  assert.equal(bytes.length, asset.bytes);
  assert.equal(sha256(bytes), asset.sha256);
  assert.equal((await stat(join(root, asset.path))).isFile(), true);
}

console.log('AT7519 holdouts passed freeze-order, rigid-receptor, graph, and asset gates');
