import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const readJson = async (name) => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const plan = await readJson('study-plan.v0.1.json');
const manifest = await readJson('manifest.v0.1.json');
const runInputBytes = await readFile(path.join(root, 'run-input.v0.1.json'));
const runInput = JSON.parse(runInputBytes);
const sha256 = /^[a-f0-9]{64}$/;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const tiers = new Set(Object.keys(plan.tiers));

assert.equal(plan.targetCaseCount, 25);
assert.equal(Object.values(plan.tiers).reduce((sum, count) => sum + count, 0), 25);
assert.equal(manifest.datasetId, plan.id);
assert.ok(['draft', 'frozen'].includes(manifest.status));
assert.equal(manifest.selectionFrozenBeforeDocking, true);
assert.ok(Array.isArray(manifest.cases) && manifest.cases.length === plan.targetCaseCount);
assert.equal(new Set(manifest.cases.map((entry) => entry.id)).size, manifest.cases.length,
  'case IDs must be unique');
for (const [tier, expected] of Object.entries(plan.tiers))
  assert.equal(manifest.cases.filter((entry) => entry.tier === tier).length, expected,
    `${tier} must contain ${expected} cases`);
const targetCounts = new Map();
for (const entry of manifest.cases)
  targetCounts.set(entry.proteinTarget, (targetCounts.get(entry.proteinTarget) || 0) + 1);
assert.ok(targetCounts.size >= plan.diversity.minimumProteinTargets);
assert.ok(Math.max(...targetCounts.values()) <= plan.diversity.maximumCasesPerProteinTarget);

const sourceFiles = {
  studyPlanSha256:'study-plan.v0.1.json',
  curationSha256:'curation.v0.1.json',
  curationValidationSha256:'curation-validation.v0.1.json',
  fixtureValidationSha256:'fixture-validation.v0.1.json',
  atomMapsSha256:'atom-maps.v0.1.json',
  interactionScanSha256:'interaction-scan.v0.1.json',
};
for (const [field, file] of Object.entries(sourceFiles))
  assert.equal(manifest.sourceHashes[field], hash(await readFile(path.join(root, file))),
    `${field} does not match ${file}`);
assert.equal(manifest.sourceHashes.runInputSha256, hash(runInputBytes));
assert.equal(runInput.datasetId, manifest.datasetId);
assert.deepEqual(runInput.cases.map((entry) => entry.id), manifest.cases.map((entry) => entry.id));
const runInputByCase = new Map(runInput.cases.map((entry) => [entry.id, entry]));

async function assertAsset(file, expectedHash, label) {
  assert.match(expectedHash, sha256, `${label}: invalid SHA-256`);
  assert.equal(hash(await readFile(path.join(root, file))), expectedHash,
    `${label}: source asset hash mismatch`);
}

for (const entry of manifest.cases) {
  assert.match(entry.id, /^[a-z0-9][a-z0-9-]+$/);
  assert.ok(tiers.has(entry.tier), `${entry.id}: unknown tier`);
  assert.ok(entry.proteinTarget, `${entry.id}: protein target is required`);
  assert.match(entry.reference.pdbId, /^[0-9][A-Za-z0-9]{3}$/);
  assert.ok(entry.reference.ligandComponentId);
  assert.match(entry.reference.coordinateSha256, sha256);
  assert.match(entry.reference.ccdSha256, sha256);
  await assertAsset(entry.reference.coordinateFile, entry.reference.coordinateSha256,
    `${entry.id} reference coordinates`);
  await assertAsset(entry.reference.ccdFile, entry.reference.ccdSha256,
    `${entry.id} reference CCD`);
  assert.ok(entry.transformation.recordedEditRequired,
    `${entry.id}: graph edit lineage must be recorded`);
  assert.equal(entry.posePropagationMap.source, 'atom-maps.v0.1.json');
  assert.equal(entry.posePropagationMap.commonAtoms.length,
    entry.posePropagationMap.commonHeavyAtoms,
  `${entry.id}: common-atom map size mismatch`);
  assert.equal(entry.posePropagationMap.commonHeavyAtoms
    + entry.posePropagationMap.deletedReferenceAtoms.length,
  entry.posePropagationMap.referenceHeavyAtoms, `${entry.id}: reference graph map is incomplete`);
  assert.equal(entry.posePropagationMap.commonHeavyAtoms
    + entry.posePropagationMap.addedProductAtoms.length,
  entry.posePropagationMap.productHeavyAtoms, `${entry.id}: product graph map is incomplete`);
  assert.ok(entry.posePropagationMap.commonAtoms.every((atom) =>
    Array.isArray(atom.referencePointAngstrom) && atom.referencePointAngstrom.length === 3),
  `${entry.id}: common atoms require reference-pose coordinates`);
  assert.ok(entry.interactionHypotheses.length,
    `${entry.id}: at least one interaction hypothesis is required`);
  assert.equal(entry.interactionHypotheses[0].kind, 'fixed-common-core');
  const targetContacts = entry.interactionHypotheses.filter((hypothesis) =>
    hypothesis.kind === 'hydrogen-bond' && hypothesis.targetFeature);
  const runCase = runInputByCase.get(entry.id);
  assert.ok(runCase && !Object.hasOwn(runCase, 'groundTruth') && !Object.hasOwn(runCase, 'result'),
    `${entry.id}: run input must exclude ground truth and results`);
  assert.equal(entry.status === 'preparation-blocked', Boolean(entry.preparation.blockers.length));
  assert.equal(entry.protocol.id, plan.protocol.id);
  assert.equal(entry.protocol.version, plan.protocol.version);
  assert.deepEqual(entry.protocol.seeds, plan.protocol.repeatSeeds);
  if (entry.tier === 'paired-crystal') {
    assert.equal(entry.groundTruth.analogueCrystalAvailable, true);
    assert.equal(entry.groundTruth.accuracyMetricsAllowed, true);
    assert.match(entry.groundTruth.coordinateSha256, sha256);
    await assertAsset(entry.groundTruth.coordinateFile, entry.groundTruth.coordinateSha256,
      `${entry.id} hidden analogue coordinates`);
    await assertAsset(entry.product.ccdFile, entry.product.ccdSha256,
      `${entry.id} product CCD`);
    assert.equal(entry.groundTruth.withheldFromRunInput, true);
    assert.equal(entry.groundTruth.atomMappingStatus,
      'frozen-product-index-to-analogue-ccd-atom-name');
    assert.equal(entry.groundTruth.scoringAtomMap.length, entry.posePropagationMap.productHeavyAtoms);
    assert.deepEqual(entry.groundTruth.scoringAtomMap.map((atom) => atom.productAtomIndex),
      Array.from({ length:entry.posePropagationMap.productHeavyAtoms }, (_, index) => index));
    assert.ok(entry.groundTruth.scoringAtomMap.every((atom) => atom.analogueAtomName));
    const serializedRunCase = JSON.stringify(runCase);
    assert.ok(!serializedRunCase.includes(entry.groundTruth.coordinateFile)
      && !serializedRunCase.includes(entry.groundTruth.coordinateSha256),
    `${entry.id}: hidden analogue coordinates leaked into pose-generation input`);
  } else {
    assert.equal(entry.groundTruth.accuracyMetricsAllowed, false,
      `${entry.id}: only paired crystals may report accuracy`);
    assert.ok(targetContacts.length, `${entry.id}: the transformed reference feature has no required contact`);
    assert.match(entry.product.inputSmilesSha256, sha256);
    assert.ok(entry.product.canonicalSmiles && entry.product.heavyAtoms >= 5);
    if (entry.tier === 'adversarial-negative') {
      assert.equal(entry.expectedOutcome, 'reference-contact-unavailable');
      assert.ok(targetContacts.every((hypothesis) => hypothesis.expectedTransfer === 'unavailable'));
    } else {
      assert.ok(targetContacts.every((hypothesis) => hypothesis.expectedTransfer === 'role-compatible'));
    }
  }
}

if (manifest.status === 'frozen') {
  assert.equal(manifest.cases.length, plan.targetCaseCount);
  for (const [tier, expected] of Object.entries(plan.tiers))
    assert.equal(manifest.cases.filter((entry) => entry.tier === tier).length, expected,
      `frozen tier ${tier} must contain ${expected} cases`);
  for (const entry of manifest.cases.filter((caseEntry) => caseEntry.tier === 'paired-crystal'))
    assert.ok(!entry.groundTruth.atomMappingStatus.startsWith('pending-'),
      `${entry.id}: a frozen paired case requires its hidden-answer atom map`);
}

console.log(`Bioisostere benchmark manifest: PASS (${manifest.cases.length}/${plan.targetCaseCount} registered)`);
