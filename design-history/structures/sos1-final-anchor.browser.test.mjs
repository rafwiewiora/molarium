import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';
import { validateRegisteredDesignRoute } from './design-route.mjs';

const root = resolve(import.meta.dirname, '../..');
const checkpoint = JSON.parse(await readFile(resolve(root,
  'outputs/design-history/sos1-hit-only-growth-clash-v7/open-phe890-pocket-prediction.json')));
const campaign = JSON.parse(await readFile(resolve(import.meta.dirname,
  'generated/sos1-prospective-campaign.json')));
validateRegisteredDesignRoute(campaign);
const finalStep = campaign.steps.find((step) => step.id === 'finish-bay-293');
const protectedNames = finalStep.posePropagationMap.protectedReferenceAnchor.referenceAtomNames;

function pdbAtomLine(atom, serial) {
  const [x, y, z] = atom.coordinatesAngstrom;
  const atomName = String(atom.atomName).slice(0, 4).padStart(4);
  const element = String(atom.element).slice(0, 2).padStart(2);
  return `HETATM${String(serial).padStart(5)} ${atomName} AWW A1104    `
    + `${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}`
    + `  1.00 20.00          ${element}`;
}

function ligandPdb(inspected) {
  const serialById = new Map(inspected.atoms.map((atom, index) => [atom.atomId, index + 1]));
  const lines = inspected.atoms.map((atom, index) => pdbAtomLine(atom, index + 1));
  for (const bond of inspected.bonds) {
    const first = serialById.get(bond.atomIds[0]);
    const second = serialById.get(bond.atomIds[1]);
    if (first && second) lines.push(`CONECT${String(first).padStart(5)}${String(second).padStart(5)}`);
  }
  return `${lines.join('\n')}\nEND\n`;
}

const browser = await startMolariumBrowser({ root, appPath:'?prospective=sos1-hit-only',
  width:1200, height:800 });
const execute = (action, args = {}, requestId = action) => browser.evaluate(
  `window.MolariumChemistActions.execute(${JSON.stringify({ action, args, requestId })})`);

try {
  await waitFor(async () => browser.evaluate(
    `Boolean(window.MolariumChemistActions && window.molariumTest)`),
  90000, 'Molarium test and Chemist Actions APIs');
  await execute('session.loadStructure', {
    content:ligandPdb(checkpoint.ligand), format:'pdb', name:'AWW predicted reference',
  }, 'load-aww-reference');
  await execute('view.setMode', { mode:'build' }, 'enter-design');
  await execute('view.focusComponent', {
    kind:'ligand', ordinal:0, isolate:false,
  }, 'focus-aww-reference');
  const focusBefore = await browser.evaluate('window.molariumTest.structureComponents()');
  await browser.evaluate('window.molariumTest.captureLigandReferenceForStagingTest()');
  const before = await execute('session.inspect', {
    scope:'ligand', includeCoordinates:true, maximumAtoms:256,
  }, 'inspect-aww-anchor');
  const staged = await browser.evaluate(
    `window.molariumTest.stageBenchmarkPoseProduct(${JSON.stringify({
      caseId:'sos1-hit-only:finish-bay-293-anchor-test',
      productSmiles:finalStep.productSmiles,
      posePropagationMap:finalStep.posePropagationMap,
      posePropagationPolicy:campaign.posePropagationPolicy,
      productAtomNames:finalStep.productAtomNames,
      productComponentId:finalStep.productComponentId,
      interactionHypotheses:[],
    })})`);
  const focusAfter = await browser.evaluate('window.molariumTest.structureComponents()');
  const after = await execute('session.inspect', {
    scope:'ligand', includeCoordinates:true, maximumAtoms:256,
  }, 'inspect-axh-anchor');

  assert.deepEqual(staged.embedding.protectedReference, {
    method:'maximum-common-substructure/v1',
    label:'AWW proximal quinazoline-thiophene core',
    atomCount:15,
    atomNames:protectedNames,
    maxDisplacementAngstrom:0,
  });
  const beforeByName = new Map(before.result.atoms.map((atom) => [atom.atomName, atom]));
  const afterByName = new Map(after.result.atoms.map((atom) => [atom.atomName, atom]));
  assert(after.result.atoms.every((atom) => atom.residueName === 'AXH'),
    'the staged BAY-293 component must be identified as AXH, not inherited AWW');
  assert.match(focusBefore.focusedComponentId || '', /AWW/,
    'the AWW ligand must own the pocket focus before graph replacement');
  assert.match(focusAfter.focusedComponentId || '', /AXH/,
    'the replacement AXH ligand must inherit the pocket focus');
  assert.deepEqual(focusAfter.focusedComponentCenter, focusBefore.focusedComponentCenter,
    'registered graph replacement must preserve the established camera center');
  assert.equal(focusAfter.focusedComponentRadius, focusBefore.focusedComponentRadius,
    'registered graph replacement must preserve the established camera scale');
  for (const atomName of protectedNames) {
    assert.deepEqual(afterByName.get(atomName)?.coordinatesAngstrom,
      beforeByName.get(atomName)?.coordinatesAngstrom,
      `${atomName} must remain exactly fixed while AXH is staged`);
  }
  assert(staged.embedding.attachedPlacement.regions
    .some((region) => region.atomIndices.length > 1),
  'the regioisomeric distal arm must be a released placement region');
  console.log('SOS1 AWW→AXH staging preserved all 15 proximal-core anchor atoms');
} finally {
  await browser.close();
}
