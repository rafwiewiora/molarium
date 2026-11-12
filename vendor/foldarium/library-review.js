import {LibraryStore} from './library-store.js';
import {stringifyLibrary,ligandConfidence} from './library-format.js';
import {alignComplexPdb} from './library-alignment.js';
import {ligandMol} from './library-chemistry.js';
const $ = id => document.getElementById(id), store = new LibraryStore();
let bundle, reference, compoundIndex=0, page=0, selected, viewers=[], rendering=Promise.resolve(), generation=0;
const options={extensions:[],layoutIsExpanded:false,layoutShowControls:false,layoutShowSequence:false,layoutShowLog:false,
  layoutShowLeftPanel:false,viewportShowExpand:false,viewportShowControls:false,viewportShowSettings:false,
  viewportShowSelectionMode:false,viewportShowAnimation:false};
function download(content,name) {
  const url=URL.createObjectURL(new Blob([content],{type:'application/json'})), a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const decision = p => bundle.decisions.find(d=>d.poseId===p.id);
const isNone = id => bundle.decisions.find(d=>!d.poseId&&d.compoundId===id)?.value==='none';
function paintDecisions() {
  const c=bundle.run.compounds[compoundIndex];
  $('compound-title').textContent=c.id+(isNone(c.id)?' · none of these poses':'');
  for(const card of document.querySelectorAll('.pose')) {
    const value=bundle.decisions.find(d=>d.poseId===card.dataset.poseId)?.value??'unreviewed';
    card.classList.toggle('preferred',value==='preferred');card.classList.toggle('rejected',value==='rejected');
    card.classList.toggle('selected',card.dataset.poseId===selected);
    for(const b of card.querySelectorAll('[data-decision]'))b.classList.toggle('active',b.dataset.decision===value);
  }
}
function message(text) {$('message').textContent=text;}
async function refreshLibraries(preferred) {
  const runs=(await store.listRuns()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  $('libraries').replaceChildren(...runs.map(r=>new Option(`${r.name||r.id} · ${r.status}`,r.id)));
  if(preferred) $('libraries').value=preferred;
  if($('libraries').value) await load($('libraries').value);
}
async function load(id) {
  bundle=await store.overview(id);compoundIndex=0;page=0;selected=null;
  const first=bundle.poses.find(p=>p.status==='complete');reference=first?(await store.pose(id,first.id)).result.pdb:null;
  $('tools').hidden=false;$('export').disabled=$('shortlist').disabled=false;
  message(`${bundle.run.name||'Library'} · ${bundle.run.status}. Selections are saved as you review.`);
  list(); await render();
}
function list() {
  if(!bundle)return;
  const completed=bundle.poses.filter(p=>p.status==='complete').length, preferred=bundle.decisions.filter(d=>d.value==='preferred').length;
  $('summary').textContent=`${bundle.run.compounds.length} compounds · ${completed} completed poses · ${bundle.poses.length-completed} failed/interrupted attempts · ${preferred} preferred poses`;
  const filter=$('filter').value.toLowerCase();
  $('compounds').replaceChildren(...bundle.run.compounds.flatMap((c,i)=>{
    if(!`${c.id} ${c.smiles}`.toLowerCase().includes(filter))return [];
    const b=document.createElement('button');b.className=`compound ${i===compoundIndex?'active':''}`;b.textContent=c.id;
    const label=document.createElement('small'), poses=bundle.poses.filter(p=>p.compoundId===c.id&&p.status==='complete');
    label.textContent=`${poses.length} poses · ${isNone(c.id)?'none selected':poses.filter(p=>decision(p)?.value==='preferred').length+' preferred'}`;
    b.append(label);b.onclick=()=>{compoundIndex=i;page=0;selected=null;list();render();};return [b];
  }));
}
async function decide(p,value,note='') {
  const c=p?bundle.run.compounds.find(c=>c.id===p.compoundId):bundle.run.compounds[compoundIndex];
  const d={id:p?`pose:${p.id}`:`compound:${c.id}`,compoundId:c.id,poseId:p?.id??null,value,note};
  await store.decide(bundle.run.id,d);bundle.decisions=await store.records('decisions',bundle.run.id);list();paintDecisions();
}
async function clearNone() {
  const c=bundle.run.compounds[compoundIndex],db=await store.database();
  await new Promise((resolve,reject)=>{const tx=db.transaction('decisions','readwrite');
    for(const d of bundle.decisions.filter(d=>!d.poseId&&d.compoundId===c.id))tx.objectStore('decisions').delete([bundle.run.id,d.id]);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  bundle.decisions=bundle.decisions.filter(d=>d.poseId||d.compoundId!==c.id);
}
async function structure(plugin,text,format) {
  const data=await plugin.builders.data.rawData({data:text,label:'Local cofold prediction'});
  const trajectory=await plugin.builders.structure.parseTrajectory(data,format);
  return plugin.builders.structure.createStructure(await plugin.builders.structure.createModel(trajectory));
}
async function rep(plugin,struct,selector,type,color,alpha=1) {
  const comp=await plugin.builders.structure.tryCreateComponentStatic(struct,selector);
  if(comp)await plugin.builders.structure.representation.addRepresentation(comp,{type,typeParams:{alpha,sizeFactor:.22},
    color:'element-symbol',colorParams:{carbonColor:{name:'uniform',params:{value:color}}}});
  return comp;
}
async function view(container,pdb,result) {
  const viewer=await molstar.Viewer.create(container,options), plugin=viewer.plugin;
  viewers.push(plugin);
  const protein=pdb.split(/\r?\n/).filter(l=>l.startsWith('ATOM  ')).join('\n')+'\nEND\n';
  const s=await structure(plugin,protein,'pdb');await rep(plugin,s,'polymer','cartoon',0x7b9691,.3);
  const ligand=await structure(plugin,ligandMol(result,pdb),'mol');
  const comp=await rep(plugin,ligand,'all','ball-and-stick',0x1b9b85);
  // Pocket sticks from the same predicted receptor make contacts inspectable.
  const ligandCoords=pdb.split(/\r?\n/).filter(l=>l.startsWith('HETATM')&&l[21]==='B').map(l=>[30,38,46].map(i=>Number(l.slice(i,i+8))));
  const residues=new Set(protein.split('\n').filter(l=>l.startsWith('ATOM  ')&&ligandCoords.some(p=>
    [30,38,46].reduce((s,k,i)=>s+(Number(l.slice(k,k+8))-p[i])**2,0)<64)).map(l=>l.slice(21,27)));
  const pocket=protein.split('\n').filter(l=>l.startsWith('ATOM  ')&&residues.has(l.slice(21,27))).join('\n');
  if(pocket)await rep(plugin,await structure(plugin,pocket+'\nEND\n','pdb'),'all','ball-and-stick',0x9aa9a6,.65);
  if(comp?.obj?.data)plugin.managers.camera.focusSphere(comp.obj.data.boundary.sphere,{durationMs:0,minRadius:12,extraRadius:5});
  return plugin;
}
function render() {
  const token=++generation;
  rendering=rendering.catch(()=>{}).then(async()=>{
    if(token!==generation)return;
    for(const p of viewers)p.dispose();viewers=[];$('poses').replaceChildren();
    const c=bundle.run.compounds[compoundIndex], poses=(await store.compoundPoses(bundle.run.id,c.id)).filter(p=>p.status==='complete').sort((a,b)=>a.sample-b.sample);
    $('compound-title').textContent=c.id+(isNone(c.id)?' · none of these poses':'');$('smiles').textContent=c.smiles;
    const size=$('mode').value==='single'?1:4;page=Math.max(0,Math.min(page,Math.ceil(poses.length/size)-1));
    $('poses').className=size===1?'single':'';$('pages').replaceChildren();
    for(let i=0;i<Math.ceil(poses.length/size);i++){const b=document.createElement('button');b.textContent=`${i*size+1}–${Math.min((i+1)*size,poses.length)}`;b.className=i===page?'active':'';b.onclick=()=>{page=i;render();};$('pages').append(b);}
    if(!reference&&poses.length)reference=poses[0].result.pdb;
    const visible=poses.slice(page*size,(page+1)*size);
    if(!visible.some(p=>p.id===selected))selected=visible[0]?.id;
    for(const p of visible) {
      if(token!==generation)return;
      selected??=p.id;const card=document.createElement('article');card.dataset.poseId=p.id;card.className=`pose ${decision(p)?.value??''} ${selected===p.id?'selected':''}`;
      const head=document.createElement('div');head.className='pose-head';const title=document.createElement('strong');title.textContent=`${p.result.model??'Prediction'} · pose ${p.sample+1}`;
      const meta=document.createElement('p'), confidence=ligandConfidence(p.result);
      const aligned=alignComplexPdb(p.result.pdb,reference);
      meta.textContent=`Seed ${p.seed} · ${p.result.provider??'unspecified backend'} · ligand pLDDT ${confidence?.toFixed(1)??'—'} · ipTM ${p.result.iptm?.toFixed(3)??'—'} · ${Number.isFinite(p.result.elapsedMs)?(p.result.elapsedMs/1000).toFixed(1)+' s inference':'inference timing unavailable'} · protein Cα RMSD ${aligned.rmsd.toFixed(2)} Å`;
      head.append(title,meta);card.append(head);
      const canvas=document.createElement('div');canvas.className='viewer';card.append(canvas);
      const choices=document.createElement('div');choices.className='choices';
      for(const [value,label] of [['preferred','Prefer'],['rejected','Reject'],['unreviewed','Unreviewed']]){
        const b=document.createElement('button');b.textContent=label;b.dataset.decision=value;b.className=decision(p)?.value===value?'active':'';
        b.onclick=async()=>{selected=p.id;await decide(p,value,decision(p)?.note??'');};choices.append(b);
      }
      const pdb=document.createElement('button');pdb.textContent='PDB';pdb.onclick=()=>{
        const u=URL.createObjectURL(new Blob([p.result.pdb],{type:'chemical/x-pdb'})),a=document.createElement('a');a.href=u;a.download=`${c.id}-pose-${p.sample+1}.pdb`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
      };choices.append(pdb);
      const note=document.createElement('input');note.className='note';note.placeholder='Review note (saved locally)';note.value=decision(p)?.note??'';
      note.onchange=()=>decide(p,decision(p)?.value??'unreviewed',note.value).catch(e=>message(e.message));choices.append(note);
      card.append(choices);card.onpointerdown=()=>{selected=p.id;document.querySelectorAll('.pose').forEach(x=>x.classList.toggle('selected',x===card));};$('poses').append(card);
      try{await view(canvas,aligned.pdb,p.result);}catch(e){canvas.textContent=e.message;canvas.classList.add('error');}
    }
    if(!poses.length){const p=document.createElement('p');p.className='error';p.textContent=bundle.poses.filter(p=>p.compoundId===c.id).map(p=>`Pose ${p.sample+1}: ${p.status} — ${p.error??''}`).join('\n')||'No completed predictions yet.';$('poses').append(p);}
  });return rendering;
}
$('libraries').onchange=()=>load($('libraries').value).catch(e=>message(e.message));
$('import').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>500*1024*1024)throw new Error('Import limit is 500 MB; split larger libraries.');const run=await store.import(JSON.parse(await file.text()));await refreshLibraries(run.id);}catch(e){message(e.message);}finally{e.target.value='';}};
$('filter').oninput=list;$('mode').onchange=()=>{page=0;render();};
function move(delta){if(!bundle)return;compoundIndex=(compoundIndex+delta+bundle.run.compounds.length)%bundle.run.compounds.length;page=0;selected=null;list();render();}
$('previous').onclick=()=>move(-1);$('next').onclick=()=>move(1);
$('none').onclick=async()=>{await decide(null,'none');};
$('clear-none').onclick=async()=>{await clearNone();list();paintDecisions();};
$('match').onclick=()=>{const snapshot=viewers[0]?.canvas3d?.camera.getSnapshot();if(snapshot)for(const p of viewers.slice(1))p.canvas3d.requestCameraReset({snapshot,durationMs:0});};
$('export').onclick=async()=>download(stringifyLibrary(await store.bundle(bundle.run.id)),`foldarium-${bundle.run.id}.json`);
$('shortlist').onclick=async()=>{const current=await store.overview(bundle.run.id),poses=await Promise.all(current.decisions.filter(d=>d.value==='preferred').map(d=>store.pose(current.run.id,d.poseId)));
  download(JSON.stringify({schema:'foldarium.cofolding-shortlist.v1',sourceRun:current.run,poses,decisions:current.decisions},(_k,v)=>ArrayBuffer.isView(v)?Array.from(v):v),`foldarium-shortlist-${current.run.id}.json`);};
document.addEventListener('keydown',async e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if(e.key==='ArrowRight')move(1);if(e.key==='ArrowLeft')move(-1);
  const value={p:'preferred',r:'rejected',u:'unreviewed'}[e.key.toLowerCase()],p=bundle?.poses.find(p=>p.id===selected);if(value&&p){await decide(p,value,decision(p)?.note??'');}});
refreshLibraries(new URLSearchParams(location.search).get('run')).catch(e=>message(e.message));
// A running queue can announce new checkpoints without sending molecular data.
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('foldarium-library-updates'):null;
channel?.addEventListener('message',async e=>{if(e.data?.runId===bundle?.run.id){bundle=await store.overview(bundle.run.id);list();message(`${bundle.run.status} · ${bundle.poses.filter(p=>p.status==='complete').length} poses saved. Change compound or view to load newly completed poses.`);}});
