import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const root = resolve(import.meta.dirname, '../..');
const browser = await startMolariumBrowser({
  root,
  appPath:'sos1-hit-to-bay293',
  width:1600,
  height:1000,
});

try {
  await waitFor(async () => browser.evaluate(`document.title === 'SOS1 hit to BAY-293 · Molarium'
    && document.querySelector('#designer-move-progress-label')?.textContent === '0 / 48'
    && !document.querySelector('#replay-designer-moves')?.disabled`), 90000, 'deep-linked story');
  const initial = await browser.evaluate(`({
    url:location.href,
    play:document.querySelector('#replay-designer-moves').textContent,
    status:document.querySelector('#designer-move-status').textContent,
    moleculeHidden:document.querySelector('#molecule-info').classList.contains('hidden'),
    sceneHidden:document.querySelector('.scene-card').classList.contains('hidden'),
    buildActive:document.querySelector('.mode-bar button[data-mode="build"]').classList.contains('active'),
    transportVisible:!document.querySelector('#build-left-panel').classList.contains('hidden'),
  })`);
  assert.match(initial.url, /\?story=sos1-hit-to-bay293$/);
  assert.match(initial.play, /Play story/);
  assert.match(initial.status, /ready on a blank canvas/i);
  assert.equal(initial.moleculeHidden, true);
  assert.equal(initial.sceneHidden, true);
  assert.equal(initial.buildActive, true);
  assert.equal(initial.transportVisible, true);

  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#replay-designer-moves').textContent.includes('Pause')`),
  90000, 'story play control');
  await browser.evaluate(`document.querySelector('#replay-designer-moves').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#replay-designer-moves').textContent.includes('Continue')`),
  90000, 'story pause control');
  const paused = await browser.evaluate(`({
    progress:document.querySelector('#designer-move-progress-label').textContent,
    caption:document.querySelector('#designer-move-caption').textContent,
  })`);
  assert.match(paused.progress, /^\d+ \/ 48$/);
  assert.match(paused.caption, /Paused before move/);
  console.log('Designer story link browser test passed: permalink, blank start, play, and pause');
} finally {
  await browser.close();
}
