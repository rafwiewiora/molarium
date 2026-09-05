import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';
import { verifyBrowserLocalLabCapture } from '../../scripts/local-lab-capture.mjs';

const root = resolve(import.meta.dirname, '../..');
const qaOutput = process.env.MOLARIUM_QA_OUTPUT
  ? resolve(process.env.MOLARIUM_QA_OUTPUT) : null;
const browser = await startMolariumBrowser({ root,
  appPath:'?blank=1&designer-moves-movie=1', width:1600, height:1000,
  localOnly:true });

const execute = async (action, args = {}, requestId = null) => {
  const envelope = await browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({
    ...(requestId ? { requestId } : {}), action, args,
  })})`);
  if (envelope?.status !== 'completed')
    throw new Error(`${action} failed: ${envelope?.error || envelope?.status}`);
  return envelope.result;
};

const depictionEvidence = async () => browser.evaluate(`(async () => {
  const depiction = await window.molariumTest.waitFor2DDepiction();
  const svg = document.querySelector('#structure-2d-drawing svg');
  const box = svg?.viewBox?.baseVal;
  return { ...depiction,
    viewBox:box ? { width:box.width, height:box.height } : null,
    bondGraphics:svg?.querySelectorAll('[class*="bond-"]').length || 0,
  };
})()`);

const inspectLigand = async () => (await execute('session.inspect', {
  scope:'ligand', includeCoordinates:false, maximumAtoms:100,
}));

const assertCompleteDepiction = (depiction, ligand, expectedHeavyAtoms, expectedResidue) => {
  const heavyIds = new Set(ligand.atoms.filter((atom) => atom.element !== 'H')
    .map((atom) => atom.atomId));
  const heavyBonds = ligand.bonds.filter((bond) =>
    bond.atomIds.every((atomId) => heavyIds.has(atomId))).length;
  assert.equal(depiction.visible, true);
  assert.equal(depiction.hasSvg, true);
  assert.equal(depiction.error, null);
  assert.equal(depiction.heavyAtomCount, expectedHeavyAtoms);
  assert.equal(depiction.atomIndices.length, expectedHeavyAtoms);
  assert.equal(depiction.bondCount, heavyBonds);
  assert.ok(depiction.atomClasses >= expectedHeavyAtoms,
    'the SVG must contain a selectable graphic for every heavy atom');
  assert.ok(depiction.bondGraphics >= heavyBonds,
    'the SVG must visibly draw the complete ligand bond graph');
  assert.equal(depiction.pinnedLigand?.residueName, expectedResidue);
  assert.ok(depiction.viewBox?.width > 0 && depiction.viewBox?.height > 0,
    'the 2D ligand drawing must have a nonempty viewport');
};

async function screenshot(name) {
  if (!qaOutput) return;
  await mkdir(qaOutput, { recursive:true });
  await writeFile(join(qaOutput, name), await browser.capturePng());
}

try {
  await waitFor(async () => browser.evaluate(`Boolean(window.MolariumChemistActionsReady)
    && Boolean(window.molariumTest)`), 30000, 'Molarium public/test APIs');
  const localLab = await verifyBrowserLocalLabCapture(browser);
  assert.equal(localLab.badgeText, 'Local Lab · network locked');

  const loaded = await execute('designRoute.load', { routeId:'sos1-hit-only' },
    'presentation-qa-load-hit');
  assert.equal(loaded.designRoute.hit.pdbId, '5OVE');
  assert.equal(loaded.designRoute.hit.ligand, 'AXE');
  assert.equal(loaded.designRoute.hit.graph.heavyAtomCount, 27);
  await execute('view.setMode', { mode:'build' });
  await execute('view.focusComponent', { kind:'ligand', ordinal:0, isolate:false });
  const hitLigand = await inspectLigand();
  const hitDepiction = await depictionEvidence();
  assertCompleteDepiction(hitDepiction, hitLigand, 27, 'AXE');
  await screenshot('01-5ove-axe-full-interface.png');

  const changedAtomIds = hitLigand.atoms.filter((atom) => atom.element !== 'H')
    .slice(0, 8).map((atom) => atom.atomId);
  const highlighted = await execute('view.highlightAtoms', {
    atomIds:changedAtomIds,
    residueLabels:[{ chain:'A', residueIndex:890, label:'Phe890', tone:'gold' }],
  }, 'presentation-qa-highlight-scaffold');
  assert.equal(highlighted.highlightedAtoms.cameraPreserved, true);
  assert.equal(highlighted.highlightedAtoms.displayContextPreserved, true);
  assert.deepEqual(highlighted.highlightedAtoms.atomIds, changedAtomIds);
  assert.deepEqual(highlighted.highlightedAtoms.residueLabels,
    [{ chain:'A', residueIndex:890, label:'Phe890', tone:'gold' }]);
  await screenshot('02-axe-ligand-markers-and-phe890-context.png');

  const cleared = await execute('view.highlightAtoms', {
    atomIds:[],
    residueLabels:[{ chain:'A', residueIndex:890, label:'Phe890', tone:'gold' }],
  }, 'presentation-qa-clear-change-markers');
  assert.equal(cleared.highlightedAtoms.atomCount, 0,
    'clearing change markers must leave no red atom rings');
  assert.equal(cleared.highlightedAtoms.cameraPreserved, true);
  assert.equal(cleared.highlightedAtoms.displayContextPreserved, true);
  const transient = await browser.evaluate(`({
    cue:document.querySelectorAll('.designer-move-cue').length,
    press:document.querySelectorAll('.designer-move-press').length,
    change:document.querySelectorAll('.designer-move-change').length,
    demo:document.body.classList.contains('designer-move-demo-active'),
  })`);
  assert.deepEqual(transient, { cue:0, press:0, change:0, demo:false });
  await screenshot('03-axe-clean-fixed-pocket-context.png');

  console.log('SOS1 interface presentation browser QA: real 5OVE/AXE 2D graph, ligand/Phe separation, '
    + 'fixed camera, marker clearing, and Local Lab PASS');
} finally {
  await browser.close();
}
