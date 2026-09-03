import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyRegisteredLigandDefinition, validateConnectedMolecularGraph } from
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

console.log('Registered ligand graph installation: PASS');
