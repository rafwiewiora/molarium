import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const root = resolve(import.meta.dirname, '../..');
const browser = await startMolariumBrowser({ root,
  appPath:'design-history/structure-viewer/?render=1&frame=0', width:1600, height:900 });

try {
  try {
    await waitFor(async () => browser.evaluate(`['1','error'].includes(document.body.dataset.ready||'')`),
      90000, 'structure-story viewer');
  } catch (error) {
    const diagnostic = await browser.evaluate(`(() => ({ready:document.body.dataset.ready,
      renderReady:document.body.dataset.renderReady,scene:document.body.dataset.scene,
      boot:document.querySelector('#boot')?.textContent,error:document.querySelector('#error')?.textContent,
      molstar:typeof window.molstar,api:typeof window.__molariumStructureStory,
      canvases:document.querySelectorAll('canvas').length}))()`);
    throw new Error(`${error.message}; ${JSON.stringify(diagnostic)}`);
  }
  const initial = await browser.evaluate(`(() => ({ready:document.body.dataset.ready,
    error:document.querySelector('#error')?.textContent,scene:document.body.dataset.scene,
    frame:document.body.dataset.frame,canvas:document.querySelectorAll('#viewer canvas').length,
    title:document.querySelector('#story-title')?.textContent,
    width:document.querySelector('#stage')?.getBoundingClientRect().width,
    state:window.__molariumStructureStory?.getState()}))()`);
  if (initial.ready !== '1' || initial.scene !== 'x1' || initial.frame !== '0'
    || initial.canvas < 1 || initial.width < 1000 || initial.state?.refs?.length !== 2)
    throw new Error(`Incomplete initial structure story: ${JSON.stringify(initial)}`);

  const zoomFrame = await browser.evaluate(`window.__molariumStructureStory.frames.findLast(
    frame=>frame.cueIndex===1).frame`);
  await browser.evaluate(`window.__molariumStructureStory.selectFrame(${zoomFrame})`);
  await waitFor(async () => browser.evaluate(`document.body.dataset.frame==='${zoomFrame}'
    && document.body.dataset.renderReady==='1'`), 45000, 'pocket zoom frame');
  const pocket = await browser.evaluate(`window.__molariumStructureStory.getState()`);
  if (pocket.scene !== 'x1Pocket' || !pocket.refs.includes('pocket')
    || !pocket.refs.includes('interactions') || pocket.camera.radius >= initial.state.camera.radius / 2)
    throw new Error(`Pocket zoom or interaction scene failed: ${JSON.stringify(pocket)}`);

  const overlayFrame = await browser.evaluate(`window.__molariumStructureStory.frames.find(
    frame=>frame.cueIndex===4).frame`);
  await browser.evaluate(`window.__molariumStructureStory.selectFrame(${overlayFrame})`);
  await waitFor(async () => browser.evaluate(`document.body.dataset.frame==='${overlayFrame}'
    && document.body.dataset.renderReady==='1'`), 45000, 'crystal overlay frame');
  const overlay = await browser.evaluate(`window.__molariumStructureStory.getState()`);
  if (overlay.scene !== 'overlay' || !overlay.refs.includes('x1') || !overlay.refs.includes('x38'))
    throw new Error(`Experimental overlay failed: ${JSON.stringify(overlay)}`);
  console.log(`structure-story browser test passed: ${initial.title}; overview→pocket camera and 7GN8/7GNR overlay`);
} finally {
  await browser.close();
}
