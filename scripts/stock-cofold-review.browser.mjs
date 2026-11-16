// Inspect saved poses through the real file-import UI. No prediction API runs.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {startMolariumBrowser,waitFor} from './headless-chrome.mjs';

const root=resolve(import.meta.dirname,'..');
const directory=resolve(process.env.MOLARIUM_STOCK_REVIEW_EXPORTS??join(root,'reviews/cofold-rnp-spectrum-2026-11-15/checkpoint-288/review-examples'));
const manifestRaw=await readFile(join(directory,'manifest.json')),manifest=JSON.parse(manifestRaw);
const caseId=manifest.caseIds[0];
const readBundle=async reference=>{
  const entry=manifest.libraries.find(e=>e.caseId===caseId&&e.referenceIncluded===reference);
  const raw=await readFile(join(directory,entry.file));
  assert.equal(createHash('sha256').update(raw).digest('hex'),entry.sha256);
  return {entry,bundle:JSON.parse(raw)};
};
const predictions=await readBundle(false),reference=await readBundle(true);
const b=await startMolariumBrowser({root,appPath:'vendor/foldarium/library-review.html',width:1500,height:1100});
try {
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
  const rendered=async()=>{
    await waitFor(()=>b.evaluate(`Boolean(document.querySelector('.viewer.error'))||(window.stockReviewPlugins.length===4&&window.stockReviewPlugins.every(p=>p.managers.structure.hierarchy.current.structures.length>=2&&p.managers.structure.hierarchy.current.structures.every(s=>s.cell.obj?.data?.elementCount>0)))`),90000,'four parsed protein/ligand viewers');
    assert.deepEqual(await b.evaluate(`Array.from(document.querySelectorAll('.viewer.error'),e=>e.textContent)`),[]);
    assert.equal(await b.evaluate('window.stockReviewGpuRequests'),0);
  };
  await ready();await observe();const predictionLocalId=await importFile(predictions);await rendered();
  assert.equal(await b.evaluate(`Array.from(document.querySelectorAll('.pose-head')).some(e=>e.textContent.includes('Experimental reference'))`),false);
  assert.equal(await b.evaluate(`document.querySelector('.pose-head').textContent.includes('inference timing unavailable')`),true);
  assert.equal(await b.evaluate(`document.querySelector('#summary').textContent.includes('0 preferred poses')`),true);
  await b.evaluate(`document.querySelector('.choices [data-decision="preferred"]').click()`);
  await waitFor(()=>b.evaluate(`document.querySelector('#summary').textContent.includes('1 preferred poses')`),20000,'explicit local preference');
  if(process.env.MOLARIUM_STOCK_REVIEW_SCREENSHOT)await writeFile(process.env.MOLARIUM_STOCK_REVIEW_SCREENSHOT.replace(/\.png$/,'-predictions.png'),await b.capturePng());
  const reopen=new URL(b.appUrl);reopen.searchParams.set('run',predictionLocalId);
  await b.client.call('Page.navigate',{url:reopen.href});await ready();
  await waitFor(()=>b.evaluate(`document.querySelector('#summary').textContent.includes('1 preferred poses')&&document.querySelectorAll('.viewer canvas').length===4`),60000,'reopened exact-pose preference');
  await observe();const referenceLocalId=await importFile(reference);assert.notEqual(referenceLocalId,predictionLocalId);await rendered();
  assert.equal(await b.evaluate(`document.querySelector('#summary').textContent.includes('0 preferred poses')`),true);
  assert.equal(await b.evaluate(`Array.from(document.querySelectorAll('.pose-head')).filter(e=>e.textContent.includes('Experimental reference')).length`),1);
  assert.equal(await b.evaluate(`document.querySelector('.pose-head').textContent.includes('RMSD vs experimental reference')`),true);
  const renderer=await b.evaluate(`(()=>{const canvas=document.querySelector('.viewer canvas'),gl=canvas.getContext('webgl2')||canvas.getContext('webgl');const ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unreported';})()`);
  if(process.env.MOLARIUM_STOCK_REVIEW_REQUIRE_SOFTWARE==='1')assert.match(renderer,/swiftshader/i);
  if(process.env.MOLARIUM_STOCK_REVIEW_SCREENSHOT)await writeFile(process.env.MOLARIUM_STOCK_REVIEW_SCREENSHOT,await b.capturePng());
  const result={status:'pass',sourceExportManifestSha256:createHash('sha256').update(manifestRaw).digest('hex'),caseId,
    fileImport:true,parsedViewers:4,localPreferencePersisted:true,referenceViewSeparate:true,copiedDecisions:0,
    isolatedInferenceTimingInvented:false,webgpuRequests:0,newNeuralForwards:0,renderer};
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
