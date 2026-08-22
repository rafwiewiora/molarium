import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const readJson = async (name) => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const plan = await readJson('study-plan.v0.1.json');
const manifest = await readJson('manifest.v0.1-draft.json');
const sha256 = /^[a-f0-9]{64}$/;
const tiers = new Set(Object.keys(plan.tiers));

assert.equal(plan.targetCaseCount, 25);
assert.equal(Object.values(plan.tiers).reduce((sum, count) => sum + count, 0), 25);
assert.equal(manifest.datasetId, plan.id);
assert.ok(['draft', 'frozen'].includes(manifest.status));
assert.ok(Array.isArray(manifest.cases) && manifest.cases.length > 0);
assert.equal(new Set(manifest.cases.map((entry) => entry.id)).size, manifest.cases.length,
  'case IDs must be unique');

for (const entry of manifest.cases) {
  assert.match(entry.id, /^[a-z0-9][a-z0-9-]+$/);
  assert.ok(tiers.has(entry.tier), `${entry.id}: unknown tier`);
  assert.ok(entry.proteinTarget, `${entry.id}: protein target is required`);
  assert.match(entry.reference.pdbId, /^[0-9][A-Za-z0-9]{3}$/);
  assert.ok(entry.reference.ligandComponentId);
  assert.match(entry.reference.coordinateSha256, sha256);
  assert.match(entry.reference.ccdSha256, sha256);
  assert.ok(entry.transformation.recordedEditRequired,
    `${entry.id}: graph edit lineage must be recorded`);
  assert.ok(entry.interactionHypotheses.length,
    `${entry.id}: at least one interaction hypothesis is required`);
  assert.equal(entry.protocol.id, plan.protocol.id);
  assert.equal(entry.protocol.version, plan.protocol.version);
  assert.deepEqual(entry.protocol.seeds, plan.protocol.repeatSeeds);
  if (entry.tier === 'paired-crystal') {
    assert.equal(entry.groundTruth.analogueCrystalAvailable, true);
    assert.equal(entry.groundTruth.accuracyMetricsAllowed, true);
    assert.match(entry.groundTruth.coordinateSha256, sha256);
  } else {
    assert.equal(entry.groundTruth.accuracyMetricsAllowed, false,
      `${entry.id}: only paired crystals may report accuracy`);
  }
}

if (manifest.status === 'frozen') {
  assert.equal(manifest.cases.length, plan.targetCaseCount);
  for (const [tier, expected] of Object.entries(plan.tiers))
    assert.equal(manifest.cases.filter((entry) => entry.tier === tier).length, expected,
      `frozen tier ${tier} must contain ${expected} cases`);
}

console.log(`Bioisostere benchmark manifest: PASS (${manifest.cases.length}/${plan.targetCaseCount} registered)`);
