import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { applyRegisteredLigandDefinition, serializeRegisteredLigandDefinition,
  validateConnectedMolecularGraph } from
  './registered-ligand-graph.mjs';

const route = JSON.parse(await readFile(new URL(
  './generated/sos1-prospective-campaign.json', import.meta.url), 'utf8'));
const pdb = await readFile(new URL('./generated/sos1-5ove-ligand.pdb', import.meta.url), 'utf8');
const atoms = pdb.split(/\r?\n/).flatMap((line) => {
  if (line.slice(0, 6).trim() !== 'HETATM') return [];
  return [{
    record:'HETATM', serial:Number.parseInt(line.slice(6, 11), 10),
    atomName:line.slice(12, 16).trim(), residueName:line.slice(17, 20).trim(),
    chain:line.slice(21, 22).trim() || 'A', residueIndex:Number.parseInt(line.slice(22, 26), 10),
    insertionCode:line.slice(26, 27).trim(), element:line.slice(76, 78).trim(),
    x:Number(line.slice(30, 38)), y:Number(line.slice(38, 46)), z:Number(line.slice(46, 54)), charge:0,
  }];
});
const raw = { name:'5OVE/AXE raw coordinate fixture', atoms, bonds:[], charge:0,
  source:{ format:'pdb', pdbId:'5OVE' } };
const originalCoordinates = raw.atoms.map(({ x, y, z }) => [x, y, z]);
const installed = applyRegisteredLigandDefinition(raw, {
  residueName:route.hit.ligand, definition:route.hit.ligandDefinition,
});

assert.equal(installed.heavyAtomCount, 27, 'AXE must retain all 27 coordinate-bearing heavy atoms');
assert.equal(installed.bondCount, 30, 'AXE must receive its full registered heavy-atom graph');
assert.equal(installed.connected, true);
assert.equal(installed.coordinateMaximumDisplacement, 0,
  'graph installation must not add or move prospective coordinates');
assert.deepEqual(installed.molecule.atoms.map(({ x, y, z }) => [x, y, z]), originalCoordinates);
assert.deepEqual(installed.locator, {
  residueName:'AXE', chain:'A', residueIndex:1104, insertionCode:'',
});
assert.deepEqual(validateConnectedMolecularGraph({
  atoms:installed.molecule.atoms, bonds:installed.molecule.bonds,
}), { atomCount:27, heavyAtomCount:27, bondCount:30, connected:true });

assert.throws(() => validateConnectedMolecularGraph(raw), /disconnected molecular graph/,
  'raw coordinate fragments must fail closed rather than render as CH4/NH3-like islands');
assert.throws(() => validateConnectedMolecularGraph({
  atoms:[
    { element:'C' }, { element:'C' }, { element:'C' }, { element:'C' }, { element:'C' }, { element:'C' },
  ],
  bonds:[1, 2, 3, 4, 5].map((b) => ({ a:0, b, order:1 })),
}), /unsanitizable C atom/,
'obvious over-valence must fail before an invalid 2D drawing can be emitted');
assert.throws(() => applyRegisteredLigandDefinition({ ...raw,
  atoms:raw.atoms.filter((atom) => atom.atomName !== 'C18') }, {
  residueName:'AXE', definition:route.hit.ligandDefinition,
}), /heavy-atom mapping mismatch/,
'a partial atom-name mapping must not silently install the wrong graph');
assert.throws(() => applyRegisteredLigandDefinition({ ...raw,
  atoms:[...raw.atoms, { ...raw.atoms[0], chain:'B' }] }, {
  residueName:'AXE', definition:route.hit.ligandDefinition,
}), /exactly one residue/,
'an ambiguous residue mapping must fail closed');

const explicitlyLocated = applyRegisteredLigandDefinition({ ...raw,
  atoms:[...raw.atoms, { ...raw.atoms[0], chain:'B' }] }, {
  residueName:'AXE', locator:{ residueName:'AXE', chain:'A', residueIndex:1104,
    insertionCode:'' }, definition:route.hit.ligandDefinition,
});
assert.equal(explicitlyLocated.heavyAtomCount, 27,
  'an explicit locator must select only the requested coordinate ligand');

const bq5Definition = JSON.parse(await readFile(new URL(
  './ligands/bq5-rcsb-ccd.json', import.meta.url), 'utf8'));
assert.equal(createHash('sha256').update(serializeRegisteredLigandDefinition(
  bq5Definition)).digest('hex'), bq5Definition.graphSha256,
'the bundled BQ5 definition must match its semantic graph hash');
assert.equal(createHash('sha256').update(serializeRegisteredLigandDefinition({
  ...bq5Definition, atoms:[...bq5Definition.atoms].reverse(),
  bonds:[...bq5Definition.bonds].reverse(),
})).digest('hex'), bq5Definition.graphSha256,
'the semantic graph hash must not depend on JSON atom or bond ordering');
assert.notEqual(createHash('sha256').update(serializeRegisteredLigandDefinition({
  ...bq5Definition, bonds:bq5Definition.bonds.map((bond, index) =>
    index ? bond : { ...bond, order:1 }),
})).digest('hex'), bq5Definition.graphSha256,
'a changed bond order must not retain the reviewed graph hash');
assert.equal(bq5Definition.atoms.filter((atom) => atom.element !== 'H').length, 16);
assert.equal(bq5Definition.atoms.filter((atom) => atom.element === 'H').length, 15);
assert.equal(bq5Definition.bonds.filter((bond) => {
  const byName = new Map(bq5Definition.atoms.map((atom) => [atom.id, atom]));
  return byName.get(bond.a)?.element !== 'H' && byName.get(bond.b)?.element !== 'H';
}).length, 18);
const pdb6epm = await readFile(new URL(
  '../../outputs/design-history/sos1-preapproval/source/6EPM.pdb', import.meta.url), 'utf8');
const bq5Atoms = pdb6epm.split(/\r?\n/).flatMap((line) => {
  if (line.slice(0, 6).trim() !== 'HETATM' || line.slice(17, 20).trim() !== 'BQ5') return [];
  return [{ record:'HETATM', atomName:line.slice(12, 16).trim(),
    residueName:'BQ5', chain:line.slice(21, 22).trim(),
    residueIndex:Number.parseInt(line.slice(22, 26), 10),
    insertionCode:line.slice(26, 27).trim(), element:line.slice(76, 78).trim(),
    x:Number(line.slice(30, 38)), y:Number(line.slice(38, 46)),
    z:Number(line.slice(46, 54)), charge:0 }];
});
const bq5Coordinates = bq5Atoms.map(({ x, y, z }) => [x, y, z]);
const bq5Installed = applyRegisteredLigandDefinition({ name:'6EPM BQ5', atoms:bq5Atoms,
  bonds:[], charge:0, source:{ format:'pdb', pdbId:'6EPM' } }, {
  locator:{ residueName:'BQ5', chain:'S', residueIndex:1101, insertionCode:'' },
  definition:bq5Definition,
});
assert.equal(bq5Installed.heavyAtomCount, 16);
assert.equal(bq5Installed.bondCount, 18);
assert.equal(bq5Installed.coordinateMaximumDisplacement, 0);
assert.deepEqual(bq5Installed.molecule.atoms.map(({ x, y, z }) => [x, y, z]), bq5Coordinates);

console.log('Registered ligand graph installation: PASS');
