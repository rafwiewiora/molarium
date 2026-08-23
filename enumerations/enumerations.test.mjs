import assert from 'node:assert/strict';
import { executeEnumerationPlan, validateEnumerationPlan } from './action-plan.mjs';
import { readEnumerationCatalogue, planSha256 } from './catalogue.mjs';
import { editDifficulty } from './edit-difficulty.mjs';
import { assessEnumeratedPose } from './pose-assessment.mjs';
import { buildHighDisruptionPanelManifest } from './high-disruption-panel.mjs';
import { validatePanelManifest } from '../docking/benchmark/7kpa-two-terminus-panel.mjs';

const { catalogue } = await readEnumerationCatalogue();
assert.deepEqual(catalogue.transformations.map((entry) => entry.id), [
  'pyrrolidone-to-pyrazole',
  'pyrrolidone-to-tetrahydropyran',
  'phenyl-pyrrolidone-to-spiro-ketone',
]);
assert.equal(new Set(catalogue.transformations.map(planSha256)).size, 3);
const panel = await buildHighDisruptionPanelManifest();
assert.deepEqual(await validatePanelManifest(panel), {
  cases:3, loci:{ 'linker-pyrrolidone':1, pyrrolidone:2 },
});
assert.throws(() => validateEnumerationPlan({ operations:[{ op:'finish' }] }), /empty/);
assert.throws(() => validateEnumerationPlan({ operations:[{ op:'internalCallback' }] }), /unsupported/);
assert.throws(() => validateEnumerationPlan({ operations:[
  { op:'addAtom', attachedTo:'A', element:'H', as:'bad' }, { op:'finish' },
] }), /supported heavy atom/);
assert.throws(() => validateEnumerationPlan({ operations:[
  { op:'setBond', atoms:['A','B'], order:4 }, { op:'finish' },
] }), /order must be/);
assert.throws(() => validateEnumerationPlan({ operations:[
  { op:'setAtom', atom:'A', element:'C', formalCharge:1.5 }, { op:'finish' },
] }), /formalCharge/);

const reference = {
  atoms:[
    { atomId:'a', element:'C' }, { atomId:'b', element:'N' },
    { atomId:'c', element:'C' }, { atomId:'h', element:'H' },
  ],
  bonds:[
    { atomIds:['a','b'], order:1 }, { atomIds:['b','c'], order:1 },
    { atomIds:['c','a'], order:1 }, { atomIds:['a','h'], order:1 },
  ],
};
assert.equal(editDifficulty(reference, structuredClone(reference)).score, 0);
const product = {
  atoms:[{ atomId:'a', element:'C' }, { atomId:'b', element:'O' },
    { atomId:'d', element:'C' }],
  bonds:[{ atomIds:['a','b'], order:2 }, { atomIds:['b','d'], order:1 }],
};
const difficult = editDifficulty(reference, product, { contactRemapCount:1 });
assert(difficult.score > 0);
assert.deepEqual(difficult.components, {
  referenceHeavyAtoms:3, productHeavyAtoms:3, retainedHeavyAtoms:2,
  addedHeavyAtoms:1, deletedHeavyAtoms:1, elementSubstitutions:1,
  referenceHeavyBonds:3, productHeavyBonds:2, addedHeavyBonds:1,
  deletedHeavyBonds:2, bondOrderChanges:1, referenceCycleRank:1,
  productCycleRank:0, cycleRankChange:1, contactRemapCount:1,
  weightedChanges:12.75, affectedHeavyAtoms:4, changedHeavyBonds:4,
  globalNormalizer:11, localNormalizer:14, globalScore:100, localScore:91.07,
});
const permuted = { atoms:[...product.atoms].reverse(), bonds:[...product.bonds].reverse() };
assert.deepEqual(editDifficulty(reference, permuted, { contactRemapCount:1 }), difficult,
  'difficulty is invariant to atom and bond serialization');
assert.deepEqual(assessEnumeratedPose({ selectedFeasible:true, selectedPhysicalComponents:{
  stericClashes:11, lennardJonesKcalMol:1870,
} }).flags, ['absolute-steric-clashes','absolute-lennard-jones-clash']);
assert.equal(assessEnumeratedPose({ selectedFeasible:false, selectedPhysicalComponents:{
  stericClashes:0, lennardJonesKcalMol:-5,
} }).verdict, 'contact-infeasible');

const calls = [];
let atoms = [
  { atomId:'id-a', atomName:'A', element:'C' },
  { atomId:'id-b', atomName:'B', element:'C' },
];
const api = { async execute({ action, args = {} }) {
  calls.push({ action, args });
  if (action === 'session.inspect') return { result:{ atoms, bonds:[] } };
  if (action === 'chemistry.addAtom') {
    atoms = [...atoms, { atomId:'id-new', atomName:null, element:args.element }];
    return { action, result:{ addedAtomId:'id-new' } };
  }
  return { action, result:{} };
} };
const execution = await executeEnumerationPlan(api, { operations:[
  { op:'addAtom', attachedTo:'A', element:'O', as:'bridge' },
  { op:'createBond', atoms:['bridge','B'], order:1 },
  { op:'finish' },
] });
assert.equal(execution.aliases.bridge, 'id-new');
assert(calls.some((call) => call.action === 'chemistry.createBond'
  && call.args.atomIds.join('|') === 'id-new|id-b'));
assert(calls.every((call) => !call.action.startsWith('internal.')));

console.log('Molarium Enumerations: PASS');
