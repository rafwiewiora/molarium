import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {specifyAwwIntent} from './sos1-design-intent-excerpt.mjs';
import {CHEMIST_ACTION_DEFINITIONS as definitions} from '../../chemist-actions.mjs';

const script=JSON.parse(readFileSync(new URL('../../design-history/publications/sos1/designer-intent-2026-09-04/executable.action-script.json',import.meta.url)));
test('paper API excerpt resolves to the exact four published design instructions',async()=>{
  const calls=[];
  await specifyAwwIntent({execute:async request=>{
    calls.push(request);
    return {status:'completed',result:{contact:{contactId:`manual-hbond-${calls.length}`}}};
  }});
  assert.deepEqual(calls,script.actions.slice(36,39).concat(script.actions[41])
    .map(({action,args})=>({action,args})));
  for(const {action,args} of calls){
    assert.ok(Object.hasOwn(definitions,action));
    for(const key of Object.keys(args))assert.ok(Object.hasOwn(definitions[action].arguments,key));
  }
});
test('the excerpt uses the returned contact ID and stops on an API failure',async()=>{
  const calls=[];
  await assert.rejects(()=>specifyAwwIntent({execute:async request=>{
    calls.push(request);
    if(calls.length===3){assert.equal(request.args.contactId,'contact-from-live-result');return {status:'failed'};}
    return {status:'completed',result:{contact:{contactId:'contact-from-live-result'}}};
  }}),/geometry.alignBranchToContact failed/);
  assert.equal(calls.length,3);
});
