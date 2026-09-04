import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const browser = await startMolariumBrowser({
  root:resolve(import.meta.dirname, '../..'), appPath:'?blank=1', width:1280, height:800,
});

try {
  await waitFor(async () => browser.evaluate(`Boolean(window.MolariumChemistActionsReady)`),
    30000, 'Molarium API');
  await browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    await api.execute({ action:'designerScript.load', args:{ script:{
      schema:'molarium.chemist-action-script/v1',
      label:'Failed replay review fixture',
      actions:[
        { action:'view.setMode', args:{ mode:'view' }, caption:'Enter View' },
        { action:'view.focusComponent', args:{ kind:'ligand', ordinal:0, isolate:false },
          caption:'Focus an unavailable ligand' }
      ]
    } } });
    await api.execute({ action:'designerScript.play', args:{ playing:true } });
  })()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-tools')?.dataset.replayStatus === 'failed'`),
  30000, 'failed two-step story');

  const stopped = await browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    const inspected = await api.execute({ action:'designerScript.inspect', args:{} });
    let playError = null;
    try { await api.execute({ action:'designerScript.play', args:{ playing:true } }); }
    catch (error) { playError = String(error.message || error); }
    return {
      inspected:inspected.result.designerScript,
      progress:document.querySelector('#designer-move-progress-label').textContent.trim(),
      label:document.querySelector('#replay-designer-moves').textContent.trim(),
      playDisabled:document.querySelector('#replay-designer-moves').disabled,
      previousDisabled:document.querySelector('#previous-designer-move').disabled,
      nextDisabled:document.querySelector('#next-designer-move').disabled,
      detail:document.querySelector('#designer-move-detail').textContent.trim(),
      playError,
      constituentActions:api.history().filter((entry) =>
        ['view.setMode','view.focusComponent'].includes(entry.action)).map((entry) => entry.action),
    };
  })()`);
  assert.equal(stopped.progress, '2 / 2');
  assert.equal(stopped.inspected.review.failed, true);
  assert.equal(stopped.inspected.frontier, 2);
  assert.equal(stopped.playDisabled, true);
  assert.match(stopped.label, /Story stopped/);
  assert.match(stopped.detail, /Stopped at move 2: ligand component 0 does not exist/);
  assert.match(stopped.playError, /Story stopped at move 2.*designerScript\.restart/);
  assert.equal(stopped.previousDisabled, false);
  assert.equal(stopped.nextDisabled, true);
  assert.deepEqual(stopped.constituentActions, ['view.setMode','view.focusComponent'],
    'attempting Play on a failed story must not reset and rerun move 1');

  await browser.evaluate(`document.querySelector('#previous-designer-move').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-progress-label')?.textContent === '1 / 2'`),
  10000, 'checkpoint before failure');
  assert.equal(await browser.evaluate(
    `document.querySelector('#next-designer-move').disabled`), false);
  await browser.evaluate(`document.querySelector('#next-designer-move').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-progress-label')?.textContent === '2 / 2'`),
  10000, 'failed frontier checkpoint');
  assert.match(await browser.evaluate(
    `document.querySelector('#designer-move-detail').textContent`),
  /Stopped at move 2.*No result was applied/);

  await browser.evaluate(`window.MolariumChemistActions.execute({
    action:'designerScript.restart', args:{}
  })`);
  assert.equal(await browser.evaluate(
    `document.querySelector('#designer-move-progress-label').textContent.trim()`), '0 / 2');
  assert.equal(await browser.evaluate(
    `document.querySelector('#replay-designer-moves').disabled`), false);

  console.log('Failed Designer Moves review browser test: PASS');
} finally {
  await browser.close();
}
