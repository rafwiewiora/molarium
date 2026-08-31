import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const root = resolve(import.meta.dirname, '../..');
const browser = await startMolariumBrowser({ root,
  appPath:'design-history/structure-viewer/?story=bclxl-fragment-linking&render=1&frame=0',
  width:1600, height:900 });

try {
  await waitFor(async () => browser.evaluate(`['1','error'].includes(document.body.dataset.ready||'')`),
    90000, 'BCL-xL structure story');
  const initial = await browser.evaluate(`(() => ({ready:document.body.dataset.ready,
    scene:document.body.dataset.scene,title:document.querySelector('#story-title')?.textContent,
    state:window.__molariumStructureStory?.getState()}))()`);
  if (initial.ready !== '1' || initial.scene !== 'overview' || !initial.title?.includes('BCL-xL')
    || !initial.state?.refs.includes('bclxl')) throw Error(`BCL-xL overview failed: ${JSON.stringify(initial)}`);
  const pocketFrame = await browser.evaluate(`window.__molariumStructureStory.frames.findLast(
    frame=>frame.cueIndex===1).frame`);
  await browser.evaluate(`window.__molariumStructureStory.selectFrame(${pocketFrame})`);
  await waitFor(async () => browser.evaluate(`document.body.dataset.frame==='${pocketFrame}'
    && document.body.dataset.renderReady==='1'`), 90000, 'BCL-xL pocket zoom');
  const pocket = await browser.evaluate(`window.__molariumStructureStory.getState()`);
  if (pocket.scene !== 'pocket' || !pocket.refs.includes('pocket')
    || pocket.camera.radius >= initial.state.camera.radius / 2)
    throw Error(`BCL-xL pocket scene failed: ${JSON.stringify(pocket)}`);
  console.log('BCL-xL structure-story browser test passed: 3SPF overview→bound-ligand pocket');
} finally { await browser.close(); }
