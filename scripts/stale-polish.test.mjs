import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const extract=name=>{
  const start=source.indexOf(`function ${name}(`);
  assert.ok(start>=0);
  return source.slice(start,source.indexOf('\n}',start)+2);
};
function harness() {
  let finish;
  const work=new Promise(resolve=>{finish=resolve;});
  const calls={worker:0,apply:0,record:0};
  const queued=[];
  const molecule={atoms:[{element:'C',x:1,y:2,z:3}],source:{}};
  const context=vm.createContext({state:{molecule,calculating:false,minimizing:false},
    smallMoleculePolishSequence:0,
    localEditPolishPlan:()=>({molecule,globalAtomIndices:[0],movableGlobalAtomIndices:[0],scope:'test'}),
    setTimeout:fn=>queued.push(fn),updateBuildStatus:()=>{},
    runRDKitJob:()=>{calls.worker++;return work;},
    applyMappedCalculationPositions:()=>{calls.apply++;molecule.atoms[0].x=-100;},
    recordInteractivePolish:()=>{calls.record++;},
    invalidateNumericalParameters:()=>{},atomFormalCharge:()=>0});
  vm.runInContext(extract('scheduleSmallMoleculePolish')+'\n'+extract('invalidateEditedChemistry'),context);
  return {context,calls,queued,molecule,finish};
}
test('graph edit cancels a queued old-graph polish before dispatch',async()=>{
  const h=harness();
  h.context.scheduleSmallMoleculePolish([0]);
  h.context.invalidateEditedChemistry(h.molecule);
  await h.queued[0]();
  assert.deepEqual(h.calls,{worker:0,apply:0,record:0});
  assert.equal(h.molecule.atoms[0].x,1);
});
test('graph edit rejects an in-flight old-graph result on the same molecule object',async()=>{
  const h=harness();
  h.context.scheduleSmallMoleculePolish([0]);
  const pending=h.queued[0]();
  assert.equal(h.calls.worker,1);
  h.context.invalidateEditedChemistry(h.molecule);
  h.molecule.atoms[0].x=99;
  h.finish({positions:new Float64Array([0,0,0])});
  await pending;
  assert.deepEqual(h.calls,{worker:1,apply:0,record:0});
  assert.equal(h.molecule.atoms[0].x,99);
});
test('without an intervening edit, ordinary polish still applies and records',async()=>{
  const h=harness();
  h.context.scheduleSmallMoleculePolish([0]);
  const pending=h.queued[0]();
  h.finish({positions:new Float64Array([0,0,0])});
  await pending;
  assert.deepEqual(h.calls,{worker:1,apply:1,record:1});
});
