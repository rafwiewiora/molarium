import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = async (name) => {
  const bytes = await readFile(path.join(root, name));
  return { bytes, value:JSON.parse(bytes) };
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const curation = await read('curation.v0.1.json');
const curationValidation = await read('curation-validation.v0.1.json');
const fixtures = await read('fixture-validation.v0.1.json');
const maps = await read('atom-maps.v0.1.json');

assert.equal(maps.value.schemaVersion, 1);
assert.equal(maps.value.datasetId, curation.value.datasetId);
assert.equal(maps.value.curationSha256, sha256(curation.bytes));
assert.equal(maps.value.curationValidationSha256, sha256(curationValidation.bytes));
assert.equal(maps.value.fixtureValidationSha256, sha256(fixtures.bytes));
assert.equal(maps.value.containsHiddenAnalogueCoordinates, false);
assert.equal(maps.value.cases.length, curation.value.cases.length);
assert.equal(new Set(maps.value.cases.map(({ caseId }) => caseId)).size, maps.value.cases.length);

const curationByCase = new Map(curation.value.cases.map((entry) => [entry.id, entry]));
const fixtureByCase = new Map(fixtures.value.cases.map((entry) => [entry.caseId, entry]));
const completeRange = (size) => Array.from({ length:size }, (_, index) => index);
const sortedNumbers = (values) => [...values].sort((first, second) => first - second);
const assertPoint = (point, label) => {
  assert.ok(Array.isArray(point) && point.length === 3 && point.every(Number.isFinite),
    `${label}: expected a finite three-dimensional reference point`);
};

for (const record of maps.value.cases) {
  const curationCase = curationByCase.get(record.caseId);
  const fixture = fixtureByCase.get(record.caseId);
  assert.ok(curationCase && fixture, `${record.caseId}: unknown case`);
  assert.ok(Number.isInteger(record.referenceHeavyAtoms) && record.referenceHeavyAtoms > 0);
  assert.ok(Number.isInteger(record.productHeavyAtoms) && record.productHeavyAtoms > 0);
  assert.equal(record.commonHeavyAtoms, record.commonAtoms.length);
  assert.equal(record.mcs.atoms, record.commonHeavyAtoms);
  assert.equal(record.deletedReferenceAtoms.length,
    record.referenceHeavyAtoms - record.commonHeavyAtoms);
  assert.equal(record.addedProductAtoms.length,
    record.productHeavyAtoms - record.commonHeavyAtoms);
  assert.ok(record.mcs.referenceMatchCount >= 1 && record.mcs.productMatchCount >= 1);
  assert.equal(record.mcs.selectionRule,
    'lexicographically first symmetry-unique complete-ring MCS match');
  if (record.mcs.timedOut)
    assert.equal(record.mcs.preAuditedExpectedAtoms, record.commonHeavyAtoms,
      `${record.caseId}: timed-out MCS requires a pre-audited atom count`);

  const commonReferenceIndices = record.commonAtoms.map((entry) => entry.referenceAtomIndex);
  const commonProductIndices = record.commonAtoms.map((entry) => entry.productAtomIndex);
  const deletedReferenceIndices = record.deletedReferenceAtoms.map((entry) =>
    entry.referenceAtomIndex);
  const addedProductIndices = record.addedProductAtoms.map((entry) => entry.productAtomIndex);
  assert.deepEqual(sortedNumbers([...commonReferenceIndices, ...deletedReferenceIndices]),
    completeRange(record.referenceHeavyAtoms), `${record.caseId}: reference partition is incomplete`);
  assert.deepEqual(sortedNumbers([...commonProductIndices, ...addedProductIndices]),
    completeRange(record.productHeavyAtoms), `${record.caseId}: product partition is incomplete`);
  assert.equal(new Set(commonReferenceIndices).size, commonReferenceIndices.length);
  assert.equal(new Set(commonProductIndices).size, commonProductIndices.length);
  assert.equal(new Set(deletedReferenceIndices).size, deletedReferenceIndices.length);
  assert.equal(new Set(addedProductIndices).size, addedProductIndices.length);

  const allReferenceAtoms = [...record.commonAtoms, ...record.deletedReferenceAtoms];
  assert.equal(new Set(allReferenceAtoms.map((entry) => entry.referenceAtomName)).size,
    record.referenceHeavyAtoms, `${record.caseId}: reference atom names must be unique`);
  for (const atom of allReferenceAtoms)
    assertPoint(atom.referencePointAngstrom, `${record.caseId}/${atom.referenceAtomName}`);
  for (const atom of record.commonAtoms)
    assert.match(atom.element, /^[A-Z][a-z]?$/, `${record.caseId}: invalid common element`);
  for (const atom of record.addedProductAtoms)
    assert.match(atom.element, /^[A-Z][a-z]?$/, `${record.caseId}: invalid added element`);

  const commonNames = new Set(record.commonAtoms.map((entry) => entry.referenceAtomName));
  const deletedNames = new Set(record.deletedReferenceAtoms.map((entry) => entry.referenceAtomName));
  const commonProduct = new Set(commonProductIndices);
  const addedProduct = new Set(addedProductIndices);
  for (const boundary of record.referenceBoundary) {
    assert.ok(commonNames.has(boundary.commonAtomName),
      `${record.caseId}: reference boundary common atom is not common`);
    assert.ok(deletedNames.has(boundary.editedAtomName),
      `${record.caseId}: reference boundary edited atom is not deleted`);
  }
  for (const boundary of record.productBoundary) {
    assert.ok(commonProduct.has(boundary.commonProductAtomIndex),
      `${record.caseId}: product boundary common atom is not common`);
    assert.ok(addedProduct.has(boundary.editedProductAtomIndex),
      `${record.caseId}: product boundary edited atom is not added`);
  }

  const requestedFeatures = curationCase.transformation.referenceFeatureAtomNames || [];
  assert.deepEqual(record.targetFeatureDisposition.map((entry) => entry.referenceAtomName),
    requestedFeatures, `${record.caseId}: target feature order or identity changed`);
  for (const target of record.targetFeatureDisposition) {
    assert.ok(commonNames.has(target.referenceAtomName) || deletedNames.has(target.referenceAtomName),
      `${record.caseId}: target feature is absent from the reference graph`);
    assert.equal(target.disposition, commonNames.has(target.referenceAtomName)
      ? 'preserved-exact' : 'deleted-requires-role-compatible-remap');
  }
  if (curationCase.tier === 'adversarial-negative')
    assert.ok(record.targetFeatureDisposition.every((entry) =>
      entry.disposition === 'deleted-requires-role-compatible-remap'),
    `${record.caseId}: negative control retained a target feature`);

  if (curationCase.tier === 'paired-crystal') {
    const namedProductAtoms = [...record.commonAtoms, ...record.addedProductAtoms]
      .map((entry) => entry.productAtomName);
    assert.ok(namedProductAtoms.every(Boolean),
      `${record.caseId}: paired scoring map lacks analogue CCD atom names`);
    assert.equal(new Set(namedProductAtoms).size, record.productHeavyAtoms,
      `${record.caseId}: paired scoring map has duplicate analogue CCD atom names`);
  }
  assert.ok(record.mappedProductSmiles && !record.mappedProductSmiles.includes('.'));
}

const serialized = JSON.stringify(maps.value);
assert.ok(!serialized.includes('analoguePointAngstrom')
  && !serialized.includes('productPointAngstrom')
  && !serialized.includes('analogueCrystalCoordinates'),
'atom-map input must not contain hidden analogue coordinates');

console.log(`Bioisostere atom maps: PASS (${maps.value.cases.length} cases; ${maps.value.generator.rdkitVersion})`);
