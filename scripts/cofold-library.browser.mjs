// Actual WebGPU throughput and human-review smoke test. No pose-accuracy claim.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {startMolariumBrowser,waitFor} from './headless-chrome.mjs';
const root=resolve(import.meta.dirname,'..','dist'), output=process.env.MOLARIUM_LIBRARY_REPORT;
const headerText=await readFile(join(root,'_headers'),'utf8');
const headers=Object.fromEntries(headerText.split('\n').filter(l=>/^  [\w-]+:/.test(l)).map(l=>{
  const i=l.indexOf(':');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
  const path=new URL(req.url).pathname;
  if(path.split('/').includes('..'))return new Response('Forbidden',{status:403});
  return new Response(Bun.file(join(root,path==='/'?'index.html':path)),{headers});
}});
const b=await startMolariumBrowser({url:process.env.MOLARIUM_LIBRARY_URL??`http://127.0.0.1:${server.port}/?blank=1`,width:1500,height:1100});
const download=await mkdtemp(join(tmpdir(),'cofold-library-download-'));
const report={schema:'molarium.library-throughput.v1',date:new Date().toISOString(),cases:[],
  purpose:'Engineering throughput and library/review integration; arbitrary protein–ligand pairs, not a pose-accuracy benchmark.'};
try{
  await waitFor(()=>b.evaluate('Boolean(window.MolariumChemistActionsReady)'),60000,'API');
  await b.evaluate('window.MolariumChemistActionsReady.then(()=>true)');
  await b.client.call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:download});
  const reuse=process.env.MOLARIUM_LIBRARY_REUSE;
  if(reuse){const original=JSON.parse(await readFile(reuse,'utf8'));
    const id=await b.evaluate(`(async()=>{const {LibraryStore}=await import('./vendor/foldarium/library-store.js');return (await new LibraryStore().import(${JSON.stringify(original)})).id;})()`);
    await b.client.call('Page.reload',{});await waitFor(()=>b.evaluate('Boolean(window.MolariumChemistActionsReady)'),60000,'reloaded API');
    await b.evaluate('window.MolariumChemistActionsReady.then(()=>true)');
    await waitFor(()=>b.evaluate(`Boolean(document.querySelector('#fold-library-saved option[value="${id}"]'))`),10000,'imported library');
    await b.evaluate(`document.querySelector('#fold-library-saved').value=${JSON.stringify(id)}`);
    report.reused={path:reuse.split('/').at(-1),sha256:createHash('sha256').update(await readFile(reuse)).digest('hex'),run:original.run,
      timing:original.poses.map(p=>({id:p.id,wallMs:p.wallMs,inferenceMs:p.result.elapsedMs}))};}
  const cases=[...(!reuse?[{name:'Trp-cage 20 aa / 3 ligands / 2 seeds',sequence:'NLYIQWLKDGGPSSGRPPPS',samples:2,
    compounds:'CCO ethanol\nc1ccccc1 benzene\nc1ccccc1C(=O)[O-] benzoate'}]:[]),
    ...(process.argv.includes('--extended')?[{name:'Ubiquitin 76 aa / 2 ligands / 2 seeds',
      sequence:'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG',samples:2,
      compounds:'CCO ethanol\nc1ccccc1C(=O)[O-] benzoate'}]:[]),
    ...(process.argv.includes('--library-scale')?[{name:'Ubiquitin 76 aa / 16 compounds / 3 seeds',
      sequence:'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG',samples:3,
      compounds:['CCO ethanol','c1ccccc1 benzene','c1ccccc1C(=O)[O-] benzoate',
        'CC(=O)Oc1ccccc1C(=O)O aspirin','Cn1c(=O)c2c(ncn2C)n(C)c1=O caffeine',
        'CC(C)Cc1ccc(cc1)[C@@H](C)C(=O)O ibuprofen','CC(=O)Nc1ccc(O)cc1 acetaminophen',
        'NC(=O)c1ccccc1 benzamide','Nc1ccccc1 aniline','c1ccncc1 pyridine','Oc1ccccc1 phenol',
        'CCOc1ccccc1 phenetole','O=C(O)c1ccccc1O salicylic-acid','CCOC(=O)c1ccccc1 ethyl-benzoate',
        'Clc1ccc(Cl)cc1 dichlorobenzene','FC(F)(F)c1ccccc1 trifluoromethylbenzene'].join('\n')}]:[])];
  for(const c of cases){
    const previous=await b.evaluate(`document.querySelector('#fold-library-saved').value`);
    const input={...c,model:process.argv.includes('--boltz2')?'localfold-boltz2':'localfold-openbind0',
      msaMode:'single',steps:process.argv.includes('--quick')?1:25,recycles:process.argv.includes('--quick')?0:2,seed:0};
    await b.evaluate(`(()=>{
      const input=${JSON.stringify(input)};
      document.querySelector('#protein-sequence').value=input.sequence;
      document.querySelector('#fold-msa-mode').value='single';
      document.querySelector('#fold-library-name').value=input.name;
      document.querySelector('#fold-library-model').value=input.model;
      document.querySelector('#fold-library-smiles').value=input.compounds;
      document.querySelector('#fold-library-samples').value=String(input.samples);
      document.querySelector('#fold-steps').value=String(input.steps);
      document.querySelector('#fold-recycles').value=String(input.recycles);
      document.querySelector('#fold-library-panel').open=true;
      document.querySelector('#fold-library-start').click();
    })()`);
    await waitFor(()=>b.evaluate(`document.querySelector('#fold-library-saved').value!==${JSON.stringify(previous)}
      &&document.querySelector('#fold-library-status').textContent.startsWith('running')`),60000,'new library started');
    await waitFor(()=>b.evaluate(`document.querySelector('#fold-library-status').textContent.startsWith('complete')
      ||document.querySelector('#fold-library-status').textContent.startsWith('Library stopped')`),900000,c.name);
    const status=await b.evaluate(`document.querySelector('#fold-library-status').textContent`);console.log(status);
    assert.match(status,/^complete ·/);
    const bundle=await b.evaluate(`(async()=>{const {LibraryStore}=await import('./vendor/foldarium/library-store.js');
      const {stringifyLibrary}=await import('./vendor/foldarium/library-format.js');
      return JSON.parse(stringifyLibrary(await new LibraryStore().bundle(document.querySelector('#fold-library-saved').value)));})()`);
    assert.equal(bundle.poses.length,c.samples*c.compounds.split('\n').length);
    assert.ok(bundle.poses.every(p=>p.status==='complete'&&p.result.provenance.outputPdbSha256));
    const ordered=[...bundle.poses].sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
    const inference=ordered.map(p=>p.result.elapsedMs),wall=ordered.map(p=>p.wallMs);
    report.cases.push({name:c.name,request:bundle.run.request,environment:bundle.run.environment,
      poses:ordered.map(p=>({id:p.id,seed:p.seed,smiles:bundle.run.compounds.find(c=>c.id===p.compoundId).smiles,
        wallMs:p.wallMs,inferenceMs:p.result.elapsedMs,totalMs:p.result.totalElapsedMs,runtime:p.result.runtime,pdbSha256:p.result.provenance.outputPdbSha256,
        provenance:p.result.provenance})),inferenceMs:inference,wallMs:wall,sessions:bundle.run.sessions,
      warmMeanMs:wall.slice(1).reduce((a,b)=>a+b,0)/(wall.length-1),firstPoseMs:wall[0],status});
    if(output){await mkdir(output,{recursive:true});await writeFile(join(output,`library-${report.cases.length}.json`),JSON.stringify(bundle));
      await writeFile(join(output,'throughput.json'),JSON.stringify(report,null,2)+'\n');}
  }
  const runId=await b.evaluate(`document.querySelector('#fold-library-saved').value`);
  await b.client.call('Page.navigate',{url:new URL(`vendor/foldarium/library-review.html?run=${encodeURIComponent(runId)}`,process.env.MOLARIUM_LIBRARY_URL??`http://127.0.0.1:${server.port}/`).href});
  await waitFor(()=>b.evaluate(`document.querySelectorAll('.viewer canvas').length>=2||Boolean(document.querySelector('.viewer.error'))`),60000,'Foldarium grid');
  const errors=await b.evaluate(`Array.from(document.querySelectorAll('.viewer.error'),e=>e.textContent)`);
  assert.deepEqual(errors,[]);
  if(reuse){
    const original=JSON.parse(await readFile(reuse,'utf8'));
    if(original.run.request.model==='comparison-review-only'){
      const heads=await b.evaluate(`Array.from(document.querySelectorAll('.pose-head'),e=>e.textContent)`);
      const expected=[...new Set(original.poses.map(p=>p.result.model))];
      for(const label of expected)assert.ok(heads.some(h=>h.includes(label)),`visible method label: ${label}`);
      if(original.poses.some(p=>p.result.kind==='native'))assert.ok(heads.some(h=>h.includes('inference timing unavailable')));
    }
  }
  await b.evaluate(`window.__reviewCanvas=document.querySelector('.viewer canvas');document.querySelector('.choices button').click()`);
  await waitFor(()=>b.evaluate(`document.querySelector('#summary').textContent.includes('1 preferred poses')`),20000,'saved human preference');
  assert.equal(await b.evaluate(`window.__reviewCanvas===document.querySelector('.viewer canvas')`),true,'voting preserves the inspected viewer and camera');
  await b.evaluate(`document.querySelector('#shortlist').click()`);
  const shortlist=await waitFor(async()=>JSON.parse(await readFile(join(download,`foldarium-shortlist-${runId}.json`),'utf8')),10000,'shortlist export');
  assert.equal(shortlist.poses.length,1);assert.ok(shortlist.poses[0].result.pdb);
  await b.evaluate(`document.querySelector('#none').click()`);
  await waitFor(()=>b.evaluate(`document.querySelector('#compound-title').textContent.includes('none of these')`),20000,'none selection');
  const state=await b.evaluate(`(async()=>{const {LibraryStore}=await import('./library-store.js');return new LibraryStore().bundle(${JSON.stringify(runId)});})()`);
  assert.equal(state.decisions.filter(d=>d.value==='preferred').length,0);assert.ok(state.decisions.some(d=>d.value==='none'));
  const imported=await b.evaluate(`(async()=>{const {LibraryStore}=await import('./library-store.js');const store=new LibraryStore();
    const original=await store.bundle(${JSON.stringify(runId)}),run=await store.import(original),copy=await store.bundle(run.id);
    return {id:run.id,count:copy.poses.length,decisions:copy.decisions.length};})()`);
  assert.notEqual(imported.id,runId);assert.ok(imported.count>0);assert.ok(imported.decisions>0);
  report.review={grid:true,preferredPersisted:true,noneClearsPreferred:true,shortlistExport:true,importRoundTrip:true};
  if(output){await writeFile(join(output,'throughput.json'),JSON.stringify(report,null,2)+'\n');
    await writeFile(join(output,'foldarium-review.png'),await b.capturePng());}
  console.log(JSON.stringify(report));
}catch(e){console.error(await b.evaluate(`({status:document.querySelector('#fold-library-status')?.textContent,
  notice:document.querySelector('#notice')?.textContent,message:document.querySelector('#message')?.textContent})`).catch(()=>null));throw e;}
finally{await b.close();server.stop(true);}
