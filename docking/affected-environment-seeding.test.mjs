import assert from 'node:assert/strict';
import { featureGuidedPoseSeeds, placeSeedOnlyFragments } from './feature-seeding.mjs';

const benzamide = {
  atoms:[
    { element:'N' }, { element:'C' }, { element:'O' },
    { element:'C' }, { element:'C' }, { element:'C' },
    { element:'C' }, { element:'C' }, { element:'C' },
    { element:'F' }, { element:'F' },
  ],
  bonds:[
    { a:0,b:1,order:1 }, { a:1,b:2,order:2 }, { a:1,b:3,order:1 },
    { a:3,b:4,order:1.5,aromatic:true }, { a:4,b:5,order:1.5,aromatic:true },
    { a:5,b:6,order:1.5,aromatic:true }, { a:6,b:7,order:1.5,aromatic:true },
    { a:7,b:8,order:1.5,aromatic:true }, { a:8,b:3,order:1.5,aromatic:true },
    { a:4,b:9,order:1 }, { a:8,b:10,order:1 },
  ],
};
const benzamidePositions = Float64Array.from([
  -1.3,0,0, 0,0,0, 0,1.2,0,
  1.5,0,0, 2.1,1.05,0, 3.3,1.05,0,
  3.9,0,0, 3.3,-1.05,0, 2.1,-1.05,0,
  1.5,2.05,0, 1.5,-2.05,0,
]);
const difluoroSeedInput = { molecule:benzamide,
  initialPositions:benzamidePositions,
  coreAtomIndices:[0,1,2,3,4,5,6,7,8],
  editedAtomIndices:[9,10], affectedAtomIndices:[4,8],
  count:64, hydrogenBondConstraints:[] };
const difluoroSeedsV3 = featureGuidedPoseSeeds({ ...difluoroSeedInput,
  featureSeedingProtocol:'v3' });
assert.equal(difluoroSeedsV3.method, 'molarium-edit-region-axis-seeding/v3');
assert.equal(difluoroSeedsV3.affectedRotorCount, 0,
  'v3 reproducibly omits affected-existing-rotor seeding');
assert.deepEqual(difluoroSeedsV3.affectedRotors, []);
assert.deepEqual(difluoroSeedsV3.releasedCoreAtomIndices, []);
assert.equal(difluoroSeedsV3.uniqueSeedCount, 1,
  'v3 retains the unaltered seed when no untargeted edit-region rotor exists');

const v3UntargetedSeeds = featureGuidedPoseSeeds({
  molecule:{ atoms:[{ element:'C' }, { element:'C' }, { element:'C' }, { element:'O' }],
    bonds:[{ a:0,b:1,order:1 }, { a:1,b:2,order:1 }, { a:2,b:3,order:1 }] },
  initialPositions:Float64Array.from([0,0,0, 1,0,0, 1,1,0, 1,2,0]),
  coreAtomIndices:[0], count:12, featureSeedingProtocol:'v3',
});
assert.equal(v3UntargetedSeeds.method, 'molarium-edit-region-axis-seeding/v3');
assert.equal(v3UntargetedSeeds.untargetedRotorCount, 1,
  'v3 retains current untargeted edit-region torsion seeding');
assert.equal(v3UntargetedSeeds.affectedRotorCount, 0);
assert.equal(v3UntargetedSeeds.uniqueSeedCount, 12);

const difluoroSeeds = featureGuidedPoseSeeds({ ...difluoroSeedInput,
  featureSeedingProtocol:'v4' });
assert.equal(difluoroSeeds.method, 'molarium-edit-region-axis-seeding/v4');
assert.equal(difluoroSeeds.affectedRotorCount, 1,
  '2,6-substitution must activate the pre-existing aryl-carbonyl rotor');
assert.equal(difluoroSeeds.untargetedRotorCount, 0,
  'the added fluorines are not themselves fake heavy-atom rotors');
assert.equal(difluoroSeeds.uniqueSeedCount, 12);
assert.deepEqual(difluoroSeeds.releasedCoreAtomIndices, [4,5,6,7,8]);
assert.deepEqual(difluoroSeeds.affectedRotors[0], {
  bondIndex:2, fixedEndpointAtomIndex:1, movableEndpointAtomIndex:3,
  releasedCoreAtomIndices:[4,5,6,7,8],
  affectedAtomIndices:[4,8,9,10], editedAtomIndices:[9,10],
  attachmentMode:'affected-existing-rotor',
});
assert.equal(difluoroSeeds.seeds[1].audit.method,
  'affected-existing-rotor-torsion-scan');
assert.deepEqual(Array.from(difluoroSeeds.seeds[1].positions.slice(0, 12)),
  Array.from(benzamidePositions.slice(0, 12)),
  'the amide and both aryl-carbonyl axis atoms remain exact');
assert(Math.abs(difluoroSeeds.seeds[1].positions[14]) > 0.4,
  'the pre-existing aromatic ring must actually rotate out of plane');
assert.throws(() => featureGuidedPoseSeeds({ ...difluoroSeedInput,
  featureSeedingProtocol:'v2' }), /must be v3, v4, or v5/);

const rigidRing = {
  atoms:[
    { element:'C' }, { element:'C' }, { element:'C' },
    { element:'C' }, { element:'C' }, { element:'C' }, { element:'F' },
  ],
  bonds:[
    { a:0,b:1,order:1 }, { a:1,b:2,order:1 }, { a:2,b:3,order:1 },
    { a:3,b:4,order:1 }, { a:4,b:5,order:1 }, { a:5,b:0,order:1 },
    { a:1,b:6,order:1 },
  ],
};
const rigidSeeds = featureGuidedPoseSeeds({ molecule:rigidRing,
  initialPositions:Float64Array.from([
    1,0,0, .5,.866,0, -.5,.866,0, -1,0,0,
    -.5,-.866,0, .5,-.866,0, 1.5,1.7,0,
  ]),
  coreAtomIndices:[0,1,2,3,4,5], editedAtomIndices:[6],
  affectedAtomIndices:[1], count:16, hydrogenBondConstraints:[] });
assert.equal(rigidSeeds.affectedRotorCount, 0,
  'ring bonds remain rigid even when their local environment changes');
assert.equal(rigidSeeds.untargetedRotorCount, 0);
assert.equal(rigidSeeds.uniqueSeedCount, 1);
assert.equal(rigidSeeds.seeds[0].audit.method, 'unaltered-reference-propagation');

const amideEdit = {
  atoms:[{ element:'C' }, { element:'O' }, { element:'N' },
    { element:'C' }, { element:'F' }],
  bonds:[{ a:0,b:1,order:2 }, { a:0,b:2,order:1 },
    { a:2,b:3,order:1 }, { a:3,b:4,order:1 }],
};
const amideSeeds = featureGuidedPoseSeeds({ molecule:amideEdit,
  initialPositions:Float64Array.from([0,0,0, 0,1.2,0, 1.3,0,0, 2.5,0,0, 3.5,0,0]),
  coreAtomIndices:[0,1,2,3], editedAtomIndices:[4], affectedAtomIndices:[3],
  count:16, hydrogenBondConstraints:[] });
assert.equal(amideSeeds.affectedRotors.length, 0,
  'a nearby edit must not turn the conjugated amide C-N bond into a rotor');

const seedOnlyMolecule = {
  atoms:Array.from({ length:6 }, () => ({ element:'C' })),
  bonds:[
    { a:0,b:1,order:1 }, { a:1,b:2,order:1 }, { a:2,b:3,order:1 },
    { a:3,b:4,order:1.5,aromatic:true }, { a:4,b:5,order:1.5,aromatic:true },
    { a:5,b:3,order:1.5,aromatic:true },
  ],
};
const seedOnlyInitial = Float64Array.from([
  0,0,0, 1,0,0, 2,0,0, 3,0,0, 3,1,0, 2.2,.5,0,
]);
const seedOnlyReference = Float64Array.from([
  0,0,0, 1,0,0, 2,0,0, 3,0,0, 3,0,1, 2.2,0,.5,
]);
const seededFragment = placeSeedOnlyFragments({ molecule:seedOnlyMolecule,
  initialPositions:seedOnlyInitial, referencePositions:seedOnlyReference,
  hardCoreAtomPairs:[[0,0],[1,1]], sweeps:2,
  features:[{ id:'prediction-only-ring', treatment:'seed-only',
    mappingVariants:[{ atomPairs:[[3,3],[4,4],[5,5]] }] }],
});
assert.deepEqual(Array.from(seededFragment.positions.slice(0, 6)),
  Array.from(seedOnlyInitial.slice(0, 6)),
  'a seed-only feature must not change the hard-core transform');
assert(seededFragment.features[0].seededRmsdAngstrom
  < seededFragment.features[0].initialRmsdAngstrom,
  'torsion seeding should move a predecessor fragment closer without restraining it');
for (const bond of seedOnlyMolecule.bonds) {
  const distance = (positions) => Math.hypot(...[0,1,2].map((axis) =>
    positions[bond.a * 3 + axis] - positions[bond.b * 3 + axis]));
  assert(Math.abs(distance(seededFragment.positions) - distance(seedOnlyInitial)) < 1e-10,
    'seed-only placement must preserve every bond length');
}

console.log('Affected-environment seeding activates 2,6 torsion and preserves rigid edits');
