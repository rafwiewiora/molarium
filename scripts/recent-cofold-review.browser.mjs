import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {startMolariumBrowser,waitFor} from './headless-chrome.mjs';
const root=resolve(import.meta.dirname,'..');
const b=await startMolariumBrowser(process.env.MOLARIUM_PUBLIC_REVIEW_URL
  ?{url:process.env.MOLARIUM_PUBLIC_REVIEW_URL}:{root,appPath:'reviews/cofold-recent-pdb-2026-11-13/index.html'});
try{
  const home=b.appUrl;
  const landing=()=>waitFor(()=>b.evaluate(`document.querySelectorAll('#cases article').length===9`),30000,'nine review systems');
  const grid=()=>waitFor(()=>b.evaluate(`document.querySelectorAll('.viewer canvas').length>=2||Boolean(document.querySelector('.viewer.error'))`),60000,'saved pose viewers');
  const checkErrors=async()=>assert.deepEqual(await b.evaluate(`Array.from(document.querySelectorAll('.viewer.error'),e=>e.textContent)`),[]);
  await landing();
  await b.evaluate(`document.querySelector('#cases article button').click()`);await grid();await checkErrors();
  const runId=await b.evaluate(`new URL(location.href).searchParams.get('run')`);
  assert.ok(runId);
  assert.equal(await b.evaluate(`Array.from(document.querySelectorAll('.pose-head'),e=>e.textContent).some(t=>t.includes('Experimental reference'))`),false);
  await b.evaluate(`document.querySelector('.choices button').click()`);
  await waitFor(()=>b.evaluate(`document.querySelector('#summary').textContent.includes('1 preferred poses')`),20000,'local preference');
  await b.client.call('Page.navigate',{url:home});await landing();
  await b.evaluate(`document.querySelector('#cases article button').click()`);await grid();await checkErrors();
  assert.equal(await b.evaluate(`new URL(location.href).searchParams.get('run')`),runId);
  await waitFor(()=>b.evaluate(`document.querySelector('#summary').textContent.includes('1 preferred poses')`),20000,'reopened preference');
  await b.client.call('Page.navigate',{url:home});await landing();
  await b.evaluate(`document.querySelector('#cases article button:nth-of-type(2)').click()`);await grid();await checkErrors();
  assert.notEqual(await b.evaluate(`new URL(location.href).searchParams.get('run')`),runId);
  assert.equal(await b.evaluate(`Array.from(document.querySelectorAll('.pose-head'),e=>e.textContent).filter(t=>t.includes('Experimental reference')).length`),1);
  assert.equal(await b.evaluate(`document.querySelector('#summary').textContent.includes('0 preferred poses')`),true);
  if(process.env.MOLARIUM_PUBLIC_REVIEW_SCREENSHOT)await writeFile(process.env.MOLARIUM_PUBLIC_REVIEW_SCREENSHOT,await b.capturePng());
  console.log('Nine-system public review: saved poses rendered; exact-hash reopening preserves preferences; reference review remains separate. PASS');
}finally{await b.close();}
