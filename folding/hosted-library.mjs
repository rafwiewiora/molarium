// Hosted jobs and their original provider files. No WebGPU model is loaded here.
import {libraryRequest} from './library.mjs';
export const HOSTED_MODELS=Object.freeze({boltz2:'Boltz-2 · NVIDIA',openfold3:'OpenFold3 · NVIDIA'});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const now=()=>new Date().toISOString();
export const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
const abort=signal=>{if(signal?.aborted)throw signal.reason??new DOMException('Paused','AbortError');};
export function hostedRequest(input){
  const model=input.model??'boltz2';
  if(!Object.hasOwn(HOSTED_MODELS,model))throw Error('Choose a supported NVIDIA model.');
  const validated=libraryRequest({...input,model:'localfold-boltz2',steps:input.steps??200,recycles:input.recycles??3,
    msaMode:input.msaMode??'search'});
  if(validated.request.sequence.length>4096)throw Error('The hosted API accepts at most 4,096 protein residues.');
  if(model==='openfold3'&&validated.samples>5)throw Error('The hosted OpenFold3 API accepts 1–5 structures per compound.');
  if(model==='boltz2'&&(validated.request.steps<10||validated.request.recycles<1||validated.request.recycles>10))
    throw Error('NVIDIA Boltz-2 needs 10–200 sampling steps and 1–10 recycling steps.');
  const request={...validated.request,model:'nvidia-'+model};delete request.seed;
  if(model==='openfold3'){delete request.steps;delete request.recycles;}
  if(request.msaMode==='provided')validateAlignment(request.a3m,request.sequence);
  return {...validated,model,request,
    note:model==='openfold3'?'The hosted OpenFold3 API chooses diffusion steps and recycling internally.':'Boltz-2 sampling and recycling controls are sent explicitly.',
    seedPolicy:'Random seeds are managed by the provider; no browser seed is asserted.'};
}
function validateAlignment(alignment,sequence){
  const first=alignment.split(/^>/m).find(s=>s.trim())?.split(/\r?\n/).slice(1).join('').replace(/[a-z\s]/g,'');
  if(first!==sequence)throw Error('The alignment query must match the protein sequence.');
}
export class HostedStore{
  async database(){
    if(!this.opened)this.opened=new Promise((resolve,reject)=>{
      const r=indexedDB.open('molarium-hosted-cofolding-v1',1);
      r.onupgradeneeded=()=>{const db=r.result;db.createObjectStore('runs',{keyPath:'id'});
        db.createObjectStore('jobs',{keyPath:'id'}).createIndex('runId','runId');};
      r.onerror=()=>{this.opened=null;reject(r.error);};
      r.onblocked=()=>{this.opened=null;reject(Error('Close older server-folding tabs to open saved jobs.'));};
      r.onsuccess=()=>{const db=r.result;db.onversionchange=()=>{db.close();this.opened=null;};resolve(db);};
    });return this.opened;
  }
  async access(table,mode,operation){const db=await this.database();return new Promise((resolve,reject)=>{
    const tx=db.transaction(table,mode),request=operation(tx.objectStore(table));let result;
    request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(tx.error??Error('Local server-job storage failed.'));
  });}
  saveRun(run){return this.access('runs','readwrite',s=>s.put(run));}
  saveJob(job){return this.access('jobs','readwrite',s=>s.put(job));}
  getRun(id){return this.access('runs','readonly',s=>s.get(id));}
  getJob(id){return this.access('jobs','readonly',s=>s.get(id));}
  runs(){return this.access('runs','readonly',s=>s.getAll());}
  jobs(id){return this.access('jobs','readonly',s=>s.index('runId').getAll(id));}
  async bundle(id){const run=await this.getRun(id);if(!run)throw Error('Saved server library not found.');return {schema:'molarium.hosted-library.v1',run,jobs:await this.jobs(id)};}
}
export async function createHostedRun(input,{store=new HostedStore()}={}){
  const spec=hostedRequest(input),id=crypto.randomUUID();
  const run={schema:'molarium.hosted-run.v1',id,...spec,createdAt:now(),updatedAt:now(),status:'ready',
    provider:'NVIDIA hosted API',totalJobs:spec.compounds.length,totalSamples:spec.compounds.length*spec.samples,
    alignment:spec.request.msaMode==='provided'?spec.request.a3m:null};
  for(const compound of spec.compounds)await store.saveJob({id:id+'::'+compound.id,runId:id,compound,status:'unsubmitted',
    samples:spec.samples,createdAt:now(),decisions:{},structures:[],providerRequestId:null});
  await store.saveRun(run);return run;
}
export function hostedBody(run,job){
  const msa={main:{a3m:{alignment:run.alignment??`>query\n${run.request.sequence}\n`,format:'a3m',rank:0}}};
  if(run.model==='boltz2')return {polymers:[{id:'A',molecule_type:'protein',sequence:run.request.sequence,msa}],
    ligands:[{id:'B',smiles:job.compound.smiles}],recycling_steps:run.request.recycles,
    sampling_steps:run.request.steps,diffusion_samples:run.samples,output_format:'mmcif'};
  return {inputs:[{input_id:job.id.replace(/[^A-Za-z0-9_-]/g,'-').slice(0,128),
    molecules:[{type:'protein',id:'A',sequence:run.request.sequence,msa},{type:'ligand',id:'B',smiles:job.compound.smiles}],
    diffusion_samples:run.samples,output_format:'cif'}]};
}
export async function relayCall(path,{key,body,signal,fetchImplementation=fetch}={}){
  if(globalThis.MOLARIUM_RUNTIME_CONFIG?.localOnly)throw Error('Server folding needs connected mode.');
  if(typeof key!=='string'||!/^nvapi-[A-Za-z0-9_-]{20,512}$/.test(key.trim()))throw Error('Enter your NVIDIA API key.');
  const response=await fetchImplementation('/api/cofold/nvidia/'+path,{method:body?'POST':'GET',
    headers:{Authorization:'Bearer '+key.trim(),'Content-Type':'application/json'},cache:'no-store',
    ...(body?{body:JSON.stringify(body)}:{}),signal});
  let data;try{data=await response.json();}catch{throw Error('The server relay returned an invalid response.');}
  if(!response.ok){const error=Error(data.error??`Server request failed (HTTP ${response.status}).`);
    error.submissionUnknown=data.submissionUnknown;error.providerStatus=data.providerStatus;
    error.requestId=data.requestId;error.detail=data.detail;throw error;}
  return data;
}
export function progress(run,jobs){
  const accepted=jobs.filter(j=>Boolean(j.providerRequestId)||['received','complete'].includes(j.status)).length;
  const complete=jobs.filter(j=>j.status==='complete').length,failed=jobs.filter(j=>j.status==='failed').length;
  const structures=jobs.reduce((n,j)=>n+(j.structures?.length??0),0);
  return {runId:run.id,status:run.status,total:jobs.length,accepted,complete,failed,structures,expectedStructures:run.totalSamples,
    fraction:jobs.length?(complete+failed)/jobs.length:0,unknown:jobs.filter(j=>j.status==='submission-unknown').length};
}
function structuresFrom(data,model){
  // Preserve the published Boltz shape and the one-input OpenFold3 envelope.
  const value=model==='openfold3'&&Array.isArray(data.outputs)?data.outputs[0]:data;
  const structures=model==='openfold3'?value?.structures_with_scores:value?.structures;
  if(!Array.isArray(structures)||!structures.length||structures.length>25)
    throw Error('The provider response has no supported structure list. Raw data remains saved for download.');
  return structures.map((s,i)=>{
    if(!s||typeof s.structure!=='string'||!s.structure.trim()||s.structure.length>8*1024*1024||!['pdb','mmcif','cif'].includes(s.format?.toLowerCase()))
      throw Error('Unsupported provider structure format. Raw data remains saved for download.');
    return {...s,index:i,format:s.format.toLowerCase()};
  });
}
const delay=(ms,signal)=>new Promise((resolve,reject)=>{abort(signal);const timer=setTimeout(done,ms);
  function done(){signal?.removeEventListener('abort',stop);resolve();}function stop(){clearTimeout(timer);reject(signal.reason??new DOMException('Paused','AbortError'));}
  signal?.addEventListener('abort',stop,{once:true});});
export async function executeHostedRun(run,{store=new HostedStore(),key,signal,onProgress=()=>{},
  call=relayCall,searchAlignment,pollInterval=5000,sleep=delay}={}){
  if(globalThis.MOLARIUM_RUNTIME_CONFIG?.localOnly)throw Error('Server folding needs connected mode.');
  if(typeof key!=='string'||!/^nvapi-[A-Za-z0-9_-]{20,512}$/.test(key.trim()))throw Error('Enter your NVIDIA API key before starting or resuming.');
  let jobs=await store.jobs(run.id);
  const planned=new Map(run.compounds.map((c,i)=>[c.id,{compound:c,index:i}]));
  if(jobs.length!==run.totalJobs||new Set(jobs.map(j=>j.id)).size!==jobs.length||jobs.some(j=>
    j.runId!==run.id||j.id!==run.id+'::'+j.compound?.id||j.compound.smiles!==planned.get(j.compound?.id)?.compound.smiles))
    throw Error('Saved server-job records are missing or disagree with the planned compounds. Export the available data before continuing.');
  jobs.sort((a,b)=>planned.get(a.compound.id).index-planned.get(b.compound.id).index);
  run={...run,status:'running',lastError:null};await store.saveRun(run);
  const emit=()=>onProgress(progress(run,jobs),jobs);
  async function save(job){job.updatedAt=now();try{await store.saveJob(job);}catch(e){
    // Publish the current in-memory ID/result for an emergency local export.
    // A failed write must stop before the next paid submission.
    run.lastError='Local saving failed. Export the current server job IDs and results before closing this page.';emit();throw e;
  }emit();}
  async function receive(job,response){
    job.error=null;
    if(response.requestId){if(!UUID.test(response.requestId))throw Error('Invalid provider request ID.');job.providerRequestId=response.requestId;
      if(jobs.some(other=>other.id!==job.id&&other.providerRequestId===response.requestId)){
        job.status='submission-unknown';job.error='The provider returned the same request ID for different compounds. Check these requests before continuing.';await save(job);throw Error(job.error);
      }}
    if(response.status==='queued'){job.status='queued';await save(job);return;}
    if(response.status!=='complete'||!response.data)throw Error('Unsupported provider job response.');
    // Save the original response before trying to interpret its structure schema.
    job.rawResponse=response.data;job.responseCanonicalSha256=await digest(JSON.stringify(response.data));job.status='received';await save(job);
    const structures=structuresFrom(response.data,run.model);
    job.structures=await Promise.all(structures.map(async s=>({...s,sha256:await digest(s.structure)})));
    job.status='complete';job.finishedAt=now();job.sampleShortfall=Math.max(0,job.samples-structures.length);await save(job);
  }
  try{
    if(jobs.some(j=>['submitting','submission-unknown'].includes(j.status)))
      throw Error('A previous submission has an unknown outcome. Recover its NVIDIA request ID before continuing; it will not be resubmitted automatically.');
    if(!run.retrieveOnly&&jobs.some(j=>j.status==='unsubmitted')&&run.request.msaMode==='search'&&!run.alignment){
      if(!searchAlignment)throw Error('Alignment search is unavailable.');
      run.alignment=await searchAlignment(run.request.sequence,{signal});abort(signal);
      validateAlignment(run.alignment,run.request.sequence);await store.saveRun(run);
    }
    // Submission and monitoring are separate: every accepted job can continue remotely.
    for(const job of jobs){
      abort(signal);if(job.status!=='unsubmitted'||run.retrieveOnly)continue;
      job.status='submitting';job.submittedAt=now();job.request=hostedBody(run,job);
      job.requestSha256=await digest(JSON.stringify(job.request));await save(job);
      let response;
      try{response=await call('submit',{key,body:{model:run.model,input:job.request},signal});}
      catch(e){job.providerRequestId=e.requestId??job.providerRequestId;
        job.status=e.providerStatus>=400&&e.providerStatus<500&&!e.submissionUnknown?'failed':'submission-unknown';
        job.error=e.message;await save(job);throw e;}
      await receive(job,response);
    }
    emit();
    while(jobs.some(j=>['queued','received'].includes(j.status))){
      abort(signal);
      for(const job of jobs){
        abort(signal);
        if(job.status==='received'){await receive(job,{status:'complete',requestId:job.providerRequestId,data:job.rawResponse});continue;}
        if(job.status!=='queued')continue;
        try{await receive(job,await call('status/'+job.providerRequestId,{key,signal}));}
        catch(e){job.error=e.message;
          if([400,404,410,422].includes(e.providerStatus)){job.status='failed';await save(job);continue;}
          await save(job);throw e; // 401/402/429/5xx pause retrieval; never resubmit.
        }
      }
      if(jobs.some(j=>j.status==='queued'))await sleep(pollInterval,signal);
    }
    run.status=jobs.some(j=>j.status==='unsubmitted')?'retrieved-submitted-only':jobs.some(j=>j.status==='failed'||j.sampleShortfall)?'complete-with-failures':'complete';
  }catch(e){run.status=signal?.aborted?'paused':'stopped';run.lastError=e.message;throw e;}
  finally{run.updatedAt=now();await store.saveRun(run);emit();}
  return run;
}
export async function recoverHostedJob(job,requestId,{store=new HostedStore()}={}){
  if(!['submitting','submission-unknown'].includes(job.status)||!UUID.test(requestId))throw Error('Provide the NVIDIA request ID for an unknown submission.');
  const recovered={...job,providerRequestId:requestId,status:'queued',recoveredAt:now()};await store.saveJob(recovered);return recovered;
}
