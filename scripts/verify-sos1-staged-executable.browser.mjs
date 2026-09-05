#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionScriptSha256 } from '../design-history/replay.mjs';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';
import { sha256 } from './sos1-aww-receptor-only-publication.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [publicationArg, outputArg] = process.argv.slice(2);
assert(publicationArg && outputArg, 'Expected publication directory and new output directory');
const declaration = JSON.parse(await readFile(resolve(root, publicationArg, 'declaration.json')));
const descriptor = declaration.executableReplay;
const bytes = await readFile(resolve(root, descriptor.path));
assert.equal(sha256(bytes), descriptor.sha256);
const script = JSON.parse(bytes);
assert.equal(await actionScriptSha256(script), descriptor.actionScriptSha256);
const output = resolve(root, outputArg);
await mkdir(output);
let browser;
const save = async (name, value) => writeFile(join(output, name),
  Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`, { flag:'wx' });
await save('boundary.json', { executableSha256:descriptor.sha256,
  actionScriptSha256:descriptor.actionScriptSha256, actionCount:script.actions.length,
  mechanism:'native replayActionScript and public MolariumChemistActions.execute',
  purpose:'test the staged executable from a blank canvas; not a replacement for its frozen science' });
try {
  browser = await startMolariumBrowser({ root, appPath:'?blank=1', width:1600, height:1000 });
  await waitFor(() => browser.evaluate('Boolean(window.MolariumChemistActionsReady)'), 90000, 'API');
  await browser.evaluate('window.MolariumChemistActionsReady.then(() => true)');
  await browser.evaluate(`(async () => {
    window.sos1ExecutableCheck = { status:'running', completed:0 };
    try {
      const { replayActionScript } = await import('./design-history/replay.mjs');
      const result = await replayActionScript(window.MolariumChemistActions,
        ${JSON.stringify(script)});
      window.sos1ExecutableCheck = { status:result.status, result };
    } catch (error) { window.sos1ExecutableCheck = { status:'failed', error:String(error.stack || error) }; }
  })()`, { awaitPromise:false });
  let previous = -1;
  await waitFor(async () => {
    const progress = await browser.evaluate(`({ status:window.sos1ExecutableCheck?.status,
      actions:window.MolariumChemistActions.history().filter((entry) =>
        entry.status === 'completed').length,
      last:window.MolariumChemistActions.history().at(-1)?.action })`);
    if (progress.actions !== previous) {
      previous = progress.actions;
      console.log(`EXECUTABLE ${JSON.stringify(progress)}`);
    }
    return progress.status && progress.status !== 'running';
  }, 1800000, 'complete native executable replay');
  const result = await browser.evaluate('window.sos1ExecutableCheck');
  await save('replay-result.json', result);
  const audit = await browser.evaluate('window.MolariumChemistActions.history()');
  await save('chemist-action-audit.json', { records:audit });
  await save('terminal.png', await browser.capturePng());
  assert.equal(result.status, 'completed', 'Staged executable failed; inspect replay-result.json');
  for (const [scope, maximumAtoms] of [['ligand',256], ['pocket',500]]) {
    const inspection = await browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({
      action:'session.inspect', args:{ scope, includeCoordinates:true, maximumAtoms },
    })})`);
    await save(`${scope}.json`, inspection.result);
  }
  console.log(`EXECUTABLE PASSED ${script.actions.length} public actions`);
} catch (error) {
  await save('failed-check.json', { error:String(error.stack || error) });
  throw error;
} finally { await browser?.close(); }
