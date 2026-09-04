import assert from 'node:assert/strict';
import { registeredFixedAtomMotion, registeredPoseRetentionPlan } from
  './registered-pose-retention.mjs';

const atom = (designAtomId, element, x, y, z) => ({ designAtomId, element, x, y, z });
const referenceLigand = {
  atomIds:['hard-a','hard-b','hard-c','ring-1','ring-2','ring-3','ring-4'],
  positions:Float64Array.from([
    0,0,0, 1,0,0, 0,1,0,
    5,0,0, 6,0,0, 6,1,0, 5,1,0,
  ]),
};
const molecule = { atoms:[
  atom('hard-a','C',0,0,0), atom('hard-b','C',1,0,0), atom('hard-c','N',0,1,0),
  // Product ids are deliberately reversed relative to reference in variant 1.
  atom('new-1','C',5,1,0), atom('new-2','C',6,1,0),
  atom('new-3','C',6,0,0), atom('new-4','C',5,0,0),
] };
const intentId = 'retain-terminal-ring';
const spatialFeatures = [{
  id:'terminal-ring', kind:'conserved-fragment-rmsd', treatment:'soft-restraint',
  required:true, source:'registered-designer-intent', registeredIntentId:intentId,
  restraint:{ required:true, toleranceAngstrom:0.5 },
  mappingVariants:[
    { referenceAtomIds:['ring-1','ring-2','ring-3','ring-4'],
      productAtomIds:['new-1','new-2','new-3','new-4'] },
    { referenceAtomIds:['ring-1','ring-2','ring-3','ring-4'],
      productAtomIds:['new-4','new-3','new-2','new-1'] },
  ],
}];

const retained = registeredPoseRetentionPlan({ molecule, referenceLigand, spatialFeatures });
assert.equal(retained.accepted, true);
assert.equal(retained.features[0].selectedVariantIndex, 1,
  'graph-symmetric variant must minimize raw predecessor-frame RMSD');
assert.equal(retained.features[0].rmsdAngstrom, 0);
assert.equal(retained.features[0].centroidDisplacementAngstrom, 0);
assert.equal(retained.features[0].planeNormalAngleDegrees, 0);
assert.deepEqual(retained.features[0].productAtomIds,
  ['new-1','new-2','new-3','new-4']);
assert.equal(retained.hardAnchor.rmsdAngstrom, 0);
assert.equal(retained.hardAnchor.maxDisplacementAngstrom, 0);
assert.deepEqual(retained.fixedAtomIds,
  ['hard-a','hard-b','hard-c','new-1','new-2','new-3','new-4']);
assert.deepEqual(retained.fixedCoordinatesAngstrom, {
  atomIds:['hard-a','hard-b','hard-c','new-1','new-2','new-3','new-4'],
  positions:[[0,0,0],[1,0,0],[0,1,0],[5,1,0],[6,1,0],[6,0,0],[5,0,0]],
});
const numericallyStable = structuredClone(retained);
numericallyStable.fixedCoordinatesAngstrom.positions[0][0] += 4e-7;
assert.equal(registeredFixedAtomMotion(retained, numericallyStable).accepted, true);
numericallyStable.fixedCoordinatesAngstrom.positions[0][0] += 2e-6;
assert.equal(registeredFixedAtomMotion(retained, numericallyStable).accepted, false);

// Fixed WebGPU coordinates round-trip through float32 storage. At PDB-scale
// coordinate magnitudes that representation change can exceed 1e-6 A even
// though the kernel never moved the atom.
const float32Before = structuredClone(retained);
float32Before.fixedCoordinatesAngstrom.positions[0] =
  [2.929527927295551, -23.28110572094604, 25.397429751258578];
const float32After = structuredClone(float32Before);
float32After.fixedCoordinatesAngstrom.positions =
  float32Before.fixedCoordinatesAngstrom.positions.map((position) =>
    position.map((value) => Math.fround(value / 10) * 10));
const float32Motion = registeredFixedAtomMotion(float32Before, float32After);
assert(float32Motion.maximumDisplacementAngstrom > 1e-6);
assert.equal(float32Motion.maximumFloat32RoundTripResidualAngstrom, 0);
assert.equal(float32Motion.accepted, true);
float32After.fixedCoordinatesAngstrom.positions[0][0] += 2e-6;
assert.equal(registeredFixedAtomMotion(float32Before, float32After).accepted, false,
  'motion beyond the exact float32-nm round trip must still fail');

const drifted = structuredClone(molecule);
for (const current of drifted.atoms.slice(3)) current.x += 1;
const rejected = registeredPoseRetentionPlan({ molecule:drifted, referenceLigand,
  spatialFeatures });
assert.equal(rejected.accepted, false);
assert.equal(rejected.features[0].rmsdAngstrom, 1);
assert.equal(rejected.features[0].centroidDisplacementAngstrom, 1);

const releasedHard = registeredPoseRetentionPlan({ molecule, referenceLigand,
  spatialFeatures, releasedReferenceAtomIds:['hard-c'] });
assert(!releasedHard.fixedAtomIds.includes('hard-c'));
assert.throws(() => registeredPoseRetentionPlan({ molecule, referenceLigand,
  spatialFeatures:[{ ...spatialFeatures[0], registeredIntentId:null }] }),
/lacks registered intent provenance/);
assert.throws(() => registeredPoseRetentionPlan({ molecule, referenceLigand,
  spatialFeatures:[{ ...spatialFeatures[0], mappingVariants:[
    spatialFeatures[0].mappingVariants[0],
    { referenceAtomIds:['ring-1','ring-2','ring-3','ring-4'],
      productAtomIds:['new-1','new-2','new-3','hard-a'] },
  ] }] }), /do not describe one product fragment/);
assert.throws(() => registeredPoseRetentionPlan({ molecule, referenceLigand:null,
  spatialFeatures }), /Required registered pose-retention context is unavailable/);

console.log('registered pose retention preserves explicit predecessor-coordinate intent');
