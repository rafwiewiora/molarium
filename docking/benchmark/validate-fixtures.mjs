import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(root, '../..');
const fixtureRoot = path.join(root, 'fixtures');
const require = createRequire(import.meta.url);
const initRDKitModule = require(path.join(repositoryRoot, 'rdkit/dist/RDKit_minimal.js'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const curationBytes = await readFile(path.join(root, 'curation.v0.1.json'));
const curation = JSON.parse(curationBytes);
const index = JSON.parse(await readFile(path.join(fixtureRoot, 'index.v0.1.json')));

assert.equal(index.datasetId, curation.datasetId);
assert.equal(index.curationSha256, sha256(curationBytes));
const expectedPdbIds = new Set(curation.cases.flatMap((entry) =>
  [entry.reference?.pdbId, entry.analogue?.pdbId].filter(Boolean)));
const expectedComponentIds = new Set(curation.cases.flatMap((entry) =>
  [entry.reference?.componentId, entry.analogue?.componentId].filter(Boolean)));
assert.equal(index.pdbAssets.length, expectedPdbIds.size);
assert.equal(index.ccdAssets.length, expectedComponentIds.size);

const RDKit = await initRDKitModule({
  locateFile:(name) => path.join(repositoryRoot, 'rdkit/dist', name),
});
const pdbAssets = new Map();
for (const asset of index.pdbAssets) {
  const bytes = await readFile(path.join(fixtureRoot, asset.file));
  assert.equal(sha256(bytes), asset.sha256, `${asset.pdbId}: PDB hash mismatch`);
  assert.equal(bytes.length, asset.bytes, `${asset.pdbId}: PDB byte count mismatch`);
  pdbAssets.set(asset.pdbId, asset);
}

const ccdAssets = new Map();
for (const asset of index.ccdAssets) {
  const bytes = await readFile(path.join(fixtureRoot, asset.file));
  assert.equal(sha256(bytes), asset.sha256, `${asset.componentId}: CCD hash mismatch`);
  assert.equal(bytes.length, asset.bytes, `${asset.componentId}: CCD byte count mismatch`);
  const molecule = RDKit.get_mol(asset.smiles, JSON.stringify({ sanitize:true, removeHs:false }));
  assert.ok(molecule, `${asset.componentId}: RDKit rejected the RCSB CCD SMILES`);
  try {
    const descriptors = JSON.parse(molecule.get_descriptors());
    assert.equal(descriptors.NumHeavyAtoms, asset.heavyAtomCount,
      `${asset.componentId}: CCD SMILES and atom table disagree`);
    ccdAssets.set(asset.componentId, {
      ...asset,
      canonicalSmiles:molecule.get_smiles(),
      hBondAcceptors:descriptors.NumHBA,
      hBondDonors:descriptors.NumHBD,
    });
  } finally {
    molecule.delete();
  }
}

function selectInstance(pdbId, componentId) {
  const pdb = pdbAssets.get(pdbId);
  const ccd = ccdAssets.get(componentId);
  assert.ok(pdb && ccd, `${pdbId}/${componentId}: fixture is absent`);
  const candidates = pdb.requiredComponents[componentId]?.instances || [];
  assert.ok(candidates.length, `${pdbId}/${componentId}: no ligand instances`);
  const complete = candidates.filter((entry) => entry.uniqueAtomNames === ccd.heavyAtomCount);
  assert.ok(complete.length, `${pdbId}/${componentId}: no complete ligand instance`);
  const selected = complete.slice().sort((first, second) =>
    first.model - second.model || first.chain.localeCompare(second.chain)
      || first.residueNumber - second.residueNumber
      || first.insertionCode.localeCompare(second.insertionCode))[0];
  return {
    model:selected.model,
    chain:selected.chain,
    residueNumber:selected.residueNumber,
    insertionCode:selected.insertionCode,
    alternateLocation:selected.alternateLocations.includes('A') ? 'A' : '',
    selectionRule:'complete-instance; lowest model, chain, residue and insertion code; altloc A when present',
    observedHeavyAtoms:selected.uniqueAtomNames,
    ccdHeavyAtoms:ccd.heavyAtomCount,
  };
}

const cases = curation.cases.map((entry) => {
  const referencePdb = pdbAssets.get(entry.reference.pdbId);
  const referenceCcd = ccdAssets.get(entry.reference.componentId);
  const result = {
    caseId:entry.id,
    reference:{
      pdbId:entry.reference.pdbId,
      componentId:entry.reference.componentId,
      coordinateFile:`fixtures/${referencePdb.file}`,
      coordinateSha256:referencePdb.sha256,
      ccdFile:`fixtures/${referenceCcd.file}`,
      ccdSha256:referenceCcd.sha256,
      canonicalSmiles:referenceCcd.canonicalSmiles,
      selection:selectInstance(entry.reference.pdbId, entry.reference.componentId),
    },
  };
  if (entry.analogue) {
    const analoguePdb = pdbAssets.get(entry.analogue.pdbId);
    const analogueCcd = ccdAssets.get(entry.analogue.componentId);
    result.analogue = {
      pdbId:entry.analogue.pdbId,
      componentId:entry.analogue.componentId,
      coordinateFile:`fixtures/${analoguePdb.file}`,
      coordinateSha256:analoguePdb.sha256,
      ccdFile:`fixtures/${analogueCcd.file}`,
      ccdSha256:analogueCcd.sha256,
      canonicalSmiles:analogueCcd.canonicalSmiles,
      selection:selectInstance(entry.analogue.pdbId, entry.analogue.componentId),
    };
  }
  return result;
});

const report = {
  schemaVersion:1,
  datasetId:curation.datasetId,
  curationSha256:sha256(curationBytes),
  fixtureIndexSha256:sha256(await readFile(path.join(fixtureRoot, 'index.v0.1.json'))),
  rdkitVersion:RDKit.version(),
  pdbCount:pdbAssets.size,
  ccdCount:ccdAssets.size,
  cases,
};
if (process.argv.includes('--write'))
  await writeFile(path.join(root, 'fixture-validation.v0.1.json'), `${JSON.stringify(report, null, 2)}\n`);

console.log(`Bioisostere fixtures: PASS (${pdbAssets.size} PDB, ${ccdAssets.size} CCD, ${cases.length} cases; RDKit ${report.rdkitVersion})`);
