import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';

const executable = JSON.parse(readFileSync(resolve(import.meta.dirname, '..',
  'design-history/examples/sos1-prediction.action-script.json')));
const firstRefinement = executable.actions.find((step) => step.action === 'pose.refine');
assert(firstRefinement, 'registered executable story has no pose.refine action');
assert.equal(executable.sourceAudit.executionContract.mode, 'portable-scientific');
assert.equal(executable.sourceAudit.stateHashGuards.mode, 'off');
assert.equal(Object.keys(firstRefinement.args).some((key) =>
  /^expected.*(?:Coordinate|State)Sha256$/.test(key)), false,
'cross-platform recomputation must not demand exact recorded coordinate bytes');
assert.equal(firstRefinement.expect['refinement.coverageComplete'], true);
assert.equal(firstRefinement.expect['refinement.selectedFeasible'], true);

const browser = await startMolariumBrowser({
  root:resolve(import.meta.dirname, '..'), appPath:'sos1-hit-to-bay293',
  width:1400, height:900,
});

try {
  await waitFor(async () => browser.evaluate(`Boolean(window.MolariumChemistActionsReady)
    && !document.querySelector('#replay-designer-moves')?.disabled`),
  90000, 'SOS1 executable story');
  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(`(() => {
    const history = window.MolariumChemistActions.history();
    return history.some((entry) => entry.action === 'pose.refine'
      && ['completed','failed'].includes(entry.status))
      || document.querySelector('#designer-move-tools')?.dataset.replayStatus === 'failed';
  })()`), 180000, 'first executable pose refinement');

  const result = await browser.evaluate(`(async () => {
    const history = window.MolariumChemistActions.history();
    const refinement = history.find((entry) => entry.action === 'pose.refine');
    const failed = history.filter((entry) => entry.status === 'failed').at(-1) || null;
    return {
      refinement,
      failed,
      progress:document.querySelector('#designer-move-progress-label')?.textContent?.trim(),
      detail:document.querySelector('#designer-move-detail')?.textContent?.trim(),
      playLabel:document.querySelector('#replay-designer-moves')?.textContent?.trim(),
      previousEnabled:!document.querySelector('#previous-designer-move')?.disabled,
      replayStatus:document.querySelector('#designer-move-tools')?.dataset.replayStatus,
    };
  })()`);
  if (result.refinement?.status !== 'completed')
    console.error(JSON.stringify(result, null, 2));
  assert.equal(result.refinement?.status, 'completed',
    `first public pose.refine failed: ${result.refinement?.error || result.failed?.error}`);
  assert.equal(result.refinement.result.refinement.coverageComplete, true);
  assert.equal(result.refinement.result.refinement.selectedFeasible, true);
  assert.equal(result.refinement.result.refinement.selectedCore.satisfied, true);
  assert.notEqual(result.replayStatus, 'failed');
  console.log('SOS1 executable first-refinement browser regression: PASS');
} finally {
  await browser.close();
}
