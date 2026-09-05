import {test} from 'node:test';
import assert from 'node:assert/strict';
import {obc2Parameters,OBC2_SETTINGS} from '../../openff/implicit-solvent.js';
const system={nonbonded:[{charge_e:0.2}]};
const molecule={atoms:[{element:'C'}],bonds:[]};
test('default radii unchanged without prepared annotation',()=>{
  assert.equal(obc2Parameters(molecule,system).particles[0].radius_nm,0.17);
});
test('explicit upstream radii are preserved, copied, and charge-checked',()=>{
  const prepared={...OBC2_SETTINGS,particles:[{charge_e:0.2,radius_nm:0.19,scale:0.72}]};
  const m={...molecule,parameterization:{implicitSolvent:prepared}};
  const result=obc2Parameters(m,system);
  assert.equal(result.particles[0].radius_nm,0.19);
  result.particles[0].radius_nm=0.2;
  assert.equal(prepared.particles[0].radius_nm,0.19);
  for(const bad of [{solventDielectric:78.5},{model:'OBC1'},
    {particles:[]},{particles:[{charge_e:0.3,radius_nm:0.19,scale:0.72}]},
    {particles:[{charge_e:0.2,radius_nm:NaN,scale:0.72}]},
    {particles:[{charge_e:0.2,radius_nm:0.001,scale:0.72}]}]){
    assert.throws(()=>obc2Parameters({...m,parameterization:{implicitSolvent:{...prepared,...bad}}},system));
  }
});
