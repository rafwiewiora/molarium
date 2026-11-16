import test from 'node:test';
import assert from 'node:assert/strict';
import {relayHostedCofold} from './hosted-cofold.mjs';
const key='nvapi-'+ 'a'.repeat(40),id='12345678-1234-1234-1234-123456789abc';
const request=(path='submit',extra={})=>new Request('https://molarium.org/api/cofold/nvidia/'+path,{
  method:path==='submit'?'POST':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',Origin:'https://molarium.org'},
  ...(path==='submit'?{body:JSON.stringify({model:'boltz2',input:{polymers:[{sequence:'ACD'}]}})}:{}),...extra});
test('an accepted submission retains the upstream ID; polling never creates another job',async()=>{
  const calls=[];const fetchImplementation=async(url,options)=>{calls.push({url,options});return calls.length===1
    ?new Response(null,{status:202,headers:{'nvcf-reqid':id}})
    :Response.json({structures:[{format:'mmcif',structure:'data_actual_provider_file'}]});};
  const first=await relayHostedCofold(request(),{fetchImplementation});assert.equal(first.status,202);
  assert.deepEqual(await first.json(),{status:'queued',requestId:id});
  const second=await relayHostedCofold(request('status/'+id),{fetchImplementation});
  assert.equal((await second.json()).status,'complete');
  assert.equal(calls[0].url,'https://health.api.nvidia.com/v1/biology/mit/boltz2/predict');
  assert.equal(calls[1].url,'https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/'+id);
  assert.equal(calls[0].options.method,'POST');assert.equal(calls[1].options.method,'GET');
  assert.equal(calls[1].options.body,undefined);assert.equal(calls[0].options.redirect,'manual');
  assert.deepEqual(JSON.parse(calls[0].options.body),{polymers:[{sequence:'ACD'}]});
});
test('Local Lab, missing credentials and a foreign origin perform no external request',async()=>{
  const fetchImplementation=()=>assert.fail('No egress allowed');
  assert.equal((await relayHostedCofold(request(),{localOnly:true,fetchImplementation})).status,403);
  assert.equal((await relayHostedCofold(request('submit',{headers:{}}),{fetchImplementation})).status,401);
  assert.equal((await relayHostedCofold(request('submit',{headers:{Authorization:'Bearer '+key,Origin:'https://other.invalid'}}),{fetchImplementation})).status,403);
});
test('neither user-selected destinations nor malformed status paths reach an upstream',async()=>{
  const fetchImplementation=()=>assert.fail('Unknown relay operation');
  for(const path of ['status/https://localhost/','status/../submit','status/not-a-uuid','submit?url=https://localhost','other'])
    assert.equal((await relayHostedCofold(request(path),{fetchImplementation})).status,404);
  for(const model of ['https://localhost','__proto__','unknown']){
    const r=request('submit',{body:JSON.stringify({model,input:{}})});
    assert.equal((await relayHostedCofold(r,{fetchImplementation})).status,400);
  }
});
test('a lost POST response is unknown and does not silently replay',async()=>{
  let calls=0;const response=await relayHostedCofold(request(),{fetchImplementation:async()=>{calls++;throw Error('lost');}});
  assert.equal(response.status,502);assert.equal((await response.json()).submissionUnknown,true);assert.equal(calls,1);
});
test('provider errors cannot echo the credential into browser results',async()=>{
  const response=await relayHostedCofold(request(),{fetchImplementation:async()=>Response.json({detail:'key='+key},{status:401})});
  const body=await response.text();assert.equal(response.status,401);assert.ok(!body.includes(key));assert.match(body,/redacted/);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('external result redirects are not followed with user credentials',async()=>{
  let calls=0;const response=await relayHostedCofold(request('status/'+id),{fetchImplementation:async()=>{calls++;return new Response(null,{status:302,headers:{Location:'https://attacker.invalid/download','nvcf-reqid':id}});}});
  assert.equal(calls,1);assert.equal((await response.json()).resultRequiresProviderDownload,true);
});
test('oversized bodies and a queued response without an ID stop safely',async()=>{
  const fetchImplementation=()=>assert.fail('Oversize input must stop before egress');
  const r=request('submit',{headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Content-Length':'4194305'}});
  assert.equal((await relayHostedCofold(r,{fetchImplementation})).status,413);
  const accepted=await relayHostedCofold(request(),{fetchImplementation:async()=>new Response(null,{status:202})});
  assert.equal((await accepted.json()).submissionUnknown,true);
});
