import assert from 'node:assert/strict';
import test from 'node:test';
import {createChemistActionsApi} from './chemist-actions.mjs';

function make(extra={}) {
  return createChemistActionsApi({enabledActions:['session.inspect'],
    routes:{'session.inspect':async args=>{if(args.fail)throw Error('Recorded failure');return args;}},...extra});
}
test('default history retains all records beyond the old 500-action boundary',async()=>{
  const api=make();
  for(let n=0;n<605;n++)await api.inspect({n});
  await assert.rejects(api.inspect({fail:true}),/Recorded failure/);
  const history=api.history();
  assert.equal(history.length,606);
  assert.deepEqual(history.map(r=>r.sequence),Array.from({length:606},(_,n)=>n+1));
  assert.equal(history[0].args.n,0);
  assert.equal(history.at(-1).status,'failed');
  history[0].args.n=-1;
  assert.equal(api.history()[0].args.n,0,'history remains a defensive snapshot');
});
test('bounded retention remains explicit and validated for specialized adapters',async()=>{
  const api=make({historyLimit:2});
  for(let n=0;n<4;n++)await api.inspect({n});
  assert.deepEqual(api.history().map(r=>r.sequence),[3,4]);
  for(const value of [0,-1,NaN,null,'500',1.5,-Infinity])
    assert.throws(()=>make({historyLimit:value}),/positive safe integer or Infinity/);
});
