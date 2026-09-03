import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(root, '../..');
const require = createRequire(import.meta.url);
const initRDKitModule = require(path.join(repositoryRoot, 'rdkit/dist/RDKit_minimal.js'));
const curationPath = path.join(root, 'curation.v0.1.json');
const curationBytes = await readFile(curationPath);
const curation = JSON.parse(curationBytes);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const expectedTiers = { 'paired-crystal':10, prospective:10, 'adversarial-negative':5 };

assert.equal(curation.datasetId, 'molarium-bioisostere-pose-propagation-25');
assert.equal(curation.selectionFrozenBeforeDocking, true);
assert.equal(curation.cases.length, 25);
assert.equal(new Set(curation.cases.map(({ id }) => id)).size, 25, 'case IDs must be unique');

for (const [tier, expected] of Object.entries(expectedTiers))
  assert.equal(curation.cases.filter((entry) => entry.tier === tier).length, expected,
    `${tier} must contain ${expected} cases`);

const targetCounts = new Map();
for (const entry of curation.cases)
  targetCounts.set(entry.proteinTarget, (targetCounts.get(entry.proteinTarget) || 0) + 1);
assert.ok(targetCounts.size >= 8, 'the cohort must cover at least eight protein targets');
assert.ok(Math.max(...targetCounts.values()) <= 3, 'no protein target may contribute more than three cases');

const RDKit = await initRDKitModule({
  locateFile:(name) => path.join(repositoryRoot, 'rdkit/dist', name),
});
const products = [];

for (const entry of curation.cases) {
  assert.match(entry.id, /^[a-z0-9][a-z0-9-]+$/);
  assert.match(entry.reference?.pdbId || '', /^[0-9][A-Za-z0-9]{3}$/);
  assert.match(entry.reference?.componentId || '', /^[A-Za-z0-9]{1,3}$/);
  assert.ok(entry.proteinTarget && entry.transformation?.name && entry.transformation?.class,
    `${entry.id}: target and transformation provenance are required`);

  if (entry.tier === 'paired-crystal') {
    assert.match(entry.analogue?.pdbId || '', /^[0-9][A-Za-z0-9]{3}$/);
    assert.match(entry.analogue?.componentId || '', /^[A-Za-z0-9]{1,3}$/);
    assert.equal(entry.productSmiles, undefined,
      `${entry.id}: paired product must come from the hidden CCD fixture, not a hand-entered graph`);
    continue;
  }

  assert.ok(entry.productSmiles, `${entry.id}: prospective and negative cases require a product graph`);
  assert.ok(Array.isArray(entry.transformation.referenceFeatureAtomNames)
    && entry.transformation.referenceFeatureAtomNames.length,
  `${entry.id}: the pre-registered reference interaction feature is required`);
  const molecule = RDKit.get_mol(entry.productSmiles, JSON.stringify({ sanitize:true, removeHs:false }));
  assert.ok(molecule, `${entry.id}: RDKit rejected product SMILES`);
  try {
    const canonicalSmiles = molecule.get_smiles();
    const descriptors = JSON.parse(molecule.get_descriptors());
    assert.ok(canonicalSmiles && !canonicalSmiles.includes('.'), `${entry.id}: product must be one molecule`);
    assert.ok(descriptors.NumHeavyAtoms >= 5, `${entry.id}: implausibly small product`);
    const intendedRole = entry.transformation.intendedRole || '';
    if (intendedRole.includes('acceptor') && !intendedRole.includes('removal'))
      assert.ok(descriptors.NumHBA > 0, `${entry.id}: intended acceptor product has no perceived HBA`);
    if (intendedRole.includes('donor') && !intendedRole.includes('removal'))
      assert.ok(descriptors.NumHBD > 0, `${entry.id}: intended donor product has no perceived HBD`);
    if (entry.tier === 'adversarial-negative')
      assert.equal(entry.expectedOutcome, 'reference-contact-unavailable');
    products.push({
      caseId:entry.id,
      inputSmilesSha256:sha256(entry.productSmiles),
      canonicalSmiles,
      heavyAtoms:descriptors.NumHeavyAtoms,
      hBondAcceptors:descriptors.NumHBA,
      hBondDonors:descriptors.NumHBD,
      formalCharge:Number(JSON.parse(molecule.get_json()).molecules?.[0]?.atoms
        ?.reduce((sum, atom) => sum + Number(atom.formalCharge || 0), 0) || 0),
    });
  } finally {
    molecule.delete();
  }
}

const report = {
  schemaVersion:1,
  datasetId:curation.datasetId,
  curationSha256:sha256(curationBytes),
  rdkitVersion:RDKit.version(),
  caseCount:curation.cases.length,
  targetCount:targetCounts.size,
  tierCounts:expectedTiers,
  products,
};

if (process.argv.includes('--write'))
  await writeFile(path.join(root, 'curation-validation.v0.1.json'), `${JSON.stringify(report, null, 2)}\n`);

console.log(`Bioisostere curation: PASS (${curation.cases.length} cases, ${targetCounts.size} targets, ${products.length} products; RDKit ${report.rdkitVersion})`);
