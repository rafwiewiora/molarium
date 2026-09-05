#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [reviewArg, outputArg] = process.argv.slice(2);
assert(reviewArg && outputArg, 'Usage: bun scripts/capture-sos1-placement-review.browser.mjs <review-directory> <new-output>');
const review = resolve(reviewArg), output = resolve(outputArg);
const data = JSON.parse(await readFile(join(review, 'data.json')));
await mkdir(output);
const browser = await startMolariumBrowser({ root, appPath:`${relative(root, review)}/`, width:1500, height:1000 });
try {
  await waitFor(async () => browser.evaluate("document.body.dataset.ready === 'error' || document.body.dataset.ready === '1' && document.body.dataset.renderReady === '1'"),
    90000, 'placement review');
  const state = await browser.evaluate("({ready:document.body.dataset.ready,error:document.querySelector('#error')?.textContent})");
  assert.equal(state.ready, '1', `Review page failed: ${state.error}`);
  await browser.evaluate("document.querySelector('#protein').click()");
  await waitFor(async () => browser.evaluate("document.body.dataset.renderReady === '1'"), 30000, 'pocket-only view');
  for (const ligand of data.ligands) {
    await browser.evaluate(`setLigands((entry) => entry.id === ${JSON.stringify(ligand.id)})`);
    await waitFor(async () => browser.evaluate(`document.body.dataset.renderReady === '1'
      && document.body.dataset.visibleLigands === ${JSON.stringify(ligand.id)}`), 30000, ligand.id);
    await writeFile(join(output, `${ligand.id}.png`), await browser.capturePng(), { flag:'wx' });
  }
  console.log(output);
} catch (error) {
  try {
    const state = await browser.evaluate("({url:location.href,ready:document.body.dataset.ready,renderReady:document.body.dataset.renderReady,error:document.querySelector('#error')?.textContent,text:document.body.innerText.slice(0,3000)})");
    console.error(JSON.stringify(state));
    await writeFile(join(output, 'failure-state.json'), JSON.stringify(state, null, 2), { flag:'wx' });
    await writeFile(join(output, 'failure.png'), await browser.capturePng(), { flag:'wx' });
  } catch { /* Preserve the initial capture failure. */ }
  throw error;
} finally { await browser.close(); }
