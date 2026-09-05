import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const browser = await startMolariumBrowser({
  root:resolve(import.meta.dirname, '../..'), appPath:'?blank=1', width:1280, height:800,
});

async function inspect() {
  return browser.evaluate(`window.MolariumChemistActions.execute({
    action:'designerScript.inspect', args:{}
  }).then((entry) => entry.result.designerScript)`);
}

try {
  await waitFor(async () => browser.evaluate(`Boolean(window.MolariumChemistActionsReady)`),
    30000, 'Molarium API');
  await browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    await api.execute({ action:'designerScript.load', args:{ script:{
      schema:'molarium.chemist-action-script/v1', label:'Replay transport fixture',
      actions:[
        { action:'view.setMode', args:{ mode:'view' }, caption:'Enter View' },
        { action:'view.setMode', args:{ mode:'build' }, caption:'Enter Design' },
        { action:'view.setMode', args:{ mode:'run' }, caption:'Enter Simulate' },
        { action:'view.setMode', args:{ mode:'view' }, caption:'Return to View' }
      ]
    } } });
    await api.execute({ action:'designerScript.play', args:{ playing:true } });
  })()`);

  await waitFor(async () => (await inspect()).frontier >= 1, 30000,
    'first replay checkpoint');
  await browser.evaluate(`window.MolariumChemistActions.execute({
    action:'designerScript.play', args:{ playing:false }
  })`);
  const paused = await waitFor(async () => {
    const value = await inspect();
    return value.review.live && value.frontier >= 1 ? value : null;
  }, 30000, 'paused replay frontier');
  const frontier = paused.frontier;
  const completedBeforeReview = await browser.evaluate(`window.MolariumChemistActions.history()
    .filter((entry) => entry.action === 'view.setMode' && entry.status === 'completed').length`);

  await browser.evaluate(`window.MolariumChemistActions.execute({
    action:'designerScript.step', args:{ direction:'previous' }
  })`);
  const reviewing = await inspect();
  assert.equal(reviewing.index, frontier - 1);
  assert.equal(reviewing.frontier, frontier,
    'review navigation must not move the live execution frontier');
  assert.equal(reviewing.review.reviewing, true);

  // This is the same public sequence used by the human Return & continue
  // button: restore the frontier, then release the paused replay promise.
  await browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    await api.execute({ action:'designerScript.step', args:{ direction:'final' } });
    await api.execute({ action:'designerScript.play', args:{ playing:true } });
  })()`);
  const restored = await inspect();
  assert.ok(restored.index >= frontier,
    'resume must restore the live frontier before executing another action');
  const prefixAfterResume = await browser.evaluate(`window.MolariumChemistActions.history()
    .filter((entry) => entry.action === 'view.setMode' && entry.status === 'completed')
    .slice(0, ${completedBeforeReview}).map((entry) => entry.args.mode)`);
  assert.deepEqual(prefixAfterResume,
    ['view','build','run','view'].slice(0, completedBeforeReview),
    'resume must not restart completed story actions from move 1');

  const completed = await waitFor(async () => {
    const value = await inspect();
    return value.review.completed ? value : null;
  }, 30000, 'completed replay with cached checkpoints');
  assert.equal(completed.index, 4);
  assert.equal(completed.frontier, 4);
  assert.equal(completed.review.checkpointCount, 5);
  assert.equal(completed.review.atFinal, true);
  assert.equal(await browser.evaluate(
    `document.querySelector('#previous-designer-move').disabled`), false,
  'completion must retain an enabled back arrow');

  await browser.evaluate(`window.MolariumChemistActions.execute({
    action:'designerScript.step', args:{ direction:'previous' }
  })`);
  const completedReview = await inspect();
  assert.equal(completedReview.index, 3);
  assert.equal(completedReview.frontier, 4);
  assert.equal(completedReview.review.completed, true);
  assert.equal(completedReview.review.reviewing, true);
  assert.equal(await browser.evaluate(
    `document.querySelector('#next-designer-move').disabled`), false);

  await browser.evaluate(`window.MolariumChemistActions.execute({
    action:'designerScript.step', args:{ direction:'next' }
  })`);
  const returned = await inspect();
  assert.equal(returned.index, 4);
  assert.equal(returned.review.completed, true);
  assert.equal(returned.review.atFinal, true);
  assert.equal(await browser.evaluate(`window.MolariumChemistActions.history()
    .filter((entry) => entry.action === 'view.setMode' && entry.status === 'completed').length`), 4,
  'completed checkpoint review must not rerun story actions');

  console.log('Designer replay transport browser test: PASS');
} finally {
  await browser.close();
}
