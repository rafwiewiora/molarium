import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const root = resolve(import.meta.dirname, '../..');
const browser = await startMolariumBrowser({ root,
  appPath:'design-history/structure-viewer/?story=bclxl-fragment-linking&render=1&frame=0',
  width:1600, height:900 });

try {
  await waitFor(async () => browser.evaluate(`['1','error'].includes(document.body.dataset.ready||'')`),
    90000, 'BCL-xL structure story');
  const initial = await browser.evaluate(`(async() => {const api=await window.MolariumChemistActionsReady;
    return {ready:document.body.dataset.ready,
    scene:document.body.dataset.scene,title:document.querySelector('#story-title')?.textContent,
    privateApi:typeof window.__molariumStructureStory,
    state:(await api.execute({action:'structureStory.inspect',args:{}})).result}})()`);
  if (initial.ready !== '1' || initial.scene !== 'compound4Overview' || !initial.title?.includes('BCL-xL')
    || !initial.state?.refs.includes('bclxl') || initial.privateApi !== 'undefined')
    throw Error(`BCL-xL overview failed: ${JSON.stringify(initial)}`);
  const states = [
    ['compound-6-linked','compound6'], ['compound-7-linker','compound7'],
    ['compound-16-truncation','compound16'], ['compound-21-pocket-fill','compound21'],
  ];
  for (const [cueId, scene] of states) {
    const selected = await browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({
      action:'structureStory.selectCue',args:{ cueId },
    })})`);
    const selectedFrame = selected.result.frame;
    await waitFor(async () => browser.evaluate(`document.body.dataset.frame==='${selectedFrame}'
      && document.body.dataset.renderReady==='1'`), 90000, `BCL-xL ${cueId}`);
    if (selected.result.scene !== scene || !selected.result.refs.includes('pocket')
      || !selected.result.refs.includes('bclxl')
      || selected.result.camera.radius >= initial.state.camera.radius)
      throw Error(`BCL-xL state ${cueId} failed: ${JSON.stringify(selected.result)}`);
  }
  const audit = await browser.evaluate(`window.MolariumChemistActions.history()`);
  if (!states.every(([cueId]) => audit.some((entry) =>
    entry.action === 'structureStory.selectCue' && entry.args.cueId === cueId)))
    throw Error(`BCL-xL cue audit incomplete: ${JSON.stringify(audit)}`);
  console.log('BCL-xL structure-story browser test passed: API-replayed compounds 4→6→7→16→21');
} finally { await browser.close(); }
