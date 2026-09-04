import assert from 'node:assert/strict';
import { resolveLigandAtomSelector, resolveReceptorAtomSelector } from './portable-atom-selector.mjs';

const molecule = { atoms:[
  { record:'ATOM', residueName:'TYR', chain:'A', residueIndex:884,
    insertionCode:'', atomName:'O', element:'O', designAtomId:'prepared-copy:tyr884:o' },
  { record:'ATOM', residueName:'TYR', chain:'A', residueIndex:884,
    insertionCode:'', atomName:'OH', element:'O', designAtomId:'prepared-copy:tyr884:oh' },
  { record:'HETATM', residueName:'AWW', chain:'A', residueIndex:1104,
    insertionCode:'', atomName:'OX3', element:'O', designAtomId:'prepared-copy:aww:ox3' },
] };
const components = [
  { id:'protein:A', kind:'protein', atomIndices:[0, 1] },
  { id:'heterogen:A:1104::AWW', kind:'ligand', atomIndices:[2] },
];

assert.equal(resolveLigandAtomSelector({ molecule, components,
  selector:{ componentId:'heterogen:A:1104::AWW', atomName:'OX3' } }), 2);
assert.equal(resolveReceptorAtomSelector({ molecule,
  selector:{ residueName:'TYR', chain:'A', residueIndex:884, atomName:'O' } }), 0);
assert.throws(() => resolveReceptorAtomSelector({ molecule,
  selector:{ residueName:'TYR', chain:'A', residueIndex:884, atomName:'O', typo:true } }),
  /Unexpected receptor atom selector/);
assert.throws(() => resolveReceptorAtomSelector({ molecule,
  selector:{ residueName:'TYR', chain:'A', residueIndex:884, atomName:'CZ' } }),
  /found 0/);

console.log('portable atom selector tests passed');
