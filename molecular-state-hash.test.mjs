import assert from 'node:assert/strict';
import { MOLECULAR_STATE_HASH_SCHEMA, canonicalMolecularState,
  molecularStateSha256 } from './molecular-state-hash.mjs';

const molecule = { charge:0, multiplicity:1, atoms:[
  { designAtomId:'atom-b', element:'O', formalCharge:0, x:1.2, y:0, z:0,
    atomName:'O1', record:'HETATM', chain:'A', residueName:'LIG', residueIndex:'1' },
  { designAtomId:'atom-a', element:'C', formalCharge:0, x:0, y:0, z:0,
    atomName:'C1', record:'HETATM', chain:'A', residueName:'LIG', residueIndex:'1' },
], bonds:[{ a:0, b:1, order:1 }] };

assert.equal(canonicalMolecularState(molecule).schema, MOLECULAR_STATE_HASH_SCHEMA);
const baseline = await molecularStateSha256(molecule);
const reordered = structuredClone(molecule);
reordered.atoms.reverse(); reordered.bonds = [{ a:1, b:0, order:1 }];
assert.equal(await molecularStateSha256(reordered), baseline,
  'array order and bond direction must not change an identity-anchored state hash');

const moved = structuredClone(molecule); moved.atoms[0].x += 0.01;
assert.notEqual(await molecularStateSha256(moved), baseline, 'coordinates must be guarded');
const rewired = structuredClone(molecule); rewired.bonds[0].order = 2;
assert.notEqual(await molecularStateSha256(rewired), baseline, 'topology must be guarded');
const reidentified = structuredClone(molecule); reidentified.atoms[0].designAtomId = 'atom-c';
assert.notEqual(await molecularStateSha256(reidentified), baseline, 'identity must be guarded');
assert.rejects(() => molecularStateSha256({ ...molecule,
  atoms:molecule.atoms.map(({ designAtomId, ...atom }) => atom) }), /persistent atom identity/);

console.log('Molecular state hash: PASS');
