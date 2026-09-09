import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';

const browser = await startMolariumBrowser({ root:resolve(import.meta.dirname, '..'), appPath:'?blank=1' });
try {
  await waitFor(() => browser.evaluate('Boolean(window.MolariumChemistActionsReady)'), 60000, 'API');
  await browser.evaluate('window.MolariumChemistActionsReady.then(() => true)');
  const execute = (action, args) => browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({action,args})})`);
  await execute('session.loadStructure', { format:'pdb', polish:false, content:
    'ATOM      1  CA  ALA A   1       0.000   0.000   0.000  1.00 20.00           C\nEND\n' });
  const before = (await execute('session.inspect', { scope:'all', includeCoordinates:true })).result;
  for (const method of ['webgpu','openmm','stormm','rdkit','ani2x']) {
    await assert.rejects(execute('calculation.run', { method, job:method === 'stormm' ? 'dynamics' : 'energy',
      options:{ stormmSystem:'current' } }), /Please prepare protein/);
  }
  await execute('view.setMode', { mode:'run' });
  await browser.evaluate(`document.querySelector('#method-select').value = 'webgpu';
    document.querySelector('#job-select').value = 'dynamics';
    document.querySelector('#run-calculation').click();`);
  await waitFor(() => browser.evaluate(`document.querySelector('#notice').textContent === 'Please prepare protein'`),
    10000, 'plain preparation notice');
  assert.equal(await browser.evaluate(`document.querySelector('#run-overlay').classList.contains('hidden')`), true);
  assert.equal(await browser.evaluate(`document.querySelector('#run-calculation').disabled`), false,
    'this patch deliberately leaves button greying to a later UI change');
  const after = (await execute('session.inspect', { scope:'all', includeCoordinates:true })).result;
  assert.deepEqual(after.atoms, before.atoms);
  assert.deepEqual(after.bonds, before.bonds);
  // Ordinary small molecules do not require the protein preparation workflow.
  await execute('session.loadStructure', { format:'smiles', content:'C', polish:false });
  const methane = await execute('calculation.run', { method:'rdkit', job:'energy' });
  assert.equal(methane.status, 'completed');
  // Prepared protein examples keep their existing numeric System path.
  await execute('session.loadFixture', { fixtureId:'trp-cage' });
  const protein = await execute('calculation.run', { method:'openmm', job:'energy' });
  assert.equal(protein.status, 'completed');
  console.log('Unprepared protein: five engines reject early; UI notice exact; no motion/overlay; small molecule and prepared protein pass');
} finally { await browser.close(); }
