import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewBundle} from './review-bundle.mjs';
const make=(label)=>({label,sha256:label.repeat(64).slice(0,64),bundle:{schema:'foldarium.cofolding-library.v1',
  run:{id:label,createdAt:'2026-11-12T00:00:00Z',request:{sequence:'ACD'},compounds:[{id:'ethanol',smiles:'CCO'}]},
  poses:[0,1].map(seed=>({id:`pose${seed}`,compoundId:'ethanol',seed,sample:seed,status:'complete',
    result:{model:label,provider:label,pdb:'ATOM  original receptor\nHETATM original ligand',provenance:{exact:label}}})),
  decisions:[{id:'a',compoundId:'ethanol',poseId:'pose0',value:'preferred'}]}});
test('comparison export preserves original complexes/provenance and starts unreviewed',()=>{
  const left=make('a'),right=make('b'),copy=structuredClone([left,right]),out=reviewBundle([left,right]);
  assert.equal(out.poses.length,4);assert.equal(out.run.samples,4);assert.deepEqual(out.decisions,[]);
  assert.deepEqual(out.poses.map(p=>p.sample),[0,2,1,3]);
  assert.deepEqual(out.poses[2].result,right.bundle.poses[0].result);
  assert.equal(out.poses[2].sourcePose.id,'pose0');assert.deepEqual([left,right],copy);
});
test('mismatched identities and duplicate/missing seeds cannot become a review cohort',()=>{
  const a=make('a'),b=make('b');b.bundle.run.compounds[0].smiles='CCC';
  assert.throws(()=>reviewBundle([a,b]),/identities differ/);
  const c=make('c');c.bundle.poses[1].seed=0;
  assert.throws(()=>reviewBundle([c]),/Duplicate/);
  const d=make('d');d.bundle.run.compounds.push({id:'benzene',smiles:'c1ccccc1'});
  assert.throws(()=>reviewBundle([d]),/complete source seed set/);
});
