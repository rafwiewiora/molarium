import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildValidationRegistry, repositoryRoot, stableRegistryJson } from './registry-builder.mjs';

const expected = stableRegistryJson(await buildValidationRegistry());
const path = resolve(repositoryRoot, 'validation/registry.v0.1.json');
const actual = await readFile(path, 'utf8');
assert.equal(actual, expected, 'validation registry is stale; run npm run build:validation-registry');
const registry = JSON.parse(actual);
assert.deepEqual(registry.headline, {
  registeredDockingCases:25,
  distinctReferenceSystems:18,
  uniqueProteinTargets:15,
  casesReachingPoseSearch:17,
  pairedCrystalScored:5,
  nativeGpuPoseInstances:5,
});
assert.equal(registry.cases.length, 25);
assert.equal(new Set(registry.cases.map(entry => entry.caseId)).size, 25);
assert.equal(registry.studies.find(entry => entry.studyId === '7kpa-two-terminus-chemistry-panel-v0.1')
  .status, 'registered-partial');
for (const entry of Object.values(registry.artifacts)) {
  assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  assert.ok(entry.bytes > 0);
}
console.log('Validation registry: PASS (25 cases; 18 reference systems; 15 targets; 5 crystal-scored)');
