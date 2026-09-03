import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const root = resolve(import.meta.dir, '../..');
const browser = await startMolariumBrowser({ root,
  appPath:'design-history/viewer/?story=molarium-7kpa-rehearsal&cue=0&render=1',
  width:1440, height:900 });

try {
  await waitFor(async () => browser.evaluate(
    `['1','error'].includes(document.body.dataset.ready || '')`),
  30000, 'campaign viewer initialization');
  const readiness = await browser.evaluate(`(() => ({ ready:document.body.dataset.ready,
    depiction:document.body.dataset.depictionReady,
    fatal:document.querySelector('#fatal')?.textContent }))()`);
  if (readiness.ready !== '1') throw new Error(`Viewer initialization failed: ${JSON.stringify(readiness)}`);
  await waitFor(async () => browser.evaluate(
    `document.body.dataset.depictionReady && document.body.dataset.depictionReady !== 'pending'`),
  30000, 'local molecule depiction');
  const initial = await browser.evaluate(`(() => ({
    api:window.__molariumDesignHistory,
    title:document.querySelector('#campaign-title')?.textContent,
    cue:document.body.dataset.cue,
    depiction:document.body.dataset.depictionReady,
    graphNodes:document.querySelectorAll('.graph-node').length,
    timelineEvents:document.querySelectorAll('.timeline-event').length,
    activeGraphNodes:document.querySelectorAll('.graph-node.active').length,
    svg:Boolean(document.querySelector('#depiction svg')),
    fatal:document.querySelector('#fatal')?.hidden,
  }))()`);
  if (!initial.api || initial.api.storyId !== 'molarium-7kpa-rehearsal')
    throw new Error(`Wrong story loaded: ${JSON.stringify(initial)}`);
  if (initial.fatal !== true || initial.cue !== '0' || initial.graphNodes !== 4
      || initial.timelineEvents < 8 || initial.activeGraphNodes !== 1 || !initial.svg)
    throw new Error(`Incomplete initial viewer: ${JSON.stringify(initial)}`);
  const layout = await browser.evaluate(`(() => {
    const stage = document.querySelector('.molecule-stage')?.getBoundingClientRect();
    const graph = document.querySelector('.graph-panel')?.getBoundingClientRect();
    const logo = document.querySelector('.brand img');
    return { stageWidth:stage?.width, stageHeight:stage?.height, graphHeight:graph?.height,
      logoLoaded:Boolean(logo?.complete && logo?.naturalWidth),
      fatalDisplay:getComputedStyle(document.querySelector('#fatal')).display,
      centerElement:document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.id ||
        document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.className };
  })()`);
  if (layout.stageWidth < 500 || layout.stageHeight < 300 || layout.graphHeight < 150
      || !layout.logoLoaded || layout.fatalDisplay !== 'none' || layout.centerElement === 'fatal')
    throw new Error(`Viewer layout did not paint: ${JSON.stringify(layout)}`);

  await browser.evaluate(`window.__molariumDesignHistory.selectCue(2)`);
  await waitFor(async () => browser.evaluate(
    `document.body.dataset.cue === '2' && document.body.dataset.depictionReady !== 'pending'`),
  30000, 'second rendered cue');
  await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const moved = await browser.evaluate(`(() => ({
    cue:document.body.dataset.cue,
    snapshot:document.querySelector('#snapshot-title')?.textContent,
    placeholder:Boolean(document.querySelector('#depiction .depiction-placeholder')),
    activeGraphNodes:document.querySelectorAll('.graph-node.active').length,
    integrity:document.querySelector('#integrity-label')?.textContent,
  }))()`);
  if (moved.cue !== '2' || !moved.placeholder || moved.activeGraphNodes !== 1
      || !moved.integrity?.startsWith('Verified'))
    throw new Error(`Cue navigation or local depiction failed: ${JSON.stringify(moved)}`);
  console.log(`design-history browser test passed: ${initial.graphNodes} commits, ${initial.timelineEvents} labbook events, local SVG depiction`);
} finally {
  await browser.close();
}
