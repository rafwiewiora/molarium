import {createLibrary,executeLibrary,LibraryStore,queueProgress} from './library.mjs';
import {stringifyLibrary} from '../vendor/foldarium/library-format.js';
const $=id=>document.getElementById(id);
const duration=ms=>ms==null?'estimating…':ms<60000?`${(ms/1000).toFixed(1)} s`:`${Math.floor(ms/60000)}m ${Math.floor(ms%60000/1000)}s`;
export class LibraryController {
  constructor({guard,onBusy=()=>{}}={}) {this.store=new LibraryStore();this.guard=guard;this.onBusy=onBusy;this.current=null;this.controller=null;}
  async refresh(preferred) {
    const runs=(await this.store.listRuns()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    const selected=preferred??$('fold-library-saved').value;
    this.runs=new Map(runs.map(r=>[r.id,r]));
    $('fold-library-saved').replaceChildren(new Option('Choose saved library',''),...runs.map(r=>new Option(`${r.name} · ${r.completed}/${r.total} · ${r.status}`,r.id)));
    if(selected)$('fold-library-saved').value=selected;
    this.links();
  }
  links() {
    const id=$('fold-library-saved').value;
    $('fold-library-review').href=id?`vendor/foldarium/library-review.html?run=${encodeURIComponent(id)}`:'vendor/foldarium/library-review.html';
    $('fold-library-export').disabled=!id;
    $('fold-library-resume').disabled=!id||!!this.controller||!!this.creating||!['ready','paused','stopped','running'].includes(this.runs?.get(id)?.status);
    $('fold-library-delete').disabled=!id||!!this.controller||!!this.creating;
  }
  render(progress) {
    this.current=progress;
    const p=progress.current;
    $('fold-library-progress').value=Math.max(0,Math.min(1,progress.fraction));
    $('fold-library-status').textContent=`${progress.status} · ${progress.completed}/${progress.total} poses saved · ${progress.failed} failed\n`+
      (p?`${p.compoundId} · pose ${p.sample+1} · ${p.message??p.stage}\n`:'')+
      `This session ${duration(progress.elapsedMs)} · first pose ${duration(progress.firstPoseMs)}\nWarm mean ${duration(progress.warmMeanMs)}/pose · remaining ${duration(progress.etaMs)}`;
  }
  async start(input) {this.guard(input);this.current=null;this.creating=true;this.pauseRequested=false;$('fold-library-status').textContent='Creating library…';
    try{const run=await createLibrary(input,{store:this.store});await this.refresh(run.id);return await this.run(run);}finally{this.creating=false;this.links();}}
  async resume(id) {
    const run=await this.store.getRun(id);if(!run)throw new Error('Saved library not found.');
    this.guard(run.request);this.pauseRequested=false;return this.run(run);
  }
  async run(run) {
    if(this.controller)throw new Error('A library is already running.');
    const controller=new AbortController();this.controller=controller;this.onBusy(true);
    if(this.pauseRequested)controller.abort();
    $('fold-library-start').disabled=true;$('fold-library-pause').disabled=false;this.links();
    const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('foldarium-library-updates'):null;
    let lastCheckpoint=-1;
    const execute=async lock=>{
      if(!lock)throw new Error('Another tab is running a library. Pause it before starting this queue.');
      const {getDevice}=await import('../vendor/localfold/web/model.js');
      if(!controller.signal.aborted)await getDevice(); // Fail once on unavailable hardware.
      return executeLibrary(run,{store:this.store,signal:controller.signal,onProgress:p=>{
        this.render(p);
        if(p.completed+p.failed!==lastCheckpoint){lastCheckpoint=p.completed+p.failed;channel?.postMessage({runId:run.id});}
      }});
    };
    try {
      this.render({...queueProgress(run,await this.store.records('poseIndex',run.id)),status:'starting'});
      if(!navigator.locks)throw new Error('Library execution needs a browser with Web Locks (current Chrome or Edge).');
      const result=await navigator.locks.request('molarium-cofolding-library-gpu',{ifAvailable:true},execute);
      channel?.postMessage({runId:run.id});return {runId:run.id,status:result.status,completed:result.completed,failed:result.failed,total:result.total};
    }catch(e){$('fold-library-status').textContent=`Library stopped · ${e.message}`;throw e;}
    finally {this.controller=null;channel?.close();this.onBusy(false);$('fold-library-start').disabled=false;$('fold-library-pause').disabled=true;await this.refresh(run.id);}
  }
  pause() {const active=!!this.controller||!!this.creating;if(this.creating)this.pauseRequested=true;this.controller?.abort();return {requested:active};}
  async status(id) {
    if(this.current&&(!id||id===this.current.runId))return this.current;
    if(!id)return {status:this.creating||this.controller?'starting':'idle',runId:null,completed:0,failed:0,total:null};
    const run=await this.store.getRun(id);if(!run)throw new Error('Saved library not found.');
    return queueProgress(run,await this.store.records('poseIndex',id));
  }
  install({request,action,download,reportError}) {
    const safe=fn=>async()=>{try{await fn();}catch(e){reportError(e.message);}};
    $('fold-library-start').onclick=safe(async()=>{$('fold-library-start').disabled=true;try{await action('protein.cofoldLibrary',{...request(),model:'localfold-openbind0',ligand:null,
      name:$('fold-library-name').value,compounds:$('fold-library-smiles').value,samples:Number($('fold-library-samples').value),retainPae:$('fold-library-pae').checked});}
      finally{if(!this.controller)$('fold-library-start').disabled=false;}});
    $('fold-library-pause').onclick=safe(()=>action('protein.pauseLibrary',{}));
    $('fold-library-resume').onclick=safe(()=>action('protein.resumeLibrary',{runId:$('fold-library-saved').value}));
    $('fold-library-saved').onchange=()=>{this.links();const id=$('fold-library-saved').value;if(id)this.status(id).then(p=>this.render(p)).catch(e=>reportError(e.message));};
    $('fold-library-export').onclick=safe(async()=>download(stringifyLibrary(await this.store.bundle($('fold-library-saved').value)),'molarium-cofolding-library.json','application/json'));
    $('fold-library-delete').onclick=safe(async()=>{const id=$('fold-library-saved').value;if(confirm('Delete this library and its local review decisions? Export it first if you need a copy.')){
      if(!navigator.locks)throw new Error('Close computing tabs before deleting browser data.');
      await navigator.locks.request('molarium-cofolding-library-gpu',{ifAvailable:true},async lock=>{
        if(!lock)throw new Error('Pause the active library before deleting local results.');await this.store.remove(id);});await this.refresh();}});
    this.refresh().catch(e=>{$('fold-library-status').textContent=`Local library storage unavailable · ${e.message}`;});
  }
}
