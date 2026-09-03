import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const root = resolve(import.meta.dirname, '../..');
const remoteUrl = process.env.MOLARIUM_STORY_URL || null;
const browser = await startMolariumBrowser({
  ...(remoteUrl ? { url:remoteUrl } : { root, appPath:'sos1-hit-to-bay293' }),
  width:1600,
  height:1000,
});

try {
  await waitFor(async () => browser.evaluate(`document.title === 'SOS1 hit to BAY-293 · Molarium'
    && document.querySelector('#designer-move-progress-label')?.textContent === '0 / 49'
    && !document.querySelector('#replay-designer-moves')?.disabled`), 90000, 'deep-linked story');
  const initial = await browser.evaluate(`({
    url:location.href,
    play:document.querySelector('#replay-designer-moves').textContent,
    status:document.querySelector('#designer-move-status').textContent,
    moleculeHidden:document.querySelector('#molecule-info').classList.contains('hidden'),
    sceneHidden:document.querySelector('.scene-card').classList.contains('hidden'),
    buildActive:document.querySelector('.mode-bar button[data-mode="build"]').classList.contains('active'),
    transportVisible:document.querySelector('#designer-story-dock').getBoundingClientRect().height > 0,
    transportTop:document.querySelector('#designer-story-dock').getBoundingClientRect().top,
    transportBottom:document.querySelector('#designer-story-dock').getBoundingClientRect().bottom,
    transportPosition:getComputedStyle(document.querySelector('#designer-story-dock')).position,
    modeLabels:[...document.querySelectorAll('.mode-bar button')]
      .map((button) => button.textContent.trim()),
  })`);
  assert.match(initial.url, /\?story=sos1-hit-to-bay293$/);
  assert.match(initial.play, /Play story/);
  assert.match(initial.status, /ready on a blank canvas/i);
  assert.equal(initial.moleculeHidden, true);
  assert.equal(initial.sceneHidden, true);
  assert.equal(initial.buildActive, true);
  assert.equal(initial.transportVisible, true);
  assert.equal(initial.transportPosition, 'relative');
  assert.deepEqual(initial.modeLabels, ['View', 'Design', 'Simulate']);
  const anchoredTransport = await browser.evaluate(`(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const dock = document.querySelector('#designer-story-dock');
    const buildDisclosure = document.querySelector('#build-left-panel > .generated-card-heading');
    buildDisclosure.click(); await frame();
    const collapsedTop = dock.getBoundingClientRect().top;
    buildDisclosure.click(); await frame();
    const toolStack = document.querySelector('#left-panel-scroll-stack');
    toolStack.scrollTop = 300; await frame();
    const scrolledTop = dock.getBoundingClientRect().top;
    const toolStackTop = toolStack.getBoundingClientRect().top;
    toolStack.scrollTop = 0; await frame();
    document.querySelector('.mode-bar button[data-mode="view"]').click(); await frame();
    const viewTop = dock.getBoundingClientRect().top;
    const viewVisible = dock.getBoundingClientRect().height > 0;
    document.querySelector('.mode-bar button[data-mode="build"]').click(); await frame();
    return { collapsedTop, scrolledTop, toolStackTop, viewTop, viewVisible,
      buildTop:dock.getBoundingClientRect().top };
  })()`);
  assert.ok(Math.abs(anchoredTransport.collapsedTop - initial.transportTop) < 1);
  assert.ok(Math.abs(anchoredTransport.scrolledTop - initial.transportTop) < 1);
  assert.ok(anchoredTransport.toolStackTop >= initial.transportBottom - 1,
    'the scrolling tool stack must begin below the fixed story dock');
  assert.ok(Math.abs(anchoredTransport.viewTop - initial.transportTop) < 1);
  assert.ok(Math.abs(anchoredTransport.buildTop - initial.transportTop) < 1);
  assert.equal(anchoredTransport.viewVisible, true);

  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#replay-designer-moves').textContent.includes('Pause')`),
  90000, 'story play control');
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-status').textContent.startsWith('Move 3 of 49')`),
  90000, 'preparation demo cue');
  const preparationCue = await browser.evaluate(`({
    demoActive:document.body.classList.contains('designer-move-demo-active'),
    prepareHighlighted:document.querySelector('#prepare-pdb').classList.contains('designer-move-cue'),
    highlightColor:getComputedStyle(document.querySelector('#prepare-pdb')).outlineColor,
    loadCardMinimized:document.querySelector('.load-card').classList.contains('designer-move-demo-minimized'),
    transportOnly:document.querySelector('#designer-story-dock').classList.contains('designer-move-demo-transport-only'),
    transportTop:document.querySelector('#designer-story-dock').getBoundingClientRect().top,
    infoMinimized:document.querySelector('#molecule-info').classList.contains('designer-move-demo-minimized'),
  })`);
  assert.equal(preparationCue.demoActive, true);
  assert.equal(preparationCue.prepareHighlighted, true);
  assert.equal(preparationCue.highlightColor, 'rgb(220, 38, 38)');
  assert.equal(preparationCue.loadCardMinimized, false);
  assert.equal(preparationCue.transportOnly, true);
  assert.ok(Math.abs(preparationCue.transportTop - initial.transportTop) < 1);
  assert.equal(preparationCue.infoMinimized, true);
  await waitFor(async () => browser.evaluate(
    `Number(document.querySelector('#designer-move-progress-label').textContent.split('/')[0]) >= 5`),
  90000, 'responsive prepared-pocket transition');
  const preparedPocket = await browser.evaluate(`(() => {
    const displayAction = window.MolariumChemistActions.history()
      .find((entry) => entry.action === 'view.setDisplay');
    return {
      representation:document.querySelector('#representation-select').value,
      hydrogens:document.querySelector('#hydrogen-toggle').checked,
      pocketAtoms:document.querySelector('#pocket-toggle').checked,
      displayDurationMs:displayAction?.durationMs ?? null,
      ligandZoomed:[...document.querySelectorAll('#component-list button')]
        .some((button) => button.textContent === 'Zoomed'),
    };
  })()`);
  assert.equal(preparedPocket.representation, 'cartoon');
  assert.equal(preparedPocket.hydrogens, false);
  assert.equal(preparedPocket.pocketAtoms, true);
  assert.equal(preparedPocket.ligandZoomed, true);
  assert.ok(preparedPocket.displayDurationMs < 5000,
    `prepared-pocket display action took ${preparedPocket.displayDurationMs} ms`);
  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#replay-designer-moves').textContent.includes('Continue')`),
  90000, 'story pause control');
  const paused = await browser.evaluate(`({
    progress:document.querySelector('#designer-move-progress-label').textContent,
    caption:document.querySelector('#designer-move-caption').textContent,
    detail:document.querySelector('#designer-move-detail').textContent,
    captionFontSize:parseFloat(getComputedStyle(document.querySelector('#designer-move-caption')).fontSize),
  })`);
  assert.match(paused.progress, /^\d+ \/ 49$/);
  assert.ok(paused.caption.length > 12, 'the central caption must explain the scientific story');
  assert.match(paused.detail, /Paused before move|Pause requested/);
  assert.ok(paused.captionFontSize >= 12, 'the central story caption must remain legible');
  await waitFor(async () => browser.evaluate(
    `!document.querySelector('#previous-designer-move').disabled`),
  90000, 'paused previous-step control');
  const beforeNavigation = await browser.evaluate(`({
    progress:document.querySelector('#designer-move-progress-label').textContent,
    auditCount:window.MolariumChemistActions.history().length,
    canvas:document.querySelector('#molecule-canvas').toDataURL(),
  })`);
  const pausedIndex = Number(beforeNavigation.progress.split('/')[0]);
  await browser.evaluate(`document.querySelector('#previous-designer-move').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-progress-label').textContent.startsWith('${pausedIndex - 1} /')`),
  30000, 'previous cached story checkpoint');
  const previous = await browser.evaluate(`({
    caption:document.querySelector('#designer-move-caption').textContent,
    detail:document.querySelector('#designer-move-detail').textContent,
    nextEnabled:!document.querySelector('#next-designer-move').disabled,
    auditCount:window.MolariumChemistActions.history().length,
  })`);
  assert.ok(previous.caption.length > 12);
  assert.match(previous.detail, /Reviewing/);
  assert.equal(previous.nextEnabled, true);
  assert.equal(previous.auditCount, beforeNavigation.auditCount,
    'presentation rewind must not execute or delete an Agent/API action');
  await browser.evaluate(`document.querySelector('#next-designer-move').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-progress-label').textContent.startsWith('${pausedIndex} /')`),
  30000, 'next cached story checkpoint');
  const afterNavigation = await browser.evaluate(`({
    auditCount:window.MolariumChemistActions.history().length,
    canvas:document.querySelector('#molecule-canvas').toDataURL(),
  })`);
  assert.equal(afterNavigation.auditCount, beforeNavigation.auditCount);
  assert.equal(afterNavigation.canvas, beforeNavigation.canvas,
    'forward checkpoint restoration must recover the exact paused molecular view');

  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(
    `Number(document.querySelector('#designer-move-progress-label').textContent.split('/')[0]) >= 10
      && window.MolariumChemistActions.history().some((entry) =>
        entry.action === 'pose.refine' && entry.status === 'completed')`),
  120000, 'first 64-chain pose result');
  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(
    `!document.querySelector('#previous-designer-move').disabled`),
  120000, 'paused pose-result checkpoint');
  const poseCheckpoint = await browser.evaluate(`({
    progress:document.querySelector('#designer-move-progress-label').textContent,
    auditCount:window.MolariumChemistActions.history().length,
    poseSummary:document.querySelector('#docking-result-summary').textContent,
    canvas:document.querySelector('#molecule-canvas').toDataURL(),
  })`);
  const poseIndex = Number(poseCheckpoint.progress.split('/')[0]);
  assert.ok(poseIndex >= 10);
  assert.match(poseCheckpoint.poseSummary, /distinct/);
  await browser.evaluate(`document.querySelector('#previous-designer-move').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-progress-label').textContent.startsWith('${poseIndex - 1} /')`),
  30000, 'checkpoint before pose result');
  await browser.evaluate(`document.querySelector('#next-designer-move').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-progress-label').textContent.startsWith('${poseIndex} /')`),
  30000, 'restored pose-result checkpoint');
  const restoredPoseCheckpoint = await browser.evaluate(`({
    auditCount:window.MolariumChemistActions.history().length,
    poseSummary:document.querySelector('#docking-result-summary').textContent,
    canvas:document.querySelector('#molecule-canvas').toDataURL(),
  })`);
  assert.equal(restoredPoseCheckpoint.auditCount, poseCheckpoint.auditCount);
  assert.equal(restoredPoseCheckpoint.poseSummary, poseCheckpoint.poseSummary);
  assert.equal(restoredPoseCheckpoint.canvas, poseCheckpoint.canvas,
    'pose-result checkpoint navigation must restore the exact ranked molecular view');

  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(
    `Number(document.querySelector('#designer-move-progress-label').textContent.split('/')[0]) >= 12`),
  120000, 'fixed-camera pose comparison');
  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(
    `!document.querySelector('#previous-designer-move').disabled`),
  120000, 'paused fixed-camera comparison');
  const fixedComparison = await browser.evaluate(`(() => {
    const record = window.MolariumChemistActions.history()
      .filter((entry) => entry.action === 'view.highlightAtoms').at(-1);
    return {
      progress:document.querySelector('#designer-move-progress-label').textContent,
      caption:document.querySelector('#designer-move-caption').textContent,
      cameraPreserved:record?.result?.highlightedAtoms?.cameraPreserved,
      displayContextPreserved:record?.result?.highlightedAtoms?.displayContextPreserved,
    };
  })()`);
  assert.ok(Number(fixedComparison.progress.split('/')[0]) >= 12);
  assert.match(fixedComparison.caption, /pyrazole.*Phe890.*Lys898/i);
  assert.equal(fixedComparison.cameraPreserved, true);
  assert.equal(fixedComparison.displayContextPreserved, true);
  console.log('Designer story link browser test passed: permalink, blank start, fixed transport, play/pause, audited navigation, and fixed-camera pose comparison');
} finally {
  await browser.close();
}
