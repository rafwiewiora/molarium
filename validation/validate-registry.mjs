import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildValidationRegistry, repositoryRoot, stableRegistryJson } from './registry-builder.mjs';

const expected = stableRegistryJson(await buildValidationRegistry());
const path = resolve(repositoryRoot, 'validation/registry.v0.2.json');
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
const manualContactStudy = registry.studies.find(entry =>
  entry.studyId === '7kpa-manual-contact-recapture-v0.1');
assert.equal(manualContactStudy.status, 'complete');
assert.equal(manualContactStudy.counts.registeredChemistryCases, 10);
assert.equal(manualContactStudy.counts.executedCases, 10);
assert.equal(manualContactStudy.counts.replayCount, 20);
assert.equal(manualContactStudy.counts.replayAgreements, 10);
assert.equal(manualContactStudy.counts.feasibleCases, 9);
assert.deepEqual(manualContactStudy.counts.outcomes, {
  'no-feasible-pose':2,
  'success-feasible':18,
});
assert.equal(manualContactStudy.metrics.schedulerElapsedSeconds, 1434);
assert.equal(manualContactStudy.metrics.schedulerTotalCpuSeconds, 1548.865);
assert.equal(manualContactStudy.metrics.schedulerMaxRssBytes, 2227576832);
for (const entry of Object.values(registry.artifacts)) {
  assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  assert.ok(entry.bytes > 0);
}
console.log('Validation registry: PASS (25 cases; 18 reference systems; 15 targets; 5 crystal-scored)');
