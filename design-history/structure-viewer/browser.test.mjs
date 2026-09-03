import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const root = resolve(import.meta.dirname, '../..');
const cameraDistance = (camera) => Math.hypot(...camera.position.map((value, index) =>
  value - camera.target[index]));
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
      molstar:typeof window.molstar,api:typeof window.MolariumChemistActions,
      canvases:document.querySelectorAll('canvas').length}))()`);
    throw new Error(`${error.message}; ${JSON.stringify(diagnostic)}`);
  }
  const initial = await browser.evaluate(`(async() => {const api=await window.MolariumChemistActionsReady;
    return {ready:document.body.dataset.ready,
    error:document.querySelector('#error')?.textContent,scene:document.body.dataset.scene,
    frame:document.body.dataset.frame,canvas:document.querySelectorAll('#viewer canvas').length,
    title:document.querySelector('#story-title')?.textContent,
    width:document.querySelector('#stage')?.getBoundingClientRect().width,
    privateApi:typeof window.__molariumStructureStory,
    actions:Object.keys(api.describe().actions),
    state:(await api.execute({action:'structureStory.inspect',args:{}})).result}})()`);
  if (initial.ready !== '1' || initial.scene !== 'x1' || initial.frame !== '0'
    || initial.canvas < 1 || initial.width < 1000 || initial.state?.refs?.length !== 2
    || initial.privateApi !== 'undefined'
    || !initial.actions.includes('structureStory.selectFrame')
    || initial.actions.includes('chemistry.finish'))
    throw new Error(`Incomplete initial structure story: ${JSON.stringify(initial)}`);

  const zoom = await browser.evaluate(`window.MolariumChemistActions.execute({
    action:'structureStory.selectCue',args:{cueId:'enter-binding-site'}})`);
  const zoomFrame = zoom.result.cueEndFrame;
  const zoomEnd = await browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({
    action:'structureStory.selectFrame',args:{ frame:'__FRAME__' },
  }).replace('"__FRAME__"', String(zoomFrame))})`);
  await waitFor(async () => browser.evaluate(`document.body.dataset.frame==='${zoomFrame}'
    && document.body.dataset.renderReady==='1'`), 45000, 'pocket zoom frame');
  const pocket = zoomEnd.result;
  if (pocket.scene !== 'x1Pocket' || !pocket.refs.includes('pocket')
    || !pocket.refs.includes('interactions')
    || cameraDistance(pocket.camera) >= cameraDistance(initial.state.camera) / 2)
    throw new Error(`Pocket zoom or interaction scene failed: ${JSON.stringify(pocket)}`);

  const overlayEnvelope = await browser.evaluate(`window.MolariumChemistActions.execute({
    action:'structureStory.selectCue',args:{cueId:'crystal-comparison'}})`);
  const overlayFrame = overlayEnvelope.result.frame;
  await waitFor(async () => browser.evaluate(`document.body.dataset.frame==='${overlayFrame}'
    && document.body.dataset.renderReady==='1'`), 45000, 'crystal overlay frame');
  const overlay = overlayEnvelope.result;
  if (overlay.scene !== 'overlay' || !overlay.refs.includes('x1') || !overlay.refs.includes('x38'))
    throw new Error(`Experimental overlay failed: ${JSON.stringify(overlay)}`);
  console.log(`structure-story browser test passed: ${initial.title}; overview→pocket camera and 7GN8/7GNR overlay`);
} finally {
  await browser.close();
}
