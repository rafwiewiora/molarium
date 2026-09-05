import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const root = resolve(import.meta.dirname, '../..');
const browser = await startMolariumBrowser({ root, appPath:'sos1-hit-to-bay293',
  width:1400, height:900 });

const assertAxeDepiction = (depiction, label) => {
  assert.equal(depiction.label, 'AXE ligand', label);
  assert.equal(depiction.heavyAtomCount, 27, label);
  assert.equal(depiction.bondCount, 30, label);
  assert.equal(depiction.svgHeavyAtomCoverageCount, 27,
    `${label}: SVG must cover every registered heavy atom`);
  assert.equal(depiction.svgBondCoverageCount, 30,
    `${label}: SVG must cover every registered bond`);
  assert.equal(depiction.hasSvg, true, label);
  assert.equal(depiction.error, null, label);
  assert.equal(depiction.pinnedLigand?.residueName, 'AXE', label);
};

try {
  await waitFor(async () => browser.evaluate(`Boolean(window.molariumTest)
    && !document.querySelector('#replay-designer-moves')?.disabled`),
  90000, 'registered Designer Moves story');
  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  try {
    await waitFor(async () => browser.evaluate(`
      /^1 \/ \\d+$/.test(document.querySelector('#designer-move-progress-label').textContent.trim())
        && window.MolariumChemistActions.history().some((entry) =>
          entry.action === 'designRoute.load' && entry.status === 'completed')`),
    90000, 'move 1 registered hit');
  } catch (error) {
    const state = await browser.evaluate(`({
      progress:document.querySelector('#designer-move-progress-label').textContent,
      button:document.querySelector('#replay-designer-moves').textContent,
      notice:document.querySelector('#notice')?.textContent || '',
      actions:window.MolariumChemistActions.history().slice(-6).map((entry) =>
        ({ action:entry.action, status:entry.status, error:entry.error || null }))
    })`);
    throw new Error(`${error.message}: ${JSON.stringify(state)}`);
  }
  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#replay-designer-moves').textContent.includes('Continue')`),
  30000, 'pause after move 1');
  assertAxeDepiction(await browser.evaluate(`window.molariumTest.waitFor2DDepiction()`),
    'move 1 must show the complete registered AXE graph');

  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(`
    Number(document.querySelector('#designer-move-progress-label').textContent.split('/')[0]) >= 5
      && Boolean(window.molariumTest.current().molecule.parameterization)`),
  120000, 'prepared AXE pocket');
  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#replay-designer-moves').textContent.includes('Continue')
      && !document.querySelector('#previous-designer-move').disabled`),
  30000, 'pause after preparation');
  const prepared = await browser.evaluate(`window.molariumTest.waitFor2DDepiction()`);
  assertAxeDepiction(prepared, 'preparation must retain the AXE graph and active-ligand pin');

  const frontier = await browser.evaluate(`Number(
    document.querySelector('#designer-move-progress-label').textContent.split('/')[0])`);
  await browser.evaluate(`document.querySelector('#previous-designer-move').click()`);
  await waitFor(async () => browser.evaluate(`
    document.querySelector('#designer-move-progress-label').textContent.startsWith('${frontier - 1} /')`),
  30000, 'previous prepared checkpoint');
  assertAxeDepiction(await browser.evaluate(`window.molariumTest.waitFor2DDepiction()`),
    'checkpoint review must keep 2D pinned to the active AXE design ligand');
  console.log('Registered AXE replay/checkpoint 2D regression: PASS');
} finally {
  await browser.close();
}
