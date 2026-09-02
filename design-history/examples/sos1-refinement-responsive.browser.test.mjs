import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const root = resolve(import.meta.dirname, '../..');
const browser = await startMolariumBrowser({ root, appPath:'?responsive-pose-test=1',
  width:1600, height:1000 });
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const execute = (action, args, requestId) => browser.evaluate(
  `window.MolariumChemistActions.execute(${JSON.stringify({ action, args, requestId })})`);
const responsivenessProbe = async (timeoutMs = 2500) => Promise.race([
  browser.evaluate(`({
    status:document.querySelector('#docking-status')?.textContent || '',
    button:document.querySelector('#run-constrained-docking')?.textContent || '',
    now:performance.now(),
  })`),
  delay(timeoutMs).then(() => null),
]);

try {
  await waitFor(async () => browser.evaluate(`Boolean(window.MolariumChemistActions)`),
    90000, 'Chemist Actions API');
  await execute('designRoute.load', { routeId:'sos1-hit-only' }, 'responsive-load');
  await execute('view.setMode', { mode:'build' }, 'responsive-build');
  await execute('protein.prepare', {
    gapPolicy:'cap', histidine:'auto', ligandPolicy:'ccd', pH:7.4,
    repairMissingHeavy:true, waterPolicy:'retain',
  }, 'responsive-prepare');
  await execute('pose.captureReference', { mode:'propagate' }, 'responsive-capture');
  await execute('designRoute.applyStep', { stepId:'scaffold-rewrite' }, 'responsive-rewrite');

  await browser.evaluate(`{
    window.__molariumResponsiveRefinement = window.MolariumChemistActions.execute({
      action:'pose.refine', args:{ searchChains:16 }, requestId:'responsive-refine'
    });
    true;
  }`, { awaitPromise:false });

  let active = null;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    active = await responsivenessProbe();
    assert.ok(active, 'Chrome stopped servicing JavaScript while pose refinement was active');
    if (/contact capture|contact polish|physical refinement/.test(active.status)) break;
    await delay(100);
  }
  assert.ok(active && /Refining pose \d+\/16/.test(active.status),
    `refinement progress did not become visible: ${active?.status || 'no status'}`);
  assert.match(active.status, /\d+-worker ensemble/,
    'pose propagation did not enter the parallel worker ensemble');
  assert.match(active.button, /Refining/);
  await delay(250);
  const followUp = await responsivenessProbe();
  assert.ok(followUp, 'Chrome stopped servicing a follow-up interaction during pose refinement');
  assert.ok(followUp.now > active.now);
  console.log('SOS1 refinement browser test passed: progress paints and Chrome remains responsive');
} finally {
  await browser.close();
}
