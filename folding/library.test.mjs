import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryRequest,createLibrary,executeLibrary,queueProgress} from './library.mjs';
import {createChemistActionsApi} from '../chemist-actions.mjs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {LibraryController} from './library-ui.mjs';
class MemoryStore {
  runs=new Map();poses=new Map();
  async saveRun(r){this.runs.set(r.id,structuredClone(r));}
  async records(_name,id){return [...this.poses.values()].filter(p=>p.runId===id);}
  async checkpoint(r,p){await this.saveRun(r);this.poses.set(p.id,{...structuredClone(p),runId:r.id});}
}
test('SMILES list preserves entries, rejects duplicate IDs and pins model and seed range',()=>{
  const r=libraryRequest({sequence:'ACD',compounds:'# comment\nCCO ethanol\nCCO\n',samples:2});
  assert.deepEqual(r.compounds.map(c=>c.id),['ethanol','compound-3']);assert.equal(r.request.model,'localfold-openbind0');
  assert.throws(()=>libraryRequest({sequence:'ACD',compounds:'C same\nN same'}),/unique/);
  assert.throws(()=>libraryRequest({sequence:'ACD',compounds:'C',seed:4294967295,samples:2}),/32-bit/);
  assert.throws(()=>libraryRequest({sequence:'ACD',compounds:[],samples:1}),/1–10,000/);
  assert.throws(()=>libraryRequest({sequence:'ACD',compounds:'C',model:'localfold-af2'}),/requires localfold-openbind0/);
});
test('status polling before the first checkpoint has a valid starting/idle response',async()=>{
  const controller=new LibraryController();assert.equal((await controller.status()).status,'idle');
  controller.creating=true;assert.equal((await controller.status()).status,'starting');
});
test('serial queue checkpoints failures, pins shared alignment and resumes only unfinished science',async()=>{
  const store=new MemoryStore(),run=await createLibrary({sequence:'ACD',compounds:'CCO a\nbad b',samples:2},{store});
  const controller=new AbortController(),calls=[],events=[];let tick=0;
  const predict=async(r,{onProgress})=>{calls.push(r);onProgress({fraction:.8});onProgress({stage:'next'});
    if(calls.length===2){controller.abort();throw new DOMException('Stopped','AbortError');}
    return {pdb:'result',elapsedMs:10,provenance:{alignment:'>query\nACD\n'}};};
  const paused=await executeLibrary(run,{store,predict,signal:controller.signal,clock:()=>tick+=10,onProgress:p=>events.push(p)});
  assert.equal(paused.status,'paused');assert.equal(paused.completed,1);assert.equal(store.poses.size,2);
  const resumedCalls=[];
  const completed=await executeLibrary(paused,{store,predict:async r=>{resumedCalls.push(r);if(r.ligand.value==='bad')throw new Error('Invalid SMILES');return {pdb:'ok',provenance:{}};}});
  assert.equal(completed.completed,2);assert.equal(completed.failed,2);assert.equal(completed.status,'complete-with-failures');
  assert.equal(resumedCalls.length,3);assert.equal(resumedCalls[0].seed,1);assert.equal(resumedCalls[0].a3m,'>query\nACD\n');
  assert.equal(store.poses.size,5,'original interrupted attempt is preserved');
  await executeLibrary(completed,{store,predict:()=>assert.fail('completed work must not rerun')});
  const current=events.filter(p=>p.current?.compoundId==='a'&&p.current.sample===0);
  assert.equal(current.at(-1).current.fraction,.8,'later stages do not reset progress');
});
test('ETA excludes first cold pose and storage failure stops further predictions',async()=>{
  const run={id:'r',total:4,status:'running'},poses=[{status:'complete',wallMs:5000},{status:'complete',wallMs:1000}];
  assert.equal(queueProgress(run,poses,{fraction:.5}).etaMs,1500);
  assert.equal(queueProgress(run,poses.slice(0,1)).etaMs,null);
  const store=new MemoryStore(),r=await createLibrary({sequence:'ACD',compounds:'C a\nN b',samples:1},{store});
  store.checkpoint=async()=>{throw new Error('Quota exceeded');};let calls=0;
  await assert.rejects(executeLibrary(r,{store,predict:async()=>{calls++;return {pdb:'ok'};}}),/Quota/);assert.equal(calls,1);
});
test('shared infrastructure failure stops the queue instead of failing every ligand',async()=>{
  const store=new MemoryStore(),run=await createLibrary({sequence:'ACD',compounds:'C a\nN b',samples:1},{store});let calls=0;
  await assert.rejects(executeLibrary(run,{store,predict:async()=>{calls++;throw new Error('Failed to fetch weights');}}),/infrastructure stopped/);
  assert.equal(calls,1);assert.equal(store.runs.get(run.id).status,'stopped');assert.equal(store.poses.size,1);
});
test('live status excludes upstream GPU objects and remains safely cloneable',async()=>{
  const store=new MemoryStore(),run=await createLibrary({sequence:'ACD',compounds:'C',samples:1},{store});let observed;
  await executeLibrary(run,{store,predict:async(_r,{onProgress})=>{
    onProgress({stage:'trunk-done',detail:{pass:1,trunk:{gpuBuffer:()=>{}}},buffer:()=>{}});return {pdb:'x'};
  },onProgress:p=>{if(p.current?.stage==='trunk-done')observed=structuredClone(p);}});
  assert.deepEqual(observed.current.detail,{pass:1});assert.equal(observed.current.buffer,undefined);
});
test('pause and queue status bypass the long action queue',async()=>{
  let release;const pending=new Promise(r=>release=r),calls=[];
  const api=createChemistActionsApi({enabledActions:['protein.cofoldLibrary','protein.pauseLibrary','protein.libraryStatus'],routes:{
    'protein.cofoldLibrary':async()=>{await pending;return {};},
    'protein.pauseLibrary':async()=>{calls.push('pause');release();return {};},
    'protein.libraryStatus':async()=>{calls.push('status');return {};}}});
  const job=api.execute({action:'protein.cofoldLibrary'});await Promise.resolve();
  await api.execute({action:'protein.libraryStatus'});await api.execute({action:'protein.pauseLibrary'});await job;
  assert.deepEqual(calls,['status','pause']);
});
test('bulk library API accepts 10,000 explicit entries without relaxing other action limits',async()=>{
  const entries=Array.from({length:10000},(_,i)=>({id:`c${i}`,smiles:'CCO'}));
  const api=createChemistActionsApi({enabledActions:['protein.cofoldLibrary','session.inspect'],routes:{
    'protein.cofoldLibrary':async args=>({count:libraryRequest(args).compounds.length}),'session.inspect':async()=>({})}});
  const result=await api.execute({action:'protein.cofoldLibrary',args:{sequence:'ACD',compounds:entries}});
  assert.equal(result.result.count,10000);
  await assert.rejects(api.execute({action:'session.inspect',args:{entries}}),/too large/);
});
test('library storage omits quadratic PAE by default and preserves its numeric hash and shared MSA',async()=>{
  const store=new MemoryStore(),run=await createLibrary({sequence:'ACD',compounds:'C',samples:1},{store});
  await executeLibrary(run,{store,predict:async()=>({pdb:'x',pae:new Float32Array([1,2,3,4]),provenance:{alignment:'>query\nACD\n'}})});
  const result=[...store.poses.values()][0].result;
  assert.equal(result.pae,null);assert.equal(result.paeStorage.values,4);assert.equal(result.paeStorage.sha256.length,64);
  assert.equal(result.provenance.alignmentRef,'run.alignment');assert.equal(store.runs.get(run.id).alignment,'>query\nACD\n');
});
test('Foldarium distribution matches its pinned source receipt and self-hosts viewer code',async()=>{
  const base=new URL('../vendor/foldarium/',import.meta.url),receipt=JSON.parse(await readFile(new URL('UPSTREAM.json',base)));
  assert.match(receipt.revision,/^[0-9a-f]{40}$/);assert.equal(receipt.files.length,9);
  for(const f of receipt.files){const bytes=await readFile(new URL(f.path,base));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256,f.path);
    if(f.path!=='library-review.html')assert.equal(f.sha256,f.upstreamSha256,f.path);}
  const html=await readFile(new URL('library-review.html',base),'utf8');assert.doesNotMatch(html,/https:\/\/cdn/);
  assert.match(html,/molstar-5\.11\.0\.js/);
});
