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
      label:'Two-step completed-review fixture',
      actions:[
        { action:'view.setMode', args:{ mode:'view' }, caption:'Enter View' },
        { action:'view.setMode', args:{ mode:'build' }, caption:'Return to Design' }
      ]
    } } });
    await api.execute({ action:'designerScript.play', args:{ playing:true } });
  })()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-tools')?.dataset.replayStatus === 'completed'`),
  30000, 'completed two-step story');

  const completed = await browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    const inspected = await api.execute({ action:'designerScript.inspect', args:{} });
    return {
      index:inspected.result.designerScript.index,
      review:inspected.result.designerScript.review,
      previousDisabled:document.querySelector('#previous-designer-move').disabled,
      nextDisabled:document.querySelector('#next-designer-move').disabled,
      label:document.querySelector('#replay-designer-moves').textContent,
    };
  })()`);
  assert.equal(completed.index, 2);
  assert.equal(completed.review.completed, true);
  assert.equal(completed.review.checkpointCount, 3);
  assert.equal(completed.previousDisabled, false);
  assert.equal(completed.nextDisabled, true);
  assert.match(completed.label, /Replay story/);

  await browser.evaluate(`document.querySelector('#previous-designer-move').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-progress-label')?.textContent === '1 / 2'`),
  10000, 'completed-story previous checkpoint');
  assert.match(await browser.evaluate(
    `document.querySelector('#replay-designer-moves').textContent`), /Return to final/);

  const actionsBeforeReturn = await browser.evaluate(
    `window.MolariumChemistActions.history().map(record => record.action)`);
  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-progress-label')?.textContent === '2 / 2'`),
  10000, 'return to final checkpoint');
  const afterReturn = await browser.evaluate(`({
    label:document.querySelector('#replay-designer-moves').textContent,
    actions:window.MolariumChemistActions.history().map(record => record.action),
  })`);
  assert.match(afterReturn.label, /Replay story/);
  assert.deepEqual(afterReturn.actions.slice(actionsBeforeReturn.length), ['designerScript.step']);
  assert.equal(afterReturn.actions.filter(action => action === 'view.setMode').length,
    actionsBeforeReturn.filter(action => action === 'view.setMode').length,
    'review navigation must restore checkpoints without rerunning constituent actions');

  console.log('Completed Designer Moves review browser test: PASS');
} finally {
  await browser.close();
}
