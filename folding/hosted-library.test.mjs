import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedRun,executeHostedRun,hostedBody,hostedRequest,recoverHostedJob,progress} from './hosted-library.mjs';
class Store{
  constructor(){this.r=new Map();this.j=new Map();}
  async saveRun(r){this.r.set(r.id,structuredClone(r));}
  async saveJob(j){this.j.set(j.id,structuredClone(j));}
  async jobs(id){return [...this.j.values()].filter(j=>j.runId===id).map(j=>structuredClone(j));}
  async getRun(id){return structuredClone(this.r.get(id));}
}
const key='nvapi-'+ 'z'.repeat(40),providerId='12345678-1234-1234-1234-123456789abc';
const input={sequence:'ACDEFG',compounds:'CCO ethanol\nc1ccccc1 benzene',msaMode:'single',samples:2};
const response={structures:[0,1].map(i=>({format:'mmcif',structure:'data_saved_'+i})),confidence_scores:[.2,.8]};
test('remote controls do not claim ignored seeds or unsupported OpenFold sampling parameters',async()=>{
  const boltz=hostedRequest(input),of3=hostedRequest({...input,model:'openfold3'});
  assert.equal(boltz.request.seed,undefined);assert.equal(of3.request.steps,undefined);assert.equal(of3.request.recycles,undefined);
  const store=new Store(),r=await createHostedRun({...input,model:'openfold3'},{store}),j=(await store.jobs(r.id))[0];
  const body=hostedBody(r,j);assert.equal(body.inputs[0].diffusion_samples,2);assert.equal(body.inputs[0].molecules[1].smiles,'CCO');
  assert.equal(body.inputs[0].sampling_steps,undefined);assert.equal(body.inputs[0].output_format,'cif');
  assert.throws(()=>hostedRequest({...input,model:'openfold3',samples:6}),/1–5/);
  assert.throws(()=>hostedRequest({...input,msaMode:'provided',a3m:'>wrong\nGGGGGG\n'}),/query must match/);
});
test('the actual documented OpenFold3 envelope preserves per-structure ranking and confidence',async()=>{
  const store=new Store(),r=await createHostedRun({...input,model:'openfold3',compounds:'CCO one'},{store});
  const native={outputs:[{input_id:'native-input',structures_with_scores:[
    {format:'cif',structure:'data_native_1',confidence_score:.82,iptm_score:.7},
    {format:'cif',structure:'data_native_2',confidence_score:.65,iptm_score:.6}]}]};
  const done=await executeHostedRun(r,{store,key,call:async()=>({status:'complete',data:native})});
  assert.equal(done.status,'complete');const j=(await store.jobs(r.id))[0];
  assert.equal(j.structures[0].structure,'data_native_1');assert.equal(j.structures[0].confidence_score,.82);
  assert.deepEqual(j.rawResponse,native);
});
test('all accepted jobs are checkpointed, then resumed by GET without repeating a submission',async()=>{
  const store=new Store(),run=await createHostedRun(input,{store}),controller=new AbortController();let submits=0,polls=0;
  await assert.rejects(executeHostedRun(run,{store,key,signal:controller.signal,call:async(path)=>{
    if(path==='submit'){submits++;return {status:'queued',requestId:providerId.slice(0,-1)+submits};}
    polls++;controller.abort();throw new DOMException('paused','AbortError');
  }}),/paused/);
  assert.equal(submits,2);assert.equal(polls,1);assert.equal(new Set((await store.jobs(run.id)).map(j=>j.providerRequestId)).size,2);
  const saved=await store.getRun(run.id);
  const done=await executeHostedRun(saved,{store,key,call:async path=>{assert.ok(path.startsWith('status/'));return {status:'complete',requestId:path.slice(7),data:response};}});
  const jobs=await store.jobs(run.id);assert.equal(done.status,'complete');assert.equal(progress(done,jobs).structures,4);
  assert.equal(jobs[0].rawResponse.structures[0].structure,'data_saved_0');assert.equal(jobs[0].structures[0].sha256.length,64);
  assert.equal(jobs[0].rawResponse.confidence_scores[0],.2); // Preserve original order, not best-first.
  assert.ok(!JSON.stringify([done,jobs]).includes(key));
});
test('imported unfinished entries cannot create paid work, and duplicate upstream IDs stop instead of misassigning poses',async()=>{
  const store=new Store(),run=await createHostedRun(input,{store});
  const result=await executeHostedRun({...run,retrieveOnly:true},{store,key,call:()=>assert.fail('Imports must not submit')});
  assert.equal(result.status,'retrieved-submitted-only');
  let calls=0;
  await assert.rejects(executeHostedRun(run,{store,key,call:async()=>{calls++;return {status:'queued',requestId:providerId};}}),/same request ID/);
  assert.equal(calls,2);assert.equal((await store.jobs(run.id))[1].status,'submission-unknown');
});
test('a lost POST response blocks resubmission until an explicit provider-ID recovery',async()=>{
  const store=new Store(),r=await createHostedRun({...input,compounds:'CCO ethanol'},{store});let calls=0;
  await assert.rejects(executeHostedRun(r,{store,key,call:async()=>{calls++;throw Error('network response lost');}}),/network response lost/);
  let j=(await store.jobs(r.id))[0];assert.equal(j.status,'submission-unknown');assert.equal(calls,1);
  await assert.rejects(executeHostedRun(await store.getRun(r.id),{store,key,call:()=>assert.fail('Never retry POST')}),/unknown outcome/);
  j=await recoverHostedJob(j,providerId,{store});assert.equal(j.status,'queued');
  await executeHostedRun(await store.getRun(r.id),{store,key,call:async path=>{assert.equal(path,'status/'+providerId);return {status:'complete',data:response};}});
});
test('storage failure before POST makes no request; an accepted ID remains exportable in memory on write failure',async()=>{
  const store=new Store(),r=await createHostedRun(input,{store});store.saveJob=async()=>{throw Error('QuotaExceededError');};
  await assert.rejects(executeHostedRun(r,{store,key,call:()=>assert.fail('No paid call before durable submission marker')}),/Quota/);
  const s=new Store(),run=await createHostedRun({...input,compounds:'CCO one'},{store:s});let recovery=null;
  await assert.rejects(executeHostedRun(run,{store:s,key,call:async()=>{s.saveJob=async()=>{throw Error('Quota');};return {status:'queued',requestId:providerId};},
    onProgress:(_p,jobs)=>{recovery=structuredClone(jobs);}}),/Quota/);
  assert.equal(recovery[0].providerRequestId,providerId);
});
test('a provider terminal rejection is preserved and missing samples are not counted as success',async()=>{
  const s=new Store(),r=await createHostedRun({...input,compounds:'CCO one'},{store:s});
  const done=await executeHostedRun(r,{store:s,key,call:async()=>({status:'complete',data:{structures:[response.structures[0]]}})});
  assert.equal(done.status,'complete-with-failures');assert.equal((await s.jobs(r.id))[0].sampleShortfall,1);
  assert.equal(progress(done,await s.jobs(r.id)).structures,1);
});
test('invalid credentials and Local Lab mode cannot create a submission marker or call a service',async()=>{
  const s=new Store(),r=await createHostedRun(input,{store:s});
  await assert.rejects(executeHostedRun(r,{store:s,key:'',call:()=>assert.fail()}),/API key/);
  assert.equal((await s.jobs(r.id))[0].status,'unsubmitted');
  globalThis.MOLARIUM_RUNTIME_CONFIG={localOnly:true};
  try{await assert.rejects(executeHostedRun(r,{store:s,key,call:()=>assert.fail()}),/connected mode/);}
  finally{delete globalThis.MOLARIUM_RUNTIME_CONFIG;}
});
