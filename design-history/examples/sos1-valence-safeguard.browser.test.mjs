import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const root = resolve(import.meta.dirname, '../..');
const script = JSON.parse(await readFile(resolve(import.meta.dirname,
  'sos1-growth-clash-v7.selected-route.action-script.json'), 'utf8'));
const browser = await startMolariumBrowser({ root, appPath:'?story=sos1-hit-to-bay293',
  width:1600, height:1000 });
const execute = (action, args, requestId) => browser.evaluate(
  `window.MolariumChemistActions.execute(${JSON.stringify({ action, args, requestId })})`);

try {
  await waitFor(async () => browser.evaluate(`Boolean(window.MolariumChemistActions)`),
    90000, 'Chemist Actions API');
  for (const [index, step] of script.actions.slice(0, 16).entries()) {
    const actionResult = await execute(step.action, step.args || {}, `geometry-gate-${index + 1}`);
    const inspected = await execute('session.inspect', {
      scope:'ligand', includeCoordinates:true, maximumAtoms:500,
    }, `geometry-inspect-${index + 1}`);
    const result = inspected.result;
    const atoms = new Map(result.atoms.map((atom) => [atom.atomId, atom]));
    const lengths = result.bonds.map((bond) => {
      const a = atoms.get(bond.atomIds[0]), b = atoms.get(bond.atomIds[1]);
      const length = Math.hypot(...a.coordinatesAngstrom.map((value, axis) =>
        value - b.coordinatesAngstrom[axis]));
      return { length, bond, a, b };
    }).sort((a, b) => b.length - a.length);
    const heavy = lengths.filter(({ a, b }) => a.element !== 'H' && b.element !== 'H');
    const worst = heavy[0];
    const stretched = heavy.filter((entry) => entry.length > 1.9)
      .map((entry) => ({ length:Number(entry.length.toFixed(3)),
        atoms:[entry.a.atomName || entry.a.atomId, entry.b.atomName || entry.b.atomId] }));
    assert.deepEqual(stretched, [], `move ${index + 1} stretched ligand bonds: ${JSON.stringify(stretched)}`);
    if (index === 15) {
      assert.equal(actionResult.result.optimization.accepted, false);
      assert.ok(actionResult.result.optimization.valenceSafeguard.violations
        .some((entry) => entry.atomNames.includes('CX9') && entry.atomNames.includes('CX10')));
      assert.ok(worst.length < 1.9);
    }
  }
  console.log('SOS1 valence safeguard browser test passed: distorted fragment-merge relaxation rejected and restored');
} finally {
  await browser.close();
}
