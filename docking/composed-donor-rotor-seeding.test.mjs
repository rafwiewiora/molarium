import assert from 'node:assert/strict';
import { featureGuidedPoseSeeds } from './feature-seeding.mjs';

// Two affected, non-ring single bonds in a five-heavy-atom chain. The donor
// and its H remain on the hard proximal side; atom 4 declares the distal edit.
const molecule = {
  atoms:[
    { element:'N' }, { element:'C' }, { element:'C' },
    { element:'C' }, { element:'C' }, { element:'H' },
  ],
  bonds:[
    { a:0,b:1,order:1 }, { a:1,b:2,order:1 },
    { a:2,b:3,order:1 }, { a:3,b:4,order:1 },
    { a:0,b:5,order:1 },
  ],
};
const initialPositions = Float64Array.from([
  0,0,0, 1.3,0,0, 2.4,0.7,0,
  3.6,0.7,0.8, 4.7,1.2,1.1, 0,1,0,
]);
const input = {
  molecule, initialPositions,
  coreAtomIndices:[0,1,2,3,4],
  inheritedAtomIndices:[0,1,2,3,4],
  editedAtomIndices:[4], affectedAtomIndices:[4],
  environmentBondRadius:2,
  hydrogenBondConstraints:[{
    id:'proximal-donor', receptorRole:'acceptor',
    donor:{ scope:'ligand', atomIndex:0 },
    hydrogen:{ scope:'ligand', atomIndex:5 },
    acceptor:{ scope:'receptor', point:{ x:-2.9, y:0, z:0 } },
    targetLigandFeatureReferencePoint:{ x:0, y:0, z:0 },
  }],
  count:8, featureSeedingProtocol:'v5',
  editRegionAnglesDegrees:[0,60,180],
};

const first = featureGuidedPoseSeeds(input);
const second = featureGuidedPoseSeeds(input);
assert.equal(first.affectedRotorCount, 2);
assert.equal(first.affectedRotorCombinationCount, 1);
assert.equal(first.affectedRotorCombinationCandidateCount, 4,
  'the two nonzero registered angles must form a complete 2 x 2 heavy-seed grid');
const combinationCoverage = first.coverage.strata.find((entry) =>
  entry.kind === 'affected-existing-two-rotor-combination');
assert(combinationCoverage?.required);
assert(combinationCoverage.selectedSeedOrdinals.length > 0,
  'a bounded search must contain a coupled two-rotor seed');
const combinations = first.seeds.filter((seed) =>
  seed.audit.method === 'affected-existing-two-rotor-torsion-scan');
assert(combinations.length > 0);
assert(combinations.every((seed) => seed.audit.rotors.length === 2
  && seed.audit.rotors.every((rotor) => [60,180].includes(rotor.axialAngleDegrees))));
assert(first.seeds.every((seed) => seed.audit.donorHydrogenComposition
  === 'donor-hydrogen-alignment-after-heavy-seeding/v1'
  && seed.audit.donorHydrogenAlignments.length === 1),
'donor-H alignment must be composed with every selected heavy seed');
for (const seed of first.seeds) {
  assert.deepEqual(Array.from(seed.positions.slice(0, 3)), [0,0,0],
    'the hard donor heavy atom must not move');
  assert.deepEqual(Array.from(seed.positions.slice(15, 18)), [-1,0,0],
    'the donor hydrogen must point toward the receptor after each heavy seed');
}
assert.deepEqual(first.seeds.map((seed) => ({
  positions:Array.from(seed.positions), audit:seed.audit,
})), second.seeds.map((seed) => ({
  positions:Array.from(seed.positions), audit:seed.audit,
})), 'coupled heavy/H seed composition must be deterministic');

console.log('Two-rotor heavy seeds retain donor-H alignment and deterministic coverage');
