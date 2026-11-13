// Actual IndexedDB regression; no model inference. The pinned upstream stays intact.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {startMolariumBrowser,waitFor} from './headless-chrome.mjs';
const b=await startMolariumBrowser({root:resolve(import.meta.dirname,'..'),appPath:'?blank=1'});
try{
 await waitFor(()=>b.evaluate('Boolean(window.MolariumChemistActionsReady)'),60000,'app');
 const result=await b.evaluate(`(async()=>{
   const {LibraryStore}=await import('./folding/library-store.mjs');
   const {createLibrary,executeLibrary}=await import('./folding/library.mjs');
   const store=new LibraryStore(),run=await createLibrary({sequence:'ACD',compounds:'CCO ethanol',samples:2},{store});
   let predictions=0,closedDuringCheckpoint=false;
   const checkpoint=store.checkpoint.bind(store);
   store.checkpoint=async(...args)=>{
     if(!closedDuringCheckpoint){closedDuringCheckpoint=true;(await store.database()).close();}
     return checkpoint(...args);
   };
   const completed=await executeLibrary(run,{store,predict:async()=>{predictions++;return {
     pdb:'ATOM  test\\nHETATM test\\n',provenance:{},elapsedMs:1};}});
   (await store.database()).close();
   const [saved,poses]=await Promise.all([store.getRun(run.id),store.records('poses',run.id)]);
   await executeLibrary(saved,{store,predict:()=>{throw Error('Completed prediction was repeated');}});
   (await store.database()).close();
   await store.decide(run.id,{id:'choice',compoundId:'ethanol',poseId:poses[0].id,value:'preferred'});
   const bundle=await store.bundle(run.id);
   const quota=new LibraryStore();let quotaAttempts=0,quotaRejected=false;
   quota.database=async()=>({transaction(){quotaAttempts++;throw new DOMException('Quota exceeded','QuotaExceededError');}});
   try{await quota.saveRun(run);}catch(e){quotaRejected=e.name==='QuotaExceededError';}
   const lossStore=new LibraryStore(),lossRun=await createLibrary({sequence:'ACD',compounds:'CCO loss-test',samples:3},{store:lossStore});
   const atomicCheckpoint=lossStore.checkpoint.bind(lossStore);let evicted=false,lossPredictions=0,lossRejected=false;
   lossStore.checkpoint=async(...args)=>{
     if(!evicted&&args[2]?.length){evicted=true;await new Promise((resolve,reject)=>{
       const d=indexedDB.deleteDatabase('foldarium-local-libraries');d.onsuccess=resolve;d.onerror=()=>reject(d.error);d.onblocked=()=>reject(Error('Test database deletion blocked'));});}
     return atomicCheckpoint(...args);
   };
   try{await executeLibrary(lossRun,{store:lossStore,predict:async()=>{lossPredictions++;return {
     pdb:'ATOM  retained\\nHETATM retained\\n',provenance:{outputPdbSha256:'test-'+lossPredictions}};}});}catch(e){lossRejected=e.message.includes('storage lost');}
   const stopped=await lossStore.getRun(lossRun.id),retained=await lossStore.records('poses',lossRun.id);
   let resumeBlocked=false;try{await executeLibrary(stopped,{store:lossStore,predict:()=>{throw Error('Lost completed inference repeated');}});}catch(e){resumeBlocked=e.message.includes('cannot resume automatically');}
   return {status:completed.status,saved:saved.completed,poses:poses.length,predictions,
     decisions:bundle.decisions.length,quotaAttempts,quotaRejected,
     eviction:{lossRejected,status:stopped.status,predictions:lossPredictions,retained:retained.length,missing:stopped.storageLoss.missing.length,resumeBlocked}};
 })()`);
 assert.deepEqual(result,{status:'complete',saved:2,poses:2,predictions:2,decisions:1,quotaAttempts:1,quotaRejected:true,
   eviction:{lossRejected:true,status:'stopped',predictions:2,retained:1,missing:1,resumeBlocked:true}});
 console.log('Actual IndexedDB closing recovery: exact completed poses preserved, no repeated inference, concurrent reads and decisions recover, quota fails closed. PASS');
}finally{await b.close();}
