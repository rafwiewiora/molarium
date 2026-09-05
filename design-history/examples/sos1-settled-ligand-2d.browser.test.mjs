import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const root = resolve(import.meta.dirname, '../..');
const browser = await startMolariumBrowser({ root,
  appPath:'?blank=1', width:1280, height:800, localOnly:true });
const execute = async (action, args, requestId) => {
  const envelope = await browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({
    action, args, requestId,
  })})`);
  if (envelope.status !== 'completed') throw new Error(`${action}: ${envelope.error}`);
  return envelope.result;
};
const complete2D = async (expectedResidueName, expectedHeavyAtoms) => {
  const depiction = await browser.evaluate(`window.molariumTest.waitFor2DDepiction(30000)`);
  const ligand = await execute('session.inspect', {
    scope:'ligand', includeCoordinates:false, maximumAtoms:100,
  }, `inspect-${expectedResidueName.toLowerCase()}`);
  const heavyIds = new Set(ligand.atoms.filter((atom) => atom.element !== 'H')
    .map((atom) => atom.atomId));
  const heavyBonds = ligand.bonds.filter((bond) =>
    bond.atomIds.every((atomId) => heavyIds.has(atomId))).length;
  assert.equal(depiction.error, null);
  assert.equal(depiction.hasSvg, true);
  assert.match(depiction.sanitization,
    /^(strict RDKit sanitization|provenance-bounded graph; strict parse with drawing-only fallback)$/);
  assert.match(depiction.label, new RegExp(`\\b${expectedResidueName}\\b`));
  assert.ok(depiction.componentId.endsWith(`:${expectedResidueName}`));
  assert.equal(depiction.heavyAtomCount, expectedHeavyAtoms);
  assert.equal(depiction.atomIndices.length, expectedHeavyAtoms);
  assert.equal(depiction.bondCount, heavyBonds);
  assert.ok(depiction.atomClasses >= expectedHeavyAtoms);
  return { expectedResidueName, expectedHeavyAtoms, heavyBonds,
    sanitization:depiction.sanitization };
};

try {
  await waitFor(async () => browser.evaluate(`Boolean(window.MolariumChemistActionsReady)
    && Boolean(window.molariumTest)`), 30000, 'Molarium APIs');
  await execute('designRoute.load', { routeId:'sos1-hit-only' }, 'load-registered-hit');
  const evidence = [await complete2D('AXE', 27)];

  for (const [stepId, residueName, heavyAtoms] of [
    ['scaffold-rewrite', 'AWT', 29],
    ['fragment-merge', 'AWZ', 31],
    ['open-phe890-pocket', 'AWW', 31],
    ['finish-bay-293', 'AXH', 32],
  ]) {
    const relativePath = `design-history/publications/sos1/checkpoints/${stepId}-campaign.json`;
    const bytes = await readFile(resolve(root, relativePath));
    await execute('campaign.import', { sourcePath:`./${relativePath}`,
      sourceSha256:createHash('sha256').update(bytes).digest('hex'),
      preserveView:stepId !== 'scaffold-rewrite' }, `import-${stepId}`);
    evidence.push(await complete2D(residueName, heavyAtoms));
  }
  assert.deepEqual(evidence.map((entry) => entry.expectedResidueName),
    ['AXE','AWT','AWZ','AWW','AXH']);
  assert.equal(evidence[0].sanitization, 'strict RDKit sanitization');
  assert.ok(evidence.slice(1).every((entry) => entry.sanitization ===
    'provenance-bounded graph; strict parse with drawing-only fallback'));
  console.log('SOS1 settled-state 2D browser QA: executable hit + all exact review ligands PASS');
} finally {
  await browser.close();
}
