import assert from 'node:assert/strict';
import { featureGuidedPoseSeeds } from './feature-seeding.mjs';

const molecule = {
  atoms:[
    { element:'N' }, { element:'C' }, { element:'O' },
    { element:'C' }, { element:'C' }, { element:'C' },
    { element:'C' }, { element:'C' }, { element:'C' },
    { element:'F' }, { element:'F' },
    { element:'C' }, { element:'C' },
  ],
  bonds:[
    { a:0,b:1,order:1 }, { a:1,b:2,order:2 }, { a:1,b:3,order:1 },
    { a:3,b:4,order:1.5,aromatic:true }, { a:4,b:5,order:1.5,aromatic:true },
    { a:5,b:6,order:1.5,aromatic:true }, { a:6,b:7,order:1.5,aromatic:true },
    { a:7,b:8,order:1.5,aromatic:true }, { a:8,b:3,order:1.5,aromatic:true },
    { a:4,b:9,order:1 }, { a:8,b:10,order:1 },
    { a:0,b:11,order:1 }, { a:11,b:12,order:1 },
  ],
};
const positions = Float64Array.from([
  -1.3,0,0, 0,0,0, 0,1.2,0,
  1.5,0,0, 2.1,1.05,0, 3.3,1.05,0,
  3.9,0,0, 3.3,-1.05,0, 2.1,-1.05,0,
  1.5,2.05,0, 1.5,-2.05,0,
  -2.3,0,0, -2.3,1,0,
]);
const referencePositions = new Float64Array(positions);
// The registered feature asks for the aromatic fragment after a 90-degree
// rotation about the pre-existing aryl-carbonyl bond (the x axis here).
for (const atomIndex of [4,5,6,7,8,9,10]) {
  const offset = atomIndex * 3;
  const y = referencePositions[offset + 1];
  referencePositions[offset + 1] = 0;
  referencePositions[offset + 2] = y;
}
const input = {
  molecule, initialPositions:positions, referencePositions,
  coreAtomIndices:[0,1,2,3,4,5,6,7,8],
  editedAtomIndices:[9,10], affectedAtomIndices:[4,8],
  spatialFeatureConstraints:[{ id:'registered-ring', treatment:'soft-restraint',
    atomPairVariants:[[[4,4],[5,5],[6,6]]] }],
  count:8, featureSeedingProtocol:'v5',
};

const first = featureGuidedPoseSeeds(input);
const second = featureGuidedPoseSeeds(input);
const sixteen = featureGuidedPoseSeeds({ ...input, count:16 });
const prereleased = featureGuidedPoseSeeds({ ...input,
  coreAtomIndices:[0,1,2],
  inheritedAtomIndices:[0,1,2,3,4,5,6,7,8],
});
assert.equal(first.method, 'molarium-edit-region-axis-seeding/v5');
assert.equal(first.spatialFeatureMapCount, 1);
assert.equal(first.affectedRotorCount, 1);
assert.equal(prereleased.hardCoreAtomCount, 3);
assert.equal(prereleased.inheritedAtomCount, 9);
assert.equal(prereleased.affectedRotorCount, 1,
  'a registered distal release must retain inherited-rotor discovery');
assert(prereleased.coverage.strata.some((entry) =>
  entry.kind === 'affected-existing-rotor-opposite-orientation'
    && entry.selectedSeedOrdinals.length === 1),
'a registered distal release must retain mandatory opposite-orientation coverage');
assert.equal(first.untargetedRotorCount, 1);
assert.equal(first.seeds.length, 8);
assert.equal(sixteen.seeds.length, 16);
assert.equal(sixteen.coverage.allRequiredStrataCovered, true);
assert.equal(first.coverage.policy, 'required-strata-then-round-robin/v1');
assert.equal(first.coverage.requiredStrataCount, 3);
assert.equal(first.coverage.coveredRequiredStrataCount, 3);
assert.equal(first.coverage.allRequiredStrataCovered, true);
assert(first.coverage.strata.filter((entry) => entry.required)
  .every((entry) => entry.selectedSeedOrdinals.length > 0));
assert(first.coverage.strata.find((entry) => entry.kind === 'spatial-feature-map')
  .bestRmsdAngstrom < 1e-10,
  'the candidate assigned to a spatial-feature map should be the best generated map fit');
const opposite = first.coverage.strata.find((entry) =>
  entry.kind === 'affected-existing-rotor-opposite-orientation');
assert(opposite?.required && opposite.selectedSeedOrdinals.length === 1,
  'bounded v5 search must retain an opposite endpoint for every affected rotor');
assert(first.seeds.some((entry) => entry.audit.method === 'affected-existing-rotor-torsion-scan'
  && entry.audit.axialAngleDegrees === 180),
  'the 180-degree affected-ring orientation must reach the searched seed set');
const firstUntargetedOrdinal = first.seeds.findIndex((entry) =>
  entry.audit.method === 'untargeted-edit-region-torsion-scan');
const requiredFirstOrdinals = first.coverage.strata.filter((entry) => entry.required)
  .map((entry) => entry.firstSelectedSeedOrdinal);
assert(firstUntargetedOrdinal < 0 || Math.max(...requiredFirstOrdinals) < firstUntargetedOrdinal,
  'all required strata must be selected before an untargeted rotor seed');
assert.deepEqual(first.seeds.map((entry) => ({
  positions:Array.from(entry.positions), audit:entry.audit,
})), second.seeds.map((entry) => ({
  positions:Array.from(entry.positions), audit:entry.audit,
})), 'stratified selection must be deterministic');

assert.throws(() => featureGuidedPoseSeeds({ ...input, count:1 }),
  /requires at least 3 search chains/,
  'a cap too small for the required strata must fail closed');

console.log('Feature-guided pose seeds cover registered feature maps and affected rotors deterministically');
