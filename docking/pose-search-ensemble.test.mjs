import assert from 'node:assert/strict';
import { MOLARIUM_POSE_PROPAGATION_PROTOCOL } from './protocol.mjs';
import { runPoseSearchPartition } from './pose-search-ensemble.mjs';

const molecule = { name:'pose ensemble scheduling fixture', atoms:[
  { element:'C', x:0, y:0, z:0 },
  { element:'C', x:1.5, y:0, z:0 },
  { element:'C', x:2.7, y:1, z:0 },
  { element:'C', x:3.8, y:1.4, z:0.2 },
  { element:'O', x:4.6, y:2.1, z:1.1 },
], bonds:[
  { a:0,b:1,order:1 }, { a:1,b:2,order:1 },
  { a:2,b:3,order:1 }, { a:3,b:4,order:1 },
] };
const nonbonded = molecule.atoms.map((atom, index) => ({ index,
  charge_e:atom.element === 'O' ? -0.4 : index === 3 ? 0.4 : 0,
  sigma_nm:atom.element === 'O' ? 0.30 : 0.34, epsilon_kj:0.2 }));
const ligandParameters = { forcefield:'ensemble scheduling fixture', chargeModel:'fixture',
  sourceSha256:'fixture', system:{
    particles:molecule.atoms.map((atom, index) => ({ index,
      mass_amu:atom.element === 'O' ? 16 : 12 })),
    constraints:[], angles:[], torsions:[], exceptions:[], nonbonded,
    bonds:molecule.bonds.map((bond) => ({ i:bond.a, j:bond.b,
      k_kj_nm2:1000, r0_nm:Math.hypot(
        molecule.atoms[bond.a].x - molecule.atoms[bond.b].x,
        molecule.atoms[bond.a].y - molecule.atoms[bond.b].y,
        molecule.atoms[bond.a].z - molecule.atoms[bond.b].z) / 10 })),
  } };
const positions = Float64Array.from(molecule.atoms.flatMap((atom) => [atom.x, atom.y, atom.z]));
const scoring = {
  molecule, ligandParameters,
  receptorSite:{ sourceForcefield:'fixture', atoms:[{
    element:'N', position:{ x:5.3,y:2.5,z:2.2 },
    nonbonded:{ charge_e:0.3, sigma_nm:0.32, epsilon_kj:0.2 },
  }] },
  referenceLigandPositions:positions,
  coreAtomPairs:[[0,0],[1,1],[2,2]], coreAtomIndices:[0,1,2],
  hydrogenBondConstraints:[], protocol:MOLARIUM_POSE_PROPAGATION_PROTOCOL,
  minimumSageStartEnergy:0, interactionReferenceKcalMol:0,
  minimumFixedCoreStartStericClashes:0, minimumFixedCoreStartLennardJonesKcalMol:0,
  captureMaximumRelativeLigandStrainKcalMol:1e9,
  captureMaximumAdditionalStericClashes:1e9,
  captureMaximumAdditionalLennardJonesKcalMol:1e9,
};
const search = { captureSteps:4, capturePolishSweeps:1, refinementSteps:4,
  temperatureStartKelvin:900, temperatureEndKelvin:150,
  torsionAnglesDegrees:[-60,60], ringCrankshaftAnglesDegrees:[-30,30],
  localLineFractions:[1] };
const candidates = [11,22,33,44].map((seed, conformerIndex) => ({
  conformerIndex, seed, positions:new Float64Array(positions),
}));

const complete = await runPoseSearchPartition({ scoring, search, candidates });
const first = await runPoseSearchPartition({ scoring, search,
  candidates:[candidates[0], candidates[2]] });
const second = await runPoseSearchPartition({ scoring, search,
  candidates:[candidates[1], candidates[3]] });
const partitioned = [...first.results, ...second.results]
  .sort((a, b) => a.conformerIndex - b.conformerIndex);
assert.deepEqual(partitioned, complete.results,
  'partitioning independent pose chains must not change any scientific result');
assert.deepEqual(complete.results.map((entry) => entry.refinement.seed), [11,22,33,44]);
assert.ok(complete.results.every((entry) => entry.refinement.selectedFeasible));
console.log('Pose-search deterministic ensemble partitioning: PASS');
