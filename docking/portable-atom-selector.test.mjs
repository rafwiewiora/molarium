import assert from 'node:assert/strict';
import { resolveLigandAtomSelector, resolveReceptorAtomSelector, resolveLigandAxisArguments } from './portable-atom-selector.mjs';

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

const axisNames = ['N7','C12','C15','CX4','CX5','CX15','CX16'];
const fresh = { atoms:axisNames.map((atomName, index) => ({ atomName,
  designAtomId:`fresh-session:${index}`, x:index, y:0, z:0 })) };
const freshComponents = [{ id:'heterogen:A:1104::AWW', kind:'ligand',
  atomIndices:axisNames.map((_, index) => index) }];
const pair = (...names) => names.map((atomName) => ({ componentId:'heterogen:A:1104::AWW', atomName }));
const args = { axisAtomSelectors:pair('C12','C15'),
  upstreamAxisAtomSelectors:pair('N7','C12'),
  coupledAxisAtomSelectors:[pair('CX4','CX5'),pair('CX15','CX16')],
  upstreamRotationRangeDegrees:[0,60], designerPrimaryRotationDegrees:150 };
const original = structuredClone({ fresh, args });
const resolved = resolveLigandAxisArguments({ molecule:fresh, components:freshComponents, args });
assert.deepEqual(resolved.axisAtomIds, ['fresh-session:1','fresh-session:2']);
assert.deepEqual(resolved.upstreamAxisAtomIds, ['fresh-session:0','fresh-session:1']);
assert.deepEqual(resolved.coupledAxisAtomIds, [['fresh-session:3','fresh-session:4'],['fresh-session:5','fresh-session:6']]);
assert(!Object.hasOwn(resolved, 'axisAtomSelectors'));
assert.equal(resolved.designerPrimaryRotationDegrees, 150);
assert.deepEqual({ fresh, args }, original, 'selector resolution cannot mutate coordinates or caller arguments');
assert.throws(() => resolveLigandAxisArguments({ molecule:fresh, components:freshComponents,
  args:{ ...args, axisAtomIds:['old:1','old:2'] } }), /not both/);
assert.throws(() => resolveLigandAxisArguments({ molecule:fresh, components:freshComponents,
  args:{ axisAtomSelectors:pair('MISSING','C12') } }), /found 0/);
assert.throws(() => resolveLigandAxisArguments({ molecule:fresh,
  components:[{ ...freshComponents[0], atomIndices:[1,1,2] }],
  args:{ axisAtomSelectors:pair('C12','C15') } }), /found 2/);
console.log('portable atom selector tests passed');
