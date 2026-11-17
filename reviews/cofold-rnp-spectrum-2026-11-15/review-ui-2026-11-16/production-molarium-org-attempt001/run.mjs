// Inspect saved poses through the real file-import UI. No prediction API runs.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {startMolariumBrowser,waitFor} from "/Users/bb/repos/marco/tmp/molarium-chemrxiv-v1/scripts/headless-chrome.mjs";

const root=resolve("/Users/bb/repos/marco/tmp/molarium-chemrxiv-v1");
const directory=resolve(process.env.MOLARIUM_STOCK_REVIEW_EXPORTS??join(root,'reviews/cofold-rnp-spectrum-2026-11-15/checkpoint-288/review-examples'));
const manifestRaw=await readFile(join(directory,'manifest.json')),manifest=JSON.parse(manifestRaw);
const caseId=process.env.MOLARIUM_STOCK_REVIEW_CASE_ID??manifest.caseIds[0];
assert(manifest.caseIds.includes(caseId),'Requested case must belong to the export manifest');
const readBundle=async reference=>{
  const entry=manifest.libraries.find(e=>e.caseId===caseId&&e.referenceIncluded===reference);
  const raw=await readFile(join(directory,entry.file));
  assert.equal(createHash('sha256').update(raw).digest('hex'),entry.sha256);
  return {entry,bundle:JSON.parse(raw)};
};
const predictions=await readBundle(false),reference=await readBundle(true);
const b=await startMolariumBrowser({root,appPath:'vendor/foldarium/library-review.html',url:"https://molarium.org/vendor/foldarium/library-review",width:1500,height:1100});
try {
const networkRequests=[];
await b.client.call('Network.enable');
b.client.socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method!=='Network.requestWillBeSent')return;const request=message.params.request,u=new URL(request.url);if(!['http:','https:'].includes(u.protocol))return;
const queryAllowed=[...u.searchParams].every(([key,value])=>(key==='v'&&/^[0-9a-f]{64}$/.test(value))||(key==='run'&&/^[0-9a-f-]{36}$/.test(value)));
networkRequests.push({method:request.method,url:u.origin+u.pathname,queryKeys:[...u.searchParams.keys()],queryAllowed,type:message.params.type});});

  const ready=()=>waitFor(()=>b.evaluate(`Boolean(document.querySelector('#import')?.onchange&&window.molstar?.Viewer)`),30000,'review file importer');
  const observe=()=>b.evaluate(`(()=>{window.stockReviewPlugins=[];window.stockReviewGpuRequests=0;
    if(navigator.gpu)navigator.gpu.requestAdapter=()=>{window.stockReviewGpuRequests++;throw Error('Review must not start WebGPU computation');};
    const original=molstar.Viewer.create.bind(molstar.Viewer);
    molstar.Viewer.create=async(...args)=>{const viewer=await original(...args);window.stockReviewPlugins.push(viewer.plugin);return viewer;};return true;})()`);
  const importFile=async value=>{
    await b.evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(value.bundle))}],${JSON.stringify(value.entry.file)},{type:'application/json'}));
      const input=document.querySelector('#import');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await waitFor(()=>b.evaluate(`(async()=>{const id=document.querySelector('#libraries').value;if(!id)return false;const {LibraryStore}=await import('./library-store.js');const run=await new LibraryStore().getRun(id);return run?.importedFrom===${JSON.stringify(value.bundle.run.id)}&&document.querySelector('#compound-title').textContent===${JSON.stringify(caseId)};})()`),30000,'imported exact saved library');
    return b.evaluate(`document.querySelector('#libraries').value`);
  };
  const rendered=async(ids)=>{
    await waitFor(()=>b.evaluate(`Boolean(document.querySelector('.viewer.error'))||(JSON.stringify(Array.from(document.querySelectorAll('.pose'),p=>p.dataset.poseId))===${JSON.stringify(JSON.stringify(ids))}&&window.stockReviewPlugins.length===${ids.length}&&window.stockReviewPlugins.every(p=>p.managers.structure.hierarchy.current.structures.length>=2&&p.managers.structure.hierarchy.current.structures.every(s=>s.cell.obj?.data?.elementCount>0)))`),90000,'exact saved protein/ligand viewers');
    assert.deepEqual(await b.evaluate(`Array.from(document.querySelectorAll('.viewer.error'),e=>e.textContent)`),[]);
    assert.equal(await b.evaluate('window.stockReviewGpuRequests'),0);
  };
  const poseIds=value=>value.bundle.poses.filter(p=>p.status==='complete').sort((a,b)=>a.sample-b.sample).map(p=>p.id);
  const predictionIds=poseIds(predictions),referenceIds=poseIds(reference);
  assert(predictionIds.length>=4&&referenceIds.length===predictionIds.length+1);
  const remainingPages=async(ids)=>{
    assert.equal(await b.evaluate(`document.querySelectorAll('#pages button').length`),Math.ceil(ids.length/4));
    const pages=[ids.slice(0,4)];
    for(let page=1;page<Math.ceil(ids.length/4);page++){
      const visible=ids.slice(page*4,(page+1)*4);
      await b.evaluate(`(()=>{window.stockReviewPlugins=[];document.querySelectorAll('#pages button')[${page}].click();})()`);
      await rendered(visible);pages.push(visible);
      const displayed=await b.evaluate(`Array.from(document.querySelectorAll('.pose'),p=>({id:p.dataset.poseId,title:p.querySelector('.pose-head strong').textContent}))`);
      for(const pose of displayed){const original=predictions.bundle.poses.find(p=>p.id===pose.id);assert.equal(pose.title,`${original.result.model??'Prediction'} · pose ${original.sample+1}`);}
    }
    assert.deepEqual(pages.flat(),ids);return pages;
  };
  await ready();await observe();const predictionLocalId=await importFile(predictions);await rendered(predictionIds.slice(0,4));
  assert.equal(await b.evaluate(`Array.from(document.querySelectorAll('.pose-head')).some(e=>e.textContent.includes('Experimental reference'))`),false);
  assert.equal(await b.evaluate(`document.querySelector('.pose-head').textContent.includes('inference timing unavailable')`),true);
  assert.equal(await b.evaluate(`document.querySelector('#summary').textContent.includes('0 preferred poses')`),true);
  await b.evaluate(`document.querySelector('.choices [data-decision="preferred"]').click()`);
  await waitFor(()=>b.evaluate(`document.querySelector('#summary').textContent.includes('1 preferred poses')`),20000,'explicit local preference');
  const sentinel='UI persistence test; not a scientific preference';
  await b.evaluate(`(()=>{const input=document.querySelector('.choices .note');input.value=${JSON.stringify(sentinel)};input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const exactDecision=()=>b.evaluate(`(async()=>{const {LibraryStore}=await import('./library-store.js');return(await new LibraryStore().records('decisions',${JSON.stringify(predictionLocalId)})).filter(d=>d.value==='preferred').map(d=>({poseId:d.poseId,note:d.note}));})()`);
  await waitFor(async()=>JSON.stringify(await exactDecision())===JSON.stringify([{poseId:predictionIds[0],note:sentinel}]),20000,'exact pose note saved');
  if(process.env.MOLARIUM_STOCK_REVIEW_SCREENSHOT)await writeFile(process.env.MOLARIUM_STOCK_REVIEW_SCREENSHOT.replace(/\.png$/,'-predictions.png'),await b.capturePng());
  const reopen=new URL(b.appUrl);reopen.searchParams.set('run',predictionLocalId);
  await b.client.call('Page.navigate',{url:reopen.href});await ready();
  await waitFor(()=>b.evaluate(`document.querySelector('#summary').textContent.includes('1 preferred poses')&&document.querySelectorAll('.viewer canvas').length===4`),60000,'reopened exact-pose preference');
  assert.deepEqual(await exactDecision(),[{poseId:predictionIds[0],note:sentinel}]);
  assert.equal(await b.evaluate(`document.querySelector('.choices .note').value`),sentinel);
  await observe();
  const predictionPages=await remainingPages(predictionIds);
  await b.evaluate(`(()=>{window.stockReviewDownloads=[];window.stockReviewPdbDownloads=[];window.stockReviewDownloadNames=[];const original=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{if(blob.type==='application/json')blob.text().then(t=>window.stockReviewDownloads.push(JSON.parse(t)));if(blob.type==='chemical/x-pdb')blob.text().then(t=>window.stockReviewPdbDownloads.push(t));return original(blob);};const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.stockReviewDownloadNames.push(this.download);return;}return click.call(this);};})()`);
  const pdbExport=async(expectedId,expectedName)=>{
    await b.evaluate(`(()=>{window.stockReviewPdbDownloads=[];window.stockReviewDownloadNames=[];Array.from(document.querySelector('.choices').querySelectorAll('button')).find(b=>b.textContent==='PDB').click();})()`);
    await waitFor(()=>b.evaluate(`window.stockReviewPdbDownloads.length===1&&window.stockReviewDownloadNames.length===1`),20000,'original PDB download');
    const value=await b.evaluate(`(async()=>({name:window.stockReviewDownloadNames[0],sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(window.stockReviewPdbDownloads[0]))),b=>b.toString(16).padStart(2,'0')).join('')}))()`);
    assert.equal(value.name,expectedName);
    const pose=[...predictions.bundle.poses,...reference.bundle.poses].find(p=>p.id===expectedId);
    assert.equal(value.sha256,createHash('sha256').update(pose.result.pdb).digest('hex'));
  };
  const lastPageFirstIndex=Math.floor((predictionIds.length-1)/4)*4;
  await pdbExport(predictionIds[lastPageFirstIndex],`${caseId}-pose-${predictions.bundle.poses.find(p=>p.id===predictionIds[lastPageFirstIndex]).sample+1}.pdb`);
  const exported=async selector=>{
    await b.evaluate(`(()=>{window.stockReviewDownloads=[];document.querySelector(${JSON.stringify(selector)}).click();})()`);
    await waitFor(()=>b.evaluate(`window.stockReviewDownloads.length===1`),20000,'local review export');
    return b.evaluate(`(async()=>{const value=window.stockReviewDownloads[0],sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');return{schema:value.schema,run:value.run??value.sourceRun,decisions:value.decisions,poses:await Promise.all(value.poses.map(async p=>({id:p.id,status:p.status,...(p.status==='complete'?{pdbSha256:await sha(p.result.pdb),componentSha256:await sha(JSON.stringify(p.result.component))}:{error:p.error??null})})))}})()`);
  };
  const expectedExports=predictions.bundle.poses.map(p=>({id:p.id,status:p.status,...(p.status==='complete'?{pdbSha256:createHash('sha256').update(p.result.pdb).digest('hex'),componentSha256:createHash('sha256').update(JSON.stringify(p.result.component)).digest('hex')}:{error:p.error??null})}));
  const fullExport=await exported('#export');assert.equal(fullExport.run.importedFrom,predictions.bundle.run.id);assert.deepEqual(fullExport.poses,expectedExports);
  const shortlist=await exported('#shortlist');assert.equal(shortlist.schema,'foldarium.cofolding-shortlist.v1');assert.equal(shortlist.run.importedFrom,predictions.bundle.run.id);assert.deepEqual(shortlist.poses,[expectedExports.find(p=>p.id===predictionIds[0])]);
  for(const value of [fullExport,shortlist])assert.deepEqual(value.decisions.map(d=>({poseId:d.poseId,value:d.value,note:d.note})),[{poseId:predictionIds[0],value:'preferred',note:sentinel}]);
  await b.evaluate('window.stockReviewPlugins=[]');const referenceLocalId=await importFile(reference);assert.notEqual(referenceLocalId,predictionLocalId);await rendered(referenceIds.slice(0,4));
  assert.equal(await b.evaluate(`document.querySelector('#summary').textContent.includes('0 preferred poses')`),true);
  assert.equal(await b.evaluate(`Array.from(document.querySelectorAll('.pose-head')).filter(e=>e.textContent.includes('Experimental reference')).length`),1);
  assert.equal(await b.evaluate(`document.querySelector('.pose-head').textContent.includes('RMSD vs experimental reference')`),true);
  const referenceHead=await b.evaluate(`document.querySelector('.pose-head').textContent`);
  assert.doesNotMatch(referenceHead,/Seed |pLDDT|ipTM|inference/);
  const titles=await b.evaluate(`Array.from(document.querySelectorAll('.pose'),p=>({id:p.dataset.poseId,title:p.querySelector('.pose-head strong').textContent}))`);
  assert.equal(titles[0].title,'Experimental reference');
  for(const pose of titles.slice(1)){const original=predictions.bundle.poses.find(p=>p.id===pose.id);assert.equal(pose.title,`${original.result.model} · pose ${original.sample+1}`);}
  await pdbExport(referenceIds[0],`${caseId}-experimental-reference.pdb`);
  const renderer=await b.evaluate(`(()=>{const canvas=document.querySelector('.viewer canvas'),gl=canvas.getContext('webgl2')||canvas.getContext('webgl');const ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unreported';})()`);
  if(process.env.MOLARIUM_STOCK_REVIEW_REQUIRE_SOFTWARE==='1')assert.match(renderer,/swiftshader/i);
  if(process.env.MOLARIUM_STOCK_REVIEW_SCREENSHOT)await writeFile(process.env.MOLARIUM_STOCK_REVIEW_SCREENSHOT,await b.capturePng());
  const referencePages=await remainingPages(referenceIds);
  let syntheticEarlierFailure=null;
  if(caseId===manifest.caseIds[0]){
    const synthetic=structuredClone(predictions);synthetic.entry.file='synthetic-ui-state-only.library.json';
    synthetic.bundle.run.id+='-synthetic-ui-state-only';synthetic.bundle.run.name='UI test only: earlier request unfinished';synthetic.bundle.decisions=[];
    const first=synthetic.bundle.poses.find(p=>p.id===predictionIds[0]);first.status='failed';delete first.result;
    first.error='Synthetic UI-only failure placeholder; not a recorded model result';
    await b.evaluate('window.stockReviewPlugins=[]');await importFile(synthetic);await rendered(predictionIds.slice(1,5));
    const expectedOrdinal=predictions.bundle.poses.find(p=>p.id===predictionIds[1]).sample+1;
    assert.equal(await b.evaluate(`document.querySelector('.pose-head strong').textContent.endsWith(${JSON.stringify('· pose '+expectedOrdinal)})`),true);
    const partial=await exported('#export');assert.deepEqual(partial.poses.find(p=>p.id===first.id),{id:first.id,status:'failed',error:first.error});
    syntheticEarlierFailure={status:'pass',scope:'Explicit synthetic UI state only; original source libraries and recorded model results are unchanged.',firstVisiblePoseId:predictionIds[1],displayedOrdinal:expectedOrdinal,failedRecordPreservedOnExport:true};
  }
  const networkCheck={scope:'Page network events during file import, review, local persistence and export. URLs exclude query values; no payload/body is captured.',requests:networkRequests,nonReadOnlyRequests:networkRequests.filter(r=>!['GET','HEAD','OPTIONS'].includes(r.method)),unexpectedOrigins:networkRequests.filter(r=>!['https://molarium.org','https://assets.molarium.org'].includes(new URL(r.url).origin)),unexpectedQueryKeys:networkRequests.filter(r=>!r.queryAllowed),newNeuralForwards:0};
networkCheck.status=networkCheck.nonReadOnlyRequests.length===0&&networkCheck.unexpectedOrigins.length===0&&networkCheck.unexpectedQueryKeys.length===0?'pass':'failed';
await writeFile(new URL('./network-check.json',import.meta.url),JSON.stringify(networkCheck,null,2)+'\n',{flag:'wx'});assert.equal(networkCheck.status,'pass','Reviewer must not upload data or make unrelated remote requests');
  const result={status:'pass',sourceExportManifestSha256:createHash('sha256').update(manifestRaw).digest('hex'),caseId,
    fileImport:true,parsedViewers:4,localPreferencePersisted:true,referenceViewSeparate:true,copiedDecisions:0,
    isolatedInferenceTimingInvented:false,webgpuRequests:0,newNeuralForwards:0,renderer,
    predictionPages,referencePages,renderedUniquePredictions:predictionIds.length,
    renderedReferenceInclusiveRecords:referenceIds.length,exactPoseNotePersisted:true,
    exportPreservesOriginalPdbAndGraph:true,shortlistContainsExactSelectedPose:true,
    predictionNumbersStableWithReference:true,experimentalReferenceHasNoPredictionMetadata:true,
    pdbExportsPreserveOriginalCoordinates:true,referenceDownloadLabelExplicit:true,
    syntheticEarlierFailure,
    testDecisionIsScientificJudgement:false};
  if(process.env.MOLARIUM_STOCK_REVIEW_REPORT)await writeFile(process.env.MOLARIUM_STOCK_REVIEW_REPORT,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
} catch(error) {
  if(process.env.MOLARIUM_STOCK_REVIEW_REPORT) {
    const state=await b.evaluate(`({message:document.querySelector('#message')?.textContent,summary:document.querySelector('#summary')?.textContent,
      headers:Array.from(document.querySelectorAll('.pose-head'),e=>e.textContent),errors:Array.from(document.querySelectorAll('.viewer.error'),e=>e.textContent),
      plugins:window.stockReviewPlugins?.map(p=>p.managers.structure.hierarchy.current.structures.map(s=>s.cell.obj?.data?.elementCount))})`).catch(e=>({observationError:e.message}));
    await writeFile(process.env.MOLARIUM_STOCK_REVIEW_REPORT.replace(/\.json$/,'-failure.json'),JSON.stringify({status:'failed',error:String(error),state},null,2)+'\n');
  }
  if(process.env.MOLARIUM_STOCK_REVIEW_SCREENSHOT)await writeFile(process.env.MOLARIUM_STOCK_REVIEW_SCREENSHOT.replace(/\.png$/,'-failure.png'),await b.capturePng());
  throw error;
} finally {await b.close();}
