import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readBlankInterfaceSnapshot, verifyBlankInterfaceSnapshot,
  verifyMovieViewport } from './designer-movie-presentation.mjs';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';
import { verifyBrowserLocalLabCapture } from './local-lab-capture.mjs';

const viewport = verifyMovieViewport({ width:1280, height:800, deviceScaleFactor:1 });
const browser = await startMolariumBrowser({ root:resolve(import.meta.dirname, '..'),
  appPath:'index.html?blank=1&designer-moves-movie=1', width:viewport.width,
  height:viewport.height, localOnly:true });

try {
  await waitFor(async () => browser.evaluate(`document.readyState === 'complete'
    && Boolean(window.MolariumChemistActionsReady)`), 30000, 'blank Molarium interface');
  const localLab = await verifyBrowserLocalLabCapture(browser);
  await browser.evaluate(`document.querySelector('.mode-bar button[data-mode="build"]').click()`);
  const snapshot = verifyBlankInterfaceSnapshot(await readBlankInterfaceSnapshot(browser));
  assert.equal(localLab.badgeText, 'Local Lab · network locked');
  assert.equal(snapshot.verified, true);
  console.log('Designer movie entry browser test: blank full UI and Local Lab PASS');
} finally {
  await browser.close();
}
