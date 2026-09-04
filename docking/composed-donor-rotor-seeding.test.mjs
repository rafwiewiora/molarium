import assert from 'node:assert/strict';
import { featureGuidedPoseSeeds } from './feature-seeding.mjs';

// Two affected, non-ring single bonds in a five-heavy-atom chain. The donor
// and its H remain on the hard proximal side; atom 4 declares the distal edit.
const molecule = {
  atoms:[
    { element:'N' }, { element:'C' }, { element:'C' },
    { element:'C' }, { element:'O' }, { element:'H' }, { element:'H' },
  ],
  bonds:[
    { a:0,b:1,order:1 }, { a:1,b:2,order:1 },
    { a:2,b:3,order:1 }, { a:3,b:4,order:1 },
    { a:0,b:5,order:1 }, { a:4,b:6,order:1 },
  ],
};
const initialPositions = Float64Array.from([
  0,0,0, 1.3,0,0, 2.4,0.7,0,
  3.6,0.7,0.8, 4.7,1.2,1.1, 0,1,0, 4.7,2.2,1.1,
]);
const input = {
  molecule, initialPositions,
  coreAtomIndices:[0,1,2,3,4],
  inheritedAtomIndices:[0,1,2,3,4],
  editedAtomIndices:[4], affectedAtomIndices:[4],
  environmentBondRadius:2,
  hydrogenBondConstraints:[
    {
      id:'proximal-donor', receptorRole:'acceptor',
      donor:{ scope:'ligand', atomIndex:0 },
      hydrogen:{ scope:'ligand', atomIndex:5 },
      acceptor:{ scope:'receptor', point:{ x:-2.9, y:0, z:0 } },
      targetLigandFeatureReferencePoint:{ x:0, y:0, z:0 },
    },
    {
      id:'distal-donor', receptorRole:'acceptor',
      donor:{ scope:'ligand', atomIndex:4 },
      hydrogen:{ scope:'ligand', atomIndex:6 },
      acceptor:{ scope:'receptor', point:{ x:2.4, y:5.7, z:0 } },
      targetLigandFeatureReferencePoint:{ x:2.4, y:2.7, z:0 },
    },
  ],
  count:8, featureSeedingProtocol:'v5',
  editRegionAnglesDegrees:[0,60,180],
};

const first = featureGuidedPoseSeeds(input);
const second = featureGuidedPoseSeeds(input);
assert.equal(first.affectedRotorCount, 2);
assert.equal(first.affectedRotorCombinationCount, 4);
assert.equal(first.affectedRotorCombinationCandidateCount, 9,
  'the three registered angles must form a complete 3 x 3 heavy-seed grid');
const endpointCoverage = first.coverage.strata.filter((entry) =>
  entry.kind === 'affected-existing-two-rotor-endpoint');
assert.deepEqual(endpointCoverage.map((entry) => entry.rotorAnglesDegrees.join('/')),
  ['0/0', '180/0', '0/180', '180/180']);
assert(endpointCoverage.every((entry) => entry.required
  && entry.selectedSeedOrdinals.length > 0),
'all four binary joint endpoints must be present in a bounded search');
const selectedEndpointSignatures = new Set(first.seeds.flatMap((seed) =>
  seed.audit.coupledRotorEndpointSignatures || []));
assert.deepEqual([...selectedEndpointSignatures].sort(),
  ['0/0', '0/180', '180/0', '180/180'].sort());
assert.throws(() => featureGuidedPoseSeeds({ ...input, count:3 }),
  /requires at least 4 search chains/,
  'fewer than four chains cannot claim complete binary endpoint coverage');
const endpointFeatureCoverage = first.coverage.strata.filter((entry) =>
  entry.kind === 'affected-existing-two-rotor-endpoint-feature');
assert.deepEqual(endpointFeatureCoverage.map((entry) => entry.rotorAnglesDegrees.join('/')),
  ['180/0', '180/180']);
assert(endpointFeatureCoverage.every((entry) => entry.required
  && entry.selectedSeedOrdinals.length > 0),
'the flipped first-rotor endpoints must also carry the movable feature constraint');
for (const entry of endpointFeatureCoverage) {
  for (const ordinal of entry.selectedSeedOrdinals) {
    const audit = first.seeds[ordinal].audit;
    assert(audit.coverageStratumIds.some((id) => id.startsWith('captured-feature:distal-donor')));
    assert.deepEqual(audit.donorHydrogenAlignments.map((alignment) => alignment.constraintId),
      ['proximal-donor', 'distal-donor']);
  }
}
const combinations = first.seeds.filter((seed) =>
  seed.audit.method === 'affected-existing-two-rotor-torsion-scan');
assert(combinations.length > 0);
assert(combinations.every((seed) => seed.audit.rotors.length === 2
  && seed.audit.rotors.every((rotor) => [0,60,180].includes(rotor.axialAngleDegrees))));
assert(first.seeds.every((seed) => seed.audit.donorHydrogenComposition
  === 'donor-hydrogen-alignment-after-heavy-seeding/v1'
  && seed.audit.donorHydrogenAlignments.length === 2),
'donor-H alignment must be composed with every selected heavy seed');
for (const seed of first.seeds) {
  assert.deepEqual(Array.from(seed.positions.slice(0, 3)), [0,0,0],
    'the hard donor heavy atom must not move');
  assert.deepEqual(Array.from(seed.positions.slice(15, 18)), [-1,0,0],
    'the donor hydrogen must point toward the receptor after each heavy seed');
}

const point = (positions, atomIndex) => Array.from(positions.slice(atomIndex * 3, atomIndex * 3 + 3));
const normalized = (vector) => {
  const length = Math.hypot(...vector); return vector.map((value) => value / length);
};
const rotate = (positions, atomIndices, origin, axis, angle) => {
  const result = new Float64Array(positions), cosine = Math.cos(angle), sine = Math.sin(angle);
  atomIndices.forEach((atomIndex) => {
    const vector = point(positions, atomIndex).map((value, index) => value - origin[index]);
    const cross = [axis[1] * vector[2] - axis[2] * vector[1],
      axis[2] * vector[0] - axis[0] * vector[2],
      axis[0] * vector[1] - axis[1] * vector[0]];
    const projection = axis.reduce((sum, value, index) => sum + value * vector[index], 0);
    vector.forEach((value, index) => {
      result[atomIndex * 3 + index] = origin[index] + value * cosine + cross[index] * sine
        + axis[index] * projection * (1 - cosine);
    });
  });
  return result;
};
let nestedExpected = rotate(initialPositions, [2,3,4,6], point(initialPositions, 1),
  normalized(point(initialPositions, 2).map((value, index) => value - point(initialPositions, 1)[index])),
  Math.PI);
nestedExpected = rotate(nestedExpected, [3,4,6], point(nestedExpected, 2),
  normalized(point(nestedExpected, 3).map((value, index) => value - point(nestedExpected, 2)[index])),
  Math.PI);
const nestedEndpoint = first.seeds.find((seed) =>
  seed.audit.method === 'affected-existing-two-rotor-torsion-scan'
  && seed.audit.coupledRotorEndpointSignatures?.includes('180/180'));
assert(nestedEndpoint);
for (const atomIndex of [0,1,2,3,4]) {
  assert(point(nestedEndpoint.positions, atomIndex).every((coordinate, axis) =>
    Math.abs(coordinate - point(nestedExpected, atomIndex)[axis]) < 1e-9),
  'the second nested axis must be recomputed after rotating the first region');
}
assert.deepEqual(first.seeds.map((seed) => ({
  positions:Array.from(seed.positions), audit:seed.audit,
})), second.seeds.map((seed) => ({
  positions:Array.from(seed.positions), audit:seed.audit,
})), 'coupled heavy/H seed composition must be deterministic');

console.log('Two-rotor heavy seeds retain donor-H alignment and deterministic coverage');
