import {foldingRequest,COFOLD_FAMILIES} from './request.mjs';
import {poseSummary} from '../vendor/foldarium/library-store.js';
import {LibraryStore} from './library-store.mjs';
export {LibraryStore};
const now=()=>new Date().toISOString();
const aborted=signal=>{if(signal?.aborted)throw signal.reason??new DOMException('Aborted','AbortError');};
function publicProgress(p) {
  // Upstream stage detail can contain live GPU tensors; status must stay small,
  // cloneable and independent of their lifetime.
  const out={};
  for(const key of ['stage','message','loadedBytes','totalBytes','step','steps'])
    if(['string','number','boolean'].includes(typeof p?.[key]))out[key]=p[key];
  if(p?.detail&&typeof p.detail==='object')out.detail=Object.fromEntries(Object.entries(p.detail)
    .filter(([_k,v])=>['string','boolean'].includes(typeof v)||typeof v==='number'&&Number.isFinite(v)));
  return out;
}
export function libraryRequest(input) {
  if(!input||typeof input!=='object')throw new Error('Library request must be an object.');
  const model=input.model??'localfold-openbind0';
  if(!Object.hasOwn(COFOLD_FAMILIES,model))throw new Error('Library cofolding requires localfold-openbind0 or localfold-boltz2.');
  if(input.ligand)throw new Error('Provide library ligands through compounds, not the single-ligand field.');
  const request=foldingRequest({...input,model,ligand:undefined});
  let compounds=input.compounds;
  if(typeof compounds==='string') compounds=compounds.split(/\r?\n/).map((line,i)=>({line:i+1,text:line.trim()}))
    .filter(l=>l.text&&!l.text.startsWith('#')).map(l=>{
      const [smiles,...name]=l.text.split(/\s+/);return {id:name.join(' ')||`compound-${l.line}`,smiles,line:l.line};
    });
  if(!Array.isArray(compounds)||!compounds.length||compounds.length>10000)
    throw new Error('Provide 1–10,000 compounds: one SMILES per line, optionally followed by a name.');
  const ids=new Set();
  compounds=compounds.map((c,i)=>{
    if(typeof c==='string')c={smiles:c,id:`compound-${i+1}`};
    if(!c||typeof c.smiles!=='string'||!c.smiles.trim()||c.smiles.length>10000||/\s/.test(c.smiles.trim()))throw new Error(`Invalid SMILES entry ${i+1}.`);
    const id=String(c.id??`compound-${i+1}`).trim();
    if(!id||id.length>200||ids.has(id))throw new Error(`Compound IDs must be unique (entry ${i+1}: ${id}).`);
    ids.add(id);return {id,smiles:c.smiles.trim(),line:c.line??i+1};
  });
  const samples=input.samples??3;
  if(!Number.isInteger(samples)||samples<1||samples>20)throw new Error('Choose 1–20 poses per compound.');
  if(request.seed+samples-1>4294967295)throw new Error('Base seed plus number of poses exceeds the 32-bit seed range.');
  if(input.retainPae!==undefined&&typeof input.retainPae!=='boolean')throw new Error('retainPae must be boolean.');
  return {name:String(input.name??'Cofolding library').slice(0,200),request,compounds,samples,retainPae:input.retainPae??false};
}
export async function createLibrary(input,{store=new LibraryStore()}={}) {
  const validated=libraryRequest(input);
  const run={schema:'molarium.cofolding-run.v1',id:crypto.randomUUID(),...validated,
    createdAt:now(),updatedAt:now(),status:'ready',completed:0,failed:0,total:validated.compounds.length*validated.samples,
    sessions:[],alignment:null,producer:{application:'Molarium',webCodeVersion:new URL(import.meta.url).searchParams.get('v')},
    environment:{userAgent:globalThis.navigator?.userAgent??null}};
  if(globalThis.navigator?.gpu){const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
    if(adapter?.info)run.environment.gpu=Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,adapter.info[k]]));}
  await store.saveRun(run);return run;
}
export function queueProgress(run,poses,current=null,sessionElapsedMs=0) {
  // Latest status per planned pose. Failed attempts stay in the exported history.
  const completed=poses.filter(p=>p.status==='complete').sort((a,b)=>(a.finishedAt??'').localeCompare(b.finishedAt??'')), failed=poses.filter(p=>p.status==='failed');
  const remaining=Math.max(0,run.total-completed.length-failed.length);
  const warm=completed.slice(1).map(p=>p.wallMs).filter(Number.isFinite);
  const mean=warm.length?warm.reduce((a,b)=>a+b,0)/warm.length:null;
  return {runId:run.id,status:run.status,total:run.total,completed:completed.length,failed:failed.length,
    elapsedMs:sessionElapsedMs,firstPoseMs:completed[0]?.wallMs??null,warmMeanMs:mean,etaMs:mean===null?null:Math.max(0,(remaining-(current?.fraction??0))*mean),
    fraction:(completed.length+failed.length+(current?.fraction??0))/run.total,current};
}
export async function executeLibrary(run,{store=new LibraryStore(),predict,signal,onProgress=()=>{},clock=()=>performance.now()}={}) {
  predict??=(await import('./localfold.mjs')).predictLocalFold;
  const poses=await store.records('poseIndex',run.id), started=clock(), session={startedAt:now(),finishedAt:null,elapsedMs:null};
  if(run.status==='imported')throw new Error('Imported libraries are for review. Create a new run to compute new poses.');
  if(run.storageLoss)throw new Error('Browser storage lost saved checkpoints. Export available results; this run cannot resume automatically.');
  const count=status=>poses.filter(p=>p.status===status).length;
  if(count('complete')!==(run.completed??0)||count('failed')!==(run.failed??0))
    throw new Error('Browser storage is missing saved poses. Export available results; this run cannot resume automatically.');
  run={...run,status:'running',sessions:[...(run.sessions??[]),session]};
  let pending=null;
  const emit=current=>onProgress(queueProgress(run,poses,current,clock()-started));
  const missingFrom=durable=>{const index=new Map(durable.map(p=>[p.id,p]));return poses.filter(p=>{
    const q=index.get(p.id);return ['complete','failed'].includes(p.status)
      &&(!q||q.status!==p.status||(p.outputPdbSha256&&q.outputPdbSha256!==p.outputPdbSha256));});};
  const requirePrevious=async currentPose=>{
    const durable=await store.records('poseIndex',run.id),missing=missingFrom(durable);
    if(!missing.length)return;
    run.storageLoss={detectedAt:now(),missing:missing.map(({id,poseKey,seed,status,outputPdbSha256})=>({id,poseKey,seed,status,outputPdbSha256})),
      currentPosePreserved:Boolean(currentPose),message:'Previously saved checkpoints disappeared from browser storage.'};
    poses.splice(0,poses.length,...durable);
    run={...run,status:'stopped',completed:count('complete')+ +(currentPose?.status==='complete'),
      failed:count('failed')+ +(currentPose?.status==='failed')};
    if(currentPose){await store.checkpoint(run,currentPose);poses.push(poseSummary(currentPose));pending=null;}
    throw new Error('Browser storage lost previously saved poses. Available results are retained; export them. This run cannot resume automatically.');
  };
  try {
    await store.saveRun(run);emit(null);
    for(const c of run.compounds)for(let sample=0;sample<run.samples;sample++) {
      aborted(signal);
      const poseKey=`${c.id}::${sample}`, history=poses.filter(p=>p.poseKey===poseKey);
      // Resume only unfinished/interrupted work. Failures are explicit terminal results.
      if(history.some(p=>['complete','failed'].includes(p.status)))continue;
      await requirePrevious();
      const attempt=history.length+1, id=`${poseKey}::attempt-${attempt}`, seed=run.request.seed+sample;
      pending={id,poseKey,compoundId:c.id,sample,seed,attempt,status:'interrupted',startedAt:now()};
      const t=clock();let result,error,fraction=0;
      try {
        emit({compoundId:c.id,sample,stage:'starting',message:'Preparing ligand and loading model',fraction:0});
        result=await predict({...run.request,
          ...(run.alignment?{msaMode:'provided',a3m:run.alignment}:{}),ligand:{type:'smiles',value:c.smiles},seed},
          {signal,onProgress:p=>{aborted(signal);fraction=Math.max(fraction,Math.min(.99,Number.isFinite(p.fraction)?p.fraction:0));
            emit({compoundId:c.id,sample,...publicProgress(p),fraction});}});
        aborted(signal);
      }catch(e){if(signal?.aborted||e?.name==='AbortError')throw e;error=e;}
      const pose={...pending,status:error?'failed':'complete',finishedAt:now(),wallMs:clock()-t,
        ...(result?.provenance?.outputPdbSha256?{outputPdbSha256:result.provenance.outputPdbSha256}:{}),
        ...(error?{error:String(error.message??error)}:{result})};
      if(result?.provenance?.alignment&&!run.alignment)run.alignment=result.provenance.alignment;
      if(result){
        if(result.provenance?.alignment)result={...result,provenance:{...result.provenance,alignment:undefined,alignmentRef:'run.alignment'}};
        if(!run.retainPae&&result.pae){
          const buffer=new ArrayBuffer(result.pae.length*4),view=new DataView(buffer);
          for(let i=0;i<result.pae.length;i++)view.setFloat32(i*4,result.pae[i],true);
          const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');
          result={...result,pae:null,paeStorage:{retained:false,encoding:'IEEE 754 float32 little-endian',sha256,values:buffer.byteLength/4,
            reason:'Library default omits quadratic PAE arrays; enable retainPae to keep them.'}};
        }
        pose.result=result;
      }
      run={...run,updatedAt:now(),completed:poses.filter(p=>p.status==='complete').length+ +!error,
        failed:poses.filter(p=>p.status==='failed').length+ +!!error};
      // A storage/quota failure stops the run before another expensive prediction.
      await requirePrevious(pose);
      try{await store.checkpoint(run,pose,poses);}
      catch(e){if(e?.name==='CheckpointLossError')await requirePrevious(pose);throw e;}
      poses.push(poseSummary(pose));pending=null;emit(null);
      if(error&&/device.*lost|out of memory|allocation|WebGPU|GPU.*lost|no compatible.*adapter|failed to fetch|HTTP\s+\d+|weights|model manifest|MSA.*(?:fail|error|unavailable)/i.test(pose.error))
        throw new Error(`Library infrastructure stopped: ${pose.error}`);
    }
    run.status=run.failed?'complete-with-failures':'complete';
  }catch(e){
    run.status=signal?.aborted||e?.name==='AbortError'?'paused':'stopped';run.lastError=String(e.message??e);
    if(pending){const p={...pending,finishedAt:now(),error:run.lastError};await store.checkpoint(run,p);poses.push(p);}
    if(run.status==='stopped')throw e;
  }finally{
    session.finishedAt=now();session.elapsedMs=clock()-started;run.updatedAt=now();
    try{await store.saveRun(run,run.status.startsWith('complete')?poses:undefined);}
    catch(e){
      if(e?.name==='CheckpointLossError'){
        run.status='stopped';run.lastError=e.message;run.storageLoss={detectedAt:now(),missing:e.missing,currentPosePreserved:false};
        const durable=await store.records('poseIndex',run.id);poses.splice(0,poses.length,...durable);
        run.completed=count('complete');run.failed=count('failed');await store.saveRun(run);emit(null);
      }
      throw e;
    }
    emit(null);
  }
  return run;
}
