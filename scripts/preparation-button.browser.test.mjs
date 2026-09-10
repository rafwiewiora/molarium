import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';
const root=resolve(import.meta.dirname,'..');
// Reuse the small, fully specified public dipeptide fixture from browser-test.
const source=await readFile(resolve(root,'browser-test.js'),'utf8');
const block=source.match(/const alanineDipeptidePdb = \[([\s\S]*?)\]\.join\('\\n'\);/)[1];
const pdb=[...block.matchAll(/'([^']*)'/g)].map(m=>m[1]).join('\n');
const b=await startMolariumBrowser({root,appPath:'?blank=1'});
try {
  await waitFor(()=>b.evaluate('Boolean(window.MolariumChemistActionsReady)'),60000,'API');
  await b.evaluate('window.MolariumChemistActionsReady.then(()=>true)');
  const execute=(action,args)=>b.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({action,args})})`);
  await execute('session.loadStructure',{format:'pdb',content:pdb,polish:false});
  await execute('view.setMode',{mode:'run'});
  await b.evaluate(`document.querySelector('#method-select').value='webgpu';
    document.querySelector('#job-select').value='dynamics';
    document.querySelector('#job-select').dispatchEvent(new Event('change'));
    document.querySelector('#run-calculation').click();`);
  await waitFor(()=>b.evaluate(`document.querySelector('#notice').textContent==='Please prepare protein'`),10000,'notice');
  await b.evaluate(`document.querySelector('#prepare-pdb').click()`);
  await waitFor(()=>b.evaluate(`document.querySelector('#pdb-preparation-badge').textContent==='Prepared'`),60000,'preparation');
  assert.equal(await b.evaluate(`document.querySelector('#run-calculation').disabled`),false,
    'preparation must re-enable Run without toggling job type');
  assert.equal(await b.evaluate(`document.querySelector('#job-select').value`),'dynamics');
  // CPU reference for CI; production GPU is independently exercised by 7KPA.
  // Setting the engine directly MUST NOT dispatch change (which masked the bug).
  await b.evaluate(`document.querySelector('#method-select').add(new Option('CI CPU reference','openmm'));
    document.querySelector('#method-select').value='openmm';
    document.querySelector('#run-calculation').click()`);
  await waitFor(()=>b.evaluate(`['complete','error'].includes(document.body.dataset.calculationState)`),60000,'retry MD');
  assert.equal(await b.evaluate(`document.body.dataset.calculationState`),'complete',
    await b.evaluate(`document.querySelector('#notice').textContent`));
  assert.match(await b.evaluate(`document.querySelector('#result-meta').textContent`),/minimized before dynamics/);
  console.log('Raw protein → failed Run → prepare → first retry runs MD without dropdown refresh: PASS');
} finally {await b.close();}
