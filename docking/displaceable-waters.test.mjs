import assert from 'node:assert/strict';
import { displaceableWaterPlan } from './displaceable-waters.mjs';

const molecule = { atoms:[
  { record:'HETATM', residueName:'AWW', element:'C', x:0,y:0,z:0 },
  { record:'HETATM', residueName:'HOH', chain:'A', residueIndex:1507,
    atomName:'O', element:'O', designAtomId:'water-1507-O', x:2.4,y:0,z:0 },
  { record:'HETATM', residueName:'HOH', chain:'A', residueIndex:1507,
    atomName:'H1', element:'H', x:3.1,y:0,z:0 },
  { record:'HETATM', residueName:'HOH', chain:'A', residueIndex:1507,
    atomName:'H2', element:'H', x:2.1,y:.7,z:0 },
  { record:'HETATM', residueName:'HOH', chain:'A', residueIndex:1508,
    atomName:'O', element:'O', x:6,y:0,z:0 },
] };
const plan = displaceableWaterPlan({ molecule, ligandAtomIndices:[0] });
assert.equal(plan.schema, 'molarium.displaceable-water-plan/v1');
assert.deepEqual(plan.atomIndices, [1,2,3],
  'the whole overlapping water, but no distant water, becomes movable');
assert.equal(plan.waters[0].residueIndex, 1507);
assert.equal(plan.waters[0].oxygenAtomId, 'water-1507-O');
assert.equal(displaceableWaterPlan({ molecule, ligandAtomIndices:[] }).waters.length, 0);

console.log('displaceable water plan tests passed');
