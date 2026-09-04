import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';

const root = resolve(import.meta.dirname, '..');
const remoteBase = process.env.MOLARIUM_STORY_BASE_URL
  ? new URL(process.env.MOLARIUM_STORY_BASE_URL) : null;
const qaOutput = process.env.MOLARIUM_QA_OUTPUT
  ? resolve(process.env.MOLARIUM_QA_OUTPUT) : null;
const expectedNetworkBadge = process.env.MOLARIUM_EXPECT_NETWORK_BADGE
  || (remoteBase ? 'Connected features' : 'Local Lab · network locked');
const browser = await startMolariumBrowser({
  ...(remoteBase
    ? { url:new URL('/sos1-hit-to-bay293', remoteBase).href }
    : { root, appPath:'sos1-hit-to-bay293', localOnly:true }),
  width:1600,
  height:1000,
});

async function registeredStory() {
  return browser.evaluate(`window.MolariumChemistActions.history()
    .find((entry) => entry.action === 'designerScript.loadRegistered'
      && entry.status === 'completed')?.result?.registeredDesignerScript || null`);
}

async function waitForBlankStory(storyId) {
  await waitFor(async () => browser.evaluate(`Boolean(window.MolariumChemistActionsReady)`),
    30000, `${storyId} Chemist Actions API`);
  await waitFor(async () => (await registeredStory())?.storyId === storyId,
    90000, `${storyId} registered story`);
  const snapshot = await browser.evaluate(`({
    status:document.querySelector('#designer-move-status')?.textContent?.trim() || '',
    progress:document.querySelector('#designer-move-progress-label')?.textContent?.trim() || '',
    moleculeHidden:document.querySelector('#molecule-info')?.classList.contains('hidden'),
    sceneHidden:document.querySelector('.scene-card')?.classList.contains('hidden'),
    playDisabled:document.querySelector('#replay-designer-moves')?.disabled,
    modeLabels:[...document.querySelectorAll('.mode-bar button')]
      .map((button) => button.textContent.trim()),
    designActive:document.querySelector('.mode-bar button[data-mode="build"]')
      ?.classList.contains('active'),
    networkBadge:document.querySelector('#network-policy-label')?.textContent?.trim() || '',
    title:document.title,
  })`);
  assert.match(snapshot.status, /ready on a blank canvas/i);
  assert.match(snapshot.progress, /^0 \/ [1-9]\d*$/);
  assert.equal(snapshot.moleculeHidden, true);
  assert.equal(snapshot.sceneHidden, true);
  assert.equal(snapshot.playDisabled, false);
  assert.deepEqual(snapshot.modeLabels, ['View','Design','Simulate']);
  assert.equal(snapshot.designActive, true);
  assert.equal(snapshot.networkBadge, expectedNetworkBadge);
  const registered = await registeredStory();
  assert.equal(registered.storyId, storyId);
  assert.equal(registered.installed?.presentation, 'chemist-pocket',
    `${storyId} must use the fixed pocket presentation in the full Molarium interface`);
  return { snapshot, registered };
}

async function screenshot(filename) {
  if (!qaOutput) return;
  await mkdir(qaOutput, { recursive:true });
  await writeFile(join(qaOutput, filename), await browser.capturePng());
}

try {
  const executable = await waitForBlankStory('sos1-hit-to-bay293');
  assert(!/accepted|success/i.test(executable.snapshot.title),
    'the complete-frozen executable route must not claim acceptance or success');
  await screenshot('01-executable-blank-full-interface.png');

  const origin = new URL(browser.appUrl).origin;
  await browser.client.call('Page.navigate', {
    url:`${origin}/sos1-hit-to-bay293/review`,
  });
  const review = await waitForBlankStory('sos1-hit-to-bay293-review');
  assert(!/accepted|success/i.test(review.snapshot.title),
    'the complete-frozen review route must not claim acceptance or success');
  const reviewMoveCount = review.registered.installed.actionCount;
  await screenshot('02-review-blank-full-interface.png');

  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(
    `Number(document.querySelector('#designer-move-progress-label')?.textContent?.split('/')[0]) >= 1
      || document.querySelector('#designer-move-tools')?.dataset.replayStatus === 'failed'`),
  120000, 'first calculation-free prediction checkpoint');
  const firstMoveStatus = await browser.evaluate(`({
    replayStatus:document.querySelector('#designer-move-tools')?.dataset.replayStatus,
    progress:document.querySelector('#designer-move-progress-label')?.textContent,
    notice:document.querySelector('#notice')?.textContent,
  })`);
  assert.notEqual(firstMoveStatus.replayStatus, 'failed',
    `prediction review failed before its first checkpoint: ${JSON.stringify(firstMoveStatus)}`);
  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#replay-designer-moves')?.textContent?.includes('Continue')
      && !document.querySelector('#previous-designer-move')?.disabled`),
  30000, 'paused calculation-free prediction review');
  const pausedFrontier = await browser.evaluate(`Number(
    document.querySelector('#designer-move-progress-label').textContent.split('/')[0])`);
  assert.ok(pausedFrontier >= 1);
  const firstImportCount = await browser.evaluate(`window.MolariumChemistActions.history()
    .filter((entry) => entry.action === 'campaign.import').length`);
  await browser.evaluate(`document.querySelector('#previous-designer-move').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-progress-label')?.textContent?.trim()
      === '${pausedFrontier - 1} / ${reviewMoveCount}'`),
  30000, 'previous calculation-free checkpoint during a pause');
  assert.match(await browser.evaluate(
    `document.querySelector('#replay-designer-moves').textContent`), /Return & continue/);
  const actionsBeforeContinue = await browser.evaluate(
    `window.MolariumChemistActions.history().map((entry) => entry.action)`);
  await browser.evaluate(`(() => {
    window.__sos1TransportProgress = [];
    const label = document.querySelector('#designer-move-progress-label');
    window.__sos1TransportObserver = new MutationObserver(() =>
      window.__sos1TransportProgress.push(label.textContent.trim()));
    window.__sos1TransportObserver.observe(label, {
      childList:true, characterData:true, subtree:true,
    });
  })()`);
  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(
    `Number(document.querySelector('#designer-move-progress-label')?.textContent?.split('/')[0])
      > ${pausedFrontier}`),
  30000, 'resume from the live calculation-free frontier');
  const resumed = await browser.evaluate(`({
    importCount:window.MolariumChemistActions.history()
      .filter((entry) => entry.action === 'campaign.import').length,
    loadCount:window.MolariumChemistActions.history()
      .filter((entry) => entry.action === 'designerScript.loadRegistered').length,
    actions:window.MolariumChemistActions.history().map((entry) => entry.action),
    progress:(window.__sos1TransportObserver?.disconnect(),
      window.__sos1TransportProgress || []),
  })`);
  assert.ok(resumed.importCount >= firstImportCount,
    'resuming the review must preserve all already completed checkpoint imports');
  assert.equal(resumed.loadCount, 1,
    'Return & continue must not reload the registered story from move 1');
  assert.deepEqual(resumed.actions.slice(actionsBeforeContinue.length, actionsBeforeContinue.length + 2),
    ['designerScript.step','designerScript.play'],
    'the human Return & continue control must publicly restore the frontier before resuming');
  assert.ok(resumed.progress.every((label) => Number(label.split('/')[0]) >= pausedFrontier),
    `Return & continue visibly rewound below frontier ${pausedFrontier}: ${resumed.progress.join(', ')}`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-tools')?.dataset.replayStatus === 'completed'`),
  120000, 'complete calculation-free prediction review');
  await waitFor(async () => browser.evaluate(
    `Boolean(document.querySelector('#structure-2d-drawing svg'))`),
  30000, 'final ligand 2D depiction');

  const inspected = await browser.evaluate(`window.MolariumChemistActions.execute({
    requestId:'qa-final-ligand-inspection', action:'session.inspect',
    args:{ scope:'ligand', includeCoordinates:false, maximumAtoms:100 }
  })`);
  assert.equal(inspected.status, 'completed');
  const ligand = inspected.result;
  const heavyIds = new Set(ligand.atoms.filter((atom) => atom.element !== 'H')
    .map((atom) => atom.atomId));
  const heavyBonds = ligand.bonds.filter((bond) =>
    bond.atomIds.every((atomId) => heavyIds.has(atomId))).length;
  const complete = await browser.evaluate(`(() => {
    const history = window.MolariumChemistActions.history();
    const imports = history.filter((entry) => entry.action === 'campaign.import');
    const highlights = history.filter((entry) => entry.action === 'view.highlightAtoms');
    const svg = document.querySelector('#structure-2d-drawing svg');
    return {
      progress:document.querySelector('#designer-move-progress-label')?.textContent?.trim(),
      previousEnabled:!document.querySelector('#previous-designer-move')?.disabled,
      nextEnabled:!document.querySelector('#next-designer-move')?.disabled,
      playLabel:document.querySelector('#replay-designer-moves')?.textContent?.trim(),
      cueCount:document.querySelectorAll('.designer-move-cue, .designer-move-press, .designer-move-change').length,
      calculations:history.filter((entry) => /^(pose\\.refine|optimization\\.|calculation\\.|protein\\.prepare)/.test(entry.action)).map((entry) => entry.action),
      imports:imports.map((entry) => ({ preserveView:entry.args.preserveView,
        viewPreserved:entry.result?.campaignImport?.viewPreserved })),
      focusCount:history.filter((entry) => entry.action === 'view.focusComponent').length,
      highlights:highlights.map((entry) => entry.result?.highlightedAtoms || null),
      depiction:{ atomGraphics:svg?.querySelectorAll('[class*="atom-"]').length || 0,
        bondGraphics:svg?.querySelectorAll('[class*="bond-"]').length || 0,
        width:svg?.viewBox?.baseVal?.width || 0, height:svg?.viewBox?.baseVal?.height || 0 },
      networkBadge:document.querySelector('#network-policy-label')?.textContent?.trim() || '',
    };
  })()`);
  assert.match(complete.progress, /^[1-9]\d* \/ [1-9]\d*$/);
  assert.equal(complete.progress.split('/')[0].trim(), complete.progress.split('/')[1].trim());
  assert.equal(complete.previousEnabled, true);
  assert.equal(complete.nextEnabled, false);
  assert.match(complete.playLabel, /Replay story/);
  assert.equal(complete.cueCount, 0);
  assert.deepEqual(complete.calculations, []);
  assert.equal(complete.imports.length, 4);
  assert.deepEqual(complete.imports.map((entry) => entry.preserveView),
    [false,true,true,true]);
  assert.deepEqual(complete.imports.map((entry) => entry.viewPreserved),
    [false,true,true,true]);
  assert.equal(complete.focusCount, 1,
    'only the first exact checkpoint may establish the pocket camera');
  assert.ok(complete.highlights.length >= 4);
  assert.ok(complete.highlights.every((entry) => entry?.cameraPreserved === true
    && entry?.displayContextPreserved === true));
  assert.ok(complete.highlights.at(-1)?.residueLabels?.some((entry) =>
    entry.label === 'Phe890' && entry.tone === 'gold'));
  assert.ok(complete.depiction.atomGraphics >= heavyIds.size,
    'the final 2D depiction does not draw every ligand heavy atom');
  assert.ok(complete.depiction.bondGraphics >= heavyBonds,
    'the final 2D depiction does not draw every ligand heavy bond');
  assert.ok(complete.depiction.width > 0 && complete.depiction.height > 0);
  assert.equal(complete.networkBadge, expectedNetworkBadge);
  await screenshot('03-review-completed-fixed-pocket.png');

  const finalProgress = complete.progress;
  const total = Number(finalProgress.split('/')[1]);
  await browser.evaluate(`document.querySelector('#previous-designer-move').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-progress-label')?.textContent?.trim() === '${total - 1} / ${total}'`),
  30000, 'previous exact checkpoint after completion');
  await browser.evaluate(`document.querySelector('#next-designer-move').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-progress-label')?.textContent?.trim() === '${total} / ${total}'`),
  30000, 'return to final exact checkpoint');
  assert.equal(await browser.evaluate(
    `document.querySelectorAll('.designer-move-cue, .designer-move-press, .designer-move-change').length`),
  0, 'terminal review navigation must clear transient change markers');

  console.log('SOS1 frozen public routes browser QA: blank executable/review entries, honest labels, '
    + 'fixed camera, exact arrowable checkpoints, complete 2D ligand, and zero review calculations PASS');
} finally {
  await browser.close();
}
