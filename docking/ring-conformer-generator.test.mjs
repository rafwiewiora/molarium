import assert from 'node:assert/strict';
import { CLOSED_RING_CONFORMER_DEFAULTS,
  generateClosedRingConformers } from './ring-conformer-generator.mjs';

const atoms = [
  { element:'C' }, { element:'C' }, { element:'C' },
  ...Array.from({ length:6 }, () => ({ element:'C' })), { element:'O' },
];
const molecule = { atoms, bonds:[
  { a:0,b:1,order:1 }, { a:0,b:2,order:1 }, { a:2,b:6,order:1 },
  { a:3,b:4,order:1 }, { a:4,b:5,order:1 }, { a:5,b:6,order:1 },
  { a:6,b:7,order:1 }, { a:7,b:8,order:1 }, { a:8,b:3,order:1 },
  { a:3,b:9,order:2 },
] };
const planar = new Float64Array([
  7,0,0, 7,1,0, 5.8,0,0,
  2.4,0,0, 3.1,.866,0, 4.1,.866,0, 4.6,0,0,
  4.1,-.866,0, 3.1,-.866,0, 1.2,0,0,
]);
const chair = new Float64Array(planar);
const chairPoints = {
  3:[2.4,0,.55], 4:[3.1,.866,-.35], 5:[4.1,.866,.35], 6:[4.6,0,0],
  7:[4.1,-.866,-.35], 8:[3.1,-.866,.35],
};
Object.entries(chairPoints).forEach(([atom, coordinates]) =>
  chair.set(coordinates, Number(atom) * 3));
const carbonylDirection = [-1.4, 0, 1.1];
const directionLength = Math.hypot(...carbonylDirection);
chair.set(carbonylDirection.map((value, axis) => chair[9 + axis]
  + 1.2 * value / directionLength), 27);
const invalidCarbonyl = new Float64Array(chair);
const v4 = [0,1,2].map((axis) => chair[12 + axis] - chair[9 + axis]);
const v8 = [0,1,2].map((axis) => chair[24 + axis] - chair[9 + axis]);
const normal = [v4[1] * v8[2] - v4[2] * v8[1],
  v4[2] * v8[0] - v4[0] * v8[2], v4[0] * v8[1] - v4[1] * v8[0]];
const normalLength = Math.hypot(...normal);
for (let axis = 0; axis < 3; axis++) invalidCarbonyl[27 + axis] += .5 * normal[axis] / normalLength;

const target = Array.from(chair.slice(27, 30));
const result = await generateClosedRingConformers({ molecule, initialPositions:planar,
  referencePositions:planar, coreAtomPairs:[[0,0],[1,1],[2,2]],
  requestedConformers:3, seed:811,
  generateConformers:async ({ requestedConformers, seed, method }) => {
    assert.equal(requestedConformers, 3); assert.equal(seed, 811);
    assert.equal(method, CLOSED_RING_CONFORMER_DEFAULTS.method);
    return { conformers:[planar, chair, invalidCarbonyl] };
  },
  scorePose:(positions) => {
    const error = Math.hypot(...[0,1,2].map((axis) => positions[27 + axis] - target[axis]));
    return { objectiveKcalMol:error ** 2, feasible:error < .1 };
  } });
assert.equal(result.method, 'molarium-closed-ring-conformer-generator/v1');
assert.equal(result.backendConformerCount, 3);
assert.equal(result.acceptedConformerCount, 2);
assert.equal(result.rejectedConformerCount, 1);
assert.equal(result.selected.evaluation.feasible, true);
assert.equal(result.selected.backendIndex, 1,
  'restraint scoring chooses the valid chair that presents the carbonyl at the target');
assert.equal(result.rejected[0].reason, 'geometry-gate');
assert.equal(result.rejected[0].carbonylPlanarity.valid, false,
  'an out-of-plane carbonyl is rejected before restraint ranking');
for (const atom of [0,1,2]) assert.deepEqual(
  Array.from(result.selected.positions.slice(atom * 3, atom * 3 + 3)),
  Array.from(planar.slice(atom * 3, atom * 3 + 3)), 'fixed scaffold remains bitwise exact');

const stereoMolecule = { atoms:[
  ...Array.from({ length:7 }, () => ({ element:'C' })),
  { element:'H' }, { element:'F' }, { element:'Cl' },
  { element:'Si' }, { element:'P' }, { element:'S' },
], bonds:[
  { a:0,b:1,order:1 }, { a:1,b:2,order:1 }, { a:2,b:3,order:1 },
  { a:3,b:4,order:1 }, { a:4,b:5,order:1 }, { a:5,b:0,order:1 },
  { a:0,b:6,order:1 }, { a:6,b:7,order:1 }, { a:6,b:8,order:1 }, { a:6,b:9,order:1 },
  { a:3,b:10,order:1 }, { a:10,b:11,order:1 }, { a:10,b:12,order:1 },
] };
const stereo = new Float64Array([
  1,0,0, .5,.866,0, -.5,.866,0, -1,0,0, -.5,-.866,0, .5,-.866,0,
  2,0,.2, 2.5,.4,1, 2.5,-.8,0, 2.3,.5,-1,
  -2.2,0,0, -3,1,0, -3,-1,.4,
]);
const inverted = new Float64Array(stereo);
// Swapping two substituent coordinates reverses the configured handedness.
const hydrogenPosition = Array.from(stereo.slice(21,24));
const fluorinePosition = Array.from(stereo.slice(24,27));
inverted.set(fluorinePosition, 21); inverted.set(hydrogenPosition, 24);
const stereoResult = await generateClosedRingConformers({ molecule:stereoMolecule,
  initialPositions:stereo, referencePositions:stereo,
  coreAtomPairs:[[10,10],[11,11],[12,12]], requestedConformers:2,
  minimumDistinctRingRmsdAngstrom:0,
  generateConformers:async () => [stereo, inverted], scorePose:() => 0 });
assert.equal(stereoResult.configuredStereocenterCount, 1);
assert.equal(stereoResult.acceptedConformerCount, 1);
assert.equal(stereoResult.rejectedConformerCount, 1);
assert.equal(stereoResult.rejected[0].stereochemistry.valid, false,
  'a backend candidate that inverts a configured center is rejected');

await assert.rejects(() => generateClosedRingConformers({ molecule,
  initialPositions:planar, referencePositions:planar, coreAtomPairs:[[0,0],[1,1],[2,2]] }),
/backend callback/);

console.log('Molarium closed-ring conformer generator: PASS');
