import {HostedStore,HOSTED_MODELS,createHostedRun,executeHostedRun,recoverHostedJob,progress,digest,hostedRequest} from './hosted-library.mjs';
import {ColabFoldMsaProvider} from '../openfold/msa-client.js';
const $=id=>document.getElementById(id),store=new HostedStore();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let run=null,jobs=[],controller=null,creating=false,selected=null,viewer=null,renderToken=0;
const error=e=>{$('error').hidden=false;$('error').textContent=String(e?.message??e);};
const safe=fn=>async(...args)=>{try{await fn(...args);}catch(e){error(e);}};
const download=(data,name,type='application/json')=>{const url=URL.createObjectURL(new Blob([data],{type}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function setBusy(busy){$('start').disabled=busy||Boolean(globalThis.MOLARIUM_RUNTIME_CONFIG?.localOnly);$('pause').disabled=!busy;
  $('resume').disabled=busy||!run||Boolean(globalThis.MOLARIUM_RUNTIME_CONFIG?.localOnly);$('saved').disabled=busy;}
function modelControls(){const defaults=$('model').value==='openfold3';$('steps-label').hidden=defaults;$('recycles-label').hidden=defaults;
  $('samples').max=defaults?'5':'20';
  $('model-help').textContent=defaults?'OpenFold3’s hosted API chooses diffusion steps and recycling internally. Each compound is a separate protein–ligand prediction; the server manages random seeds.':
    'Every compound is a separate protein–ligand prediction with the selected steps and recycling count. The server manages random seeds.';}
async function refresh(id){const runs=(await store.runs()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  $('saved').replaceChildren(new Option('Choose a library',''),...runs.map(r=>new Option(`${r.name} · ${r.status}`,r.id)));
  if(id)$('saved').value=id;}
function render(p=run?progress(run,jobs):null){
  if(!p)return;
  $('status').textContent=`${p.complete}/${p.total} jobs complete · ${p.structures}/${p.expectedStructures} structures received`;
  $('detail').textContent=`${p.accepted}/${p.total} jobs accepted · ${p.failed} failed · ${p.unknown} with unknown submission outcome · ${p.status}. `+
    'Progress counts completed jobs; the provider does not report individual diffusion steps.';
  $('progress').value=p.fraction;$('export').disabled=false;
  const container=$('jobs');container.replaceChildren();
  for(const job of jobs){
    const card=document.createElement('article');card.className='job';card.dataset.compoundId=job.compound.id;
    const body=document.createElement('div'),title=document.createElement('div'),meta=document.createElement('div');title.className='job-title';title.textContent=job.compound.id;
    meta.className='job-meta';meta.textContent=`${job.status} · ${job.structures.length}/${job.samples} structures`+(job.providerRequestId?` · request ${job.providerRequestId}`:'')+
      (job.nonePreferred?' · none of these poses':'')+(job.error?` · ${job.error}`:'');body.append(title,meta);card.append(body);
    const buttons=document.createElement('div');buttons.className='actions';
    for(const s of job.structures){const button=document.createElement('button');button.textContent=`Pose ${s.index+1}`;
      button.dataset.sample=String(s.index);button.className=(selected?.jobId===job.id&&selected?.index===s.index?'selected ':'')+(job.decisions[s.index]?.value??'');
      button.onclick=safe(()=>showPose(job.id,s.index));buttons.append(button);}
    if(job.rawResponse){const b=document.createElement('button');b.textContent='Original result JSON';b.onclick=()=>download(JSON.stringify(job.rawResponse,null,2),job.compound.id+'-provider-result.json');buttons.append(b);}
    if(['submitting','submission-unknown'].includes(job.status)){
      const recovery=document.createElement('div');recovery.className='recovery';const input=document.createElement('input');input.placeholder='NVIDIA request ID';input.value=job.providerRequestId??'';
      input.setAttribute('aria-label','Recover NVIDIA request ID for '+job.compound.id);
      const button=document.createElement('button');button.textContent='Recover ID';button.disabled=Boolean(controller);
      button.onclick=safe(async()=>{const recovered=await recoverHostedJob(job,input.value.trim(),{store});jobs=jobs.map(j=>j.id===job.id?recovered:j);render();});
      recovery.append(input,button);body.append(recovery);
    }
    card.append(buttons);container.append(card);
  }
}
async function load(id){if(!id)return;run=await store.getRun(id);if(!run)throw Error('Server library not found.');jobs=await store.jobs(id);selected=null;$('review').hidden=true;
  $('error').hidden=!run.lastError;if(run.lastError)$('error').textContent=run.lastError;render();setBusy(false);}
function selectedRecord(){if(!selected)return {};const job=jobs.find(j=>j.id===selected.jobId);return {job,structure:job?.structures.find(s=>s.index===selected.index)};}
async function showPose(jobId,index){selected={jobId,index};const {job,structure}=selectedRecord();if(!job||!structure)return;
  $('review').hidden=false;$('pose-title').textContent=`${job.compound.id} · pose ${index+1}`;
  const scores=job.rawResponse?.outputs?.[0]??job.rawResponse;
  const confidence=structure.confidence_score??scores?.confidence_scores?.[index],iptm=structure.iptm_score??scores?.iptm_scores?.[index];
  $('pose-detail').textContent=`${HOSTED_MODELS[run.model]} · original ${structure.format} · confidence ${Number.isFinite(confidence)?confidence.toFixed(3):'not supplied'} · ipTM ${Number.isFinite(iptm)?iptm.toFixed(3):'not supplied'}`;
  $('note').value=job.decisions[index]?.note??'';render();
  const token=++renderToken;viewer?.plugin?.dispose();viewer=null;$('viewer').replaceChildren();$('viewer').dataset.state='loading';
  if(!globalThis.molstar?.Viewer){$('viewer').textContent='3D viewer unavailable. The original structure is available to download.';return;}
  const v=await molstar.Viewer.create($('viewer'),{layoutIsExpanded:false,layoutShowControls:false,layoutShowLeftPanel:false,layoutShowLog:false,
    viewportShowExpand:false,viewportShowSettings:false,volumeStreamingDisabled:true,viewportBackgroundColor:'#ffffff'});
  if(token!==renderToken){v.plugin.dispose();return;}viewer=v;
  await viewer.loadStructureFromData(structure.structure,structure.format==='cif'?'mmcif':structure.format);
  if(!viewer.plugin.managers.structure.hierarchy.current.structures.some(s=>s.cell.obj?.data.elementCount>0))
    throw Error('The provider file contains no viewable atoms. Download the original structure to inspect it.');
  $('viewer').dataset.state='ready';
}
async function decide(value){const {job,structure}=selectedRecord();if(!job||!structure)return;
  if(value==='none'){job.nonePreferred=true;for(const d of Object.values(job.decisions))if(d.value==='preferred')d.value='unreviewed';}
  else{if(value==='preferred')job.nonePreferred=false;job.decisions[structure.index]={value,note:$('note').value,structureSha256:structure.sha256,updatedAt:new Date().toISOString()};}
  await store.saveJob(job);render();}
function input(){return {name:$('name').value,sequence:$('sequence').value,compounds:$('compounds').value,model:$('model').value,
  samples:Number($('samples').value),steps:Number($('steps').value),recycles:Number($('recycles').value),msaMode:$('msa').value,a3m:$('a3m').value};}
async function searchAlignment(sequence,{signal}){
  $('detail').textContent='Searching ColabFold once for this protein. The alignment will be shared across the compound set.';
  const provider=new ColabFoldMsaProvider();
  const result=await provider.search({entities:[{type:'protein',sequence}]},{signal,onProgress:p=>{$('detail').textContent=p.message??p.stage;}});
  const rows=[['query',sequence]],seen=new Set([sequence]);
  for(const text of result.documents){for(const block of text.replaceAll('\0','\n').split(/^>/m)){
    if(!block.trim())continue;const [header,...lines]=block.split(/\r?\n/),value=lines.filter(l=>l&&!l.startsWith('#')).join('').replace(/\s/g,'');
    const aligned=value.replace(/[a-z]/g,'');if(aligned.length!==sequence.length||seen.has(aligned))continue;
    rows.push([header,value]);seen.add(aligned);if(rows.length===256)break;
  }if(rows.length===256)break;}
  return rows.map(([header,value])=>'>'+header+'\n'+value+'\n').join('');
}
async function continueRun(id,fromStart=false){
  if(creating&&!fromStart)throw Error('A server library is being created.');
  if(controller)throw Error('Another server queue is active in this tab.');
  const key=$('api-key').value.trim();if(!/^nvapi-[A-Za-z0-9_-]{20,512}$/.test(key))throw Error('Enter your NVIDIA API key to submit or retrieve jobs.');
  if(!navigator.locks)throw Error('Server job coordination needs a browser with Web Locks.');
  controller=new AbortController();setBusy(true);$('error').hidden=true;
  try{const saved=await store.getRun(id);if(!saved)throw Error('Saved server library not found.');run=saved;jobs=await store.jobs(id);
    await navigator.locks.request('molarium-hosted-library-'+id,{ifAvailable:true},async lock=>{
    if(!lock)throw Error('Another tab is managing this server library.');
    run=await executeHostedRun(run,{store,key,signal:controller.signal,searchAlignment,onProgress:(p,current)=>{jobs=current;render(p);}});
  });}finally{controller=null;setBusy(false);const latest=await store.getRun(id);if(latest)run=latest;await refresh(id);render();}
}
async function start(value=input()){
  if(globalThis.MOLARIUM_RUNTIME_CONFIG?.localOnly)throw Error('Server folding needs connected mode.');
  if(!$('api-key').value.trim())throw Error('Enter your NVIDIA API key.');
  if(controller||creating)throw Error('A server library is already being created or managed.');
  creating=true;setBusy(true);
  try{run=await createHostedRun(value,{store});jobs=await store.jobs(run.id);await refresh(run.id);render();await continueRun(run.id,true);
    return {runId:run.id,status:run.status};
  }finally{creating=false;setBusy(false);}
}
async function exportBundle(id=run?.id){
  if(!id)throw Error('Choose a server library.');
  // Prefer the latest in-memory records: they preserve a just-accepted ID or
  // returned result even if the browser's subsequent storage write failed.
  return run?.id===id?{schema:'molarium.hosted-library.v1',run,jobs}:store.bundle(id);
}
async function importBundle(bundle){
  if(bundle?.schema!=='molarium.hosted-library.v1'||!bundle.run||!Array.isArray(bundle.jobs)||bundle.jobs.length>10000)
    throw Error('Expected a Molarium hosted-library export.');
  const source=bundle.run;
  if(!UUID.test(source.id)||source.schema!=='molarium.hosted-run.v1'||!Number.isFinite(Date.parse(source.createdAt)))throw Error('Invalid saved library identity.');
  const valid=hostedRequest({...source.request,model:source.model,compounds:source.compounds,samples:source.samples});
  if(bundle.jobs.length!==valid.compounds.length||source.totalJobs!==valid.compounds.length||source.totalSamples!==valid.compounds.length*valid.samples)
    throw Error('Saved compound/job counts disagree.');
  const compounds=new Map(valid.compounds.map(c=>[c.id,c])),seen=new Set();
  for(const job of bundle.jobs){
    if(job.runId!==source.id||job.id!==source.id+'::'+job.compound?.id||seen.has(job.id)||!compounds.has(job.compound?.id)
      ||job.compound.smiles!==compounds.get(job.compound.id).smiles||job.samples!==valid.samples||!Array.isArray(job.structures)||job.structures.length>25
      ||!['unsubmitted','submitting','submission-unknown','queued','received','complete','failed'].includes(job.status))
      throw Error('Invalid compound/job identity in saved results.');seen.add(job.id);
    if(job.providerRequestId&&!UUID.test(job.providerRequestId)||job.status==='queued'&&!job.providerRequestId)
      throw Error('Invalid saved NVIDIA request ID.');
    if(job.status==='complete'&&!job.structures.length)throw Error('Completed jobs must retain their structures.');
    if(!job.decisions||typeof job.decisions!=='object'||Array.isArray(job.decisions))throw Error('Invalid saved pose decisions.');
    if(new Set(job.structures.map(s=>s.index)).size!==job.structures.length||job.structures.some(s=>!Number.isInteger(s.index)||s.index<0||s.index>=25))
      throw Error('Invalid saved structure indices.');
    for(const structure of job.structures)if(typeof structure.structure!=='string'||!['mmcif','cif','pdb'].includes(structure.format)
      ||structure.structure.length>8*1024*1024||await digest(structure.structure)!==structure.sha256)throw Error('Saved structure integrity check failed.');
    if(job.rawResponse&&await digest(JSON.stringify(job.rawResponse))!==job.responseCanonicalSha256)throw Error('Saved original response integrity check failed.');
    for(const [index,decision]of Object.entries(job.decisions))if(!['preferred','rejected','unreviewed'].includes(decision.value)
      ||!job.structures.some(s=>s.index===Number(index)&&s.sha256===decision.structureSha256))throw Error('Saved decision does not identify a retained structure.');
  }
  if(await store.getRun(source.id))throw Error('This library already exists here. Open the saved copy; imports never overwrite local decisions.');
  // Imported unsubmitted work is not automatically charged to a new account.
  const imported={...source,retrieveOnly:true,status:'imported'};
  for(const job of bundle.jobs)await store.saveJob(job);await store.saveRun(imported);await refresh(imported.id);await load(imported.id);
}
$('setup').onsubmit=safe(async e=>{e.preventDefault();await start();});
$('resume').onclick=safe(()=>continueRun($('saved').value));
$('pause').onclick=()=>controller?.abort();
$('saved').onchange=safe(()=>load($('saved').value));
$('export').onclick=safe(async()=>download(JSON.stringify(await exportBundle(),null,2),'molarium-server-library.json'));
$('import').onchange=safe(async event=>{const file=event.target.files[0];if(!file)return;if(file.size>200*1024*1024)throw Error('Import limit is 200 MB.');await importBundle(JSON.parse(await file.text()));event.target.value='';});
$('model').onchange=modelControls;$('msa').onchange=()=>{$('a3m-label').hidden=$('msa').value!=='provided';};
for(const button of document.querySelectorAll('[data-choice]'))button.onclick=safe(()=>decide(button.dataset.choice));
$('none').onclick=safe(()=>decide('none'));
$('note').onchange=safe(()=>{const {job,structure}=selectedRecord();if(job&&structure)return decide(job.decisions[structure.index]?.value??'unreviewed');});
$('download-structure').onclick=()=>{const {job,structure}=selectedRecord();if(job&&structure)download(structure.structure,job.compound.id+'-pose-'+(structure.index+1)+'.'+(structure.format==='mmcif'?'cif':structure.format),'chemical/x-mmcif');};
try{const id=location.hash.startsWith('#draft=')?location.hash.slice(7):null;
  const draftKey=id&&/^[0-9a-f-]{36}$/i.test(id)?'molarium-hosted-draft-'+id:null;
  const raw=draftKey?localStorage.getItem(draftKey):null;
  if(raw){localStorage.removeItem(draftKey);history.replaceState(null,'',location.pathname);const draft=JSON.parse(raw);
    if(draft.expires<Date.now())throw Error('Draft expired');
  for(const [id,key]of [['sequence','sequence'],['compounds','compounds'],['samples','samples'],['name','name']])if(draft[key]!==undefined)$(id).value=String(draft[key]);}}
catch{/* A blocked draft store does not prevent manual entry. */}
globalThis.MolariumHosted=Object.freeze({start,resume:id=>continueRun(id),pause:()=>controller?.abort(),
  status:async id=>{const r=id?await store.getRun(id):run;return r?progress(r,await store.jobs(r.id)):{status:'idle'};},export:exportBundle,import:importBundle});
modelControls();setBusy(false);refresh().catch(error);
if(globalThis.MOLARIUM_RUNTIME_CONFIG?.localOnly){$('start').disabled=true;error(Error('Server folding is disabled in Local Lab. Use connected mode to send work to an external service.'));}
