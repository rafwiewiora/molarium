import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { startMolariumBrowser, waitFor } from '../scripts/headless-chrome.mjs';

const browser = await startMolariumBrowser({ root:resolve(import.meta.dirname, '..'),
  appPath:'?blank=1', width:1280, height:900 });
try {
  await waitFor(() => browser.evaluate('Boolean(window.MolariumChemistActionsReady)'), 30000, 'app');
  await browser.evaluate(`document.querySelector('[data-project-panel="validation"]').click()`);
  await waitFor(() => browser.evaluate(`document.querySelector('#validation-dashboard').dataset.validationMounted === 'true'`), 15000, 'numerical dashboard');
  const result = await browser.evaluate(`(() => {
    const root = document.querySelector('#validation-dashboard');
    return { title:document.querySelector('#project-info-title').textContent,
      text:root.textContent, rows:root.querySelectorAll('[data-validation-comparison]').length,
      artifacts:[...root.querySelectorAll('a[download]')].map(a => a.getAttribute('href')),
      dockingRows:root.querySelectorAll('[data-validation-tier], [data-validation-count]').length };
  })()`);
  assert.equal(result.title, 'Numerical validation');
  assert.equal(result.rows, 3);
  assert.equal(result.dockingRows, 0);
  assert.doesNotMatch(result.text, /Pose benchmark|Best-of-5|crystal-scored/);
  assert.match(result.text, /not docking pose accuracy/);
  for (const path of result.artifacts) {
    const response = await fetch(new URL(path, browser.appUrl));
    assert(response.ok, `evidence artifact must be served: ${path}`);
    await response.json();
  }
  if (process.env.MOLARIUM_VALIDATION_SCREENSHOT)
    await writeFile(process.env.MOLARIUM_VALIDATION_SCREENSHOT, await browser.capturePng());
  console.log('Numerical validation dashboard browser: PASS');
} finally { await browser.close(); }
