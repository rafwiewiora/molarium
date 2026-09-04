import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promoteCompletedRender } from './atomic-render-output.mjs';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';
import { verifyBrowserLocalLabCapture } from './local-lab-capture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PATH = 'outputs/design-history/sos1-preapproval/source/6EPM.pdb';
const SOURCE_SHA256 = '8513597c3d91e0f37217c9c4a60cd11e2e1900494931c1bda8dc882fecc24446';
const EXPECTED_LIGAND = Object.freeze({
  residueName:'BQ5', chain:'S', residueIndex:1101, heavyAtomCount:16, heavyBondCount:18,
});
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function connectedAtomCount(atomIds, bonds) {
  if (!atomIds.length) return 0;
  const neighbors = new Map(atomIds.map((id) => [id, []]));
  for (const bond of bonds) {
    const [first, second] = bond.atomIds || [];
    if (!neighbors.has(first) || !neighbors.has(second)) continue;
    neighbors.get(first).push(second); neighbors.get(second).push(first);
  }
  const visited = new Set([atomIds[0]]), pending = [atomIds[0]];
  while (pending.length) {
    const current = pending.pop();
    for (const next of neighbors.get(current) || []) {
      if (visited.has(next)) continue;
      visited.add(next); pending.push(next);
    }
  }
  return visited.size;
}

export function verifyBq5Inspection(envelope) {
  const inspection = envelope?.result || envelope;
  assert.equal(inspection?.scope, 'ligand', 'The public inspection must target one ligand');
  assert.equal(inspection?.truncated, false, 'The ligand inspection must not be truncated');
  assert(Array.isArray(inspection?.atoms) && Array.isArray(inspection?.bonds),
    'The public ligand inspection did not return atoms and bonds');
  assert(inspection.atoms.length > 0, 'The public ligand inspection is empty');
  for (const atom of inspection.atoms) {
    assert.equal(atom.residueName, EXPECTED_LIGAND.residueName,
      'The selected component is not exclusively BQ5');
    assert.equal(atom.chain, EXPECTED_LIGAND.chain,
      'The selected BQ5 component is on the wrong chain');
    assert.equal(Number(atom.residueIndex), EXPECTED_LIGAND.residueIndex,
      'The selected BQ5 component has the wrong residue number');
  }
  const heavyAtoms = inspection.atoms.filter((atom) => atom.element !== 'H');
  const heavyIds = heavyAtoms.map((atom) => atom.atomId);
  assert.equal(new Set(heavyIds).size, EXPECTED_LIGAND.heavyAtomCount,
    'BQ5 persistent heavy-atom IDs must be unique');
  assert.equal(heavyAtoms.length, EXPECTED_LIGAND.heavyAtomCount,
    'The registered BQ5 graph must contain exactly 16 heavy atoms');
  assert.equal(new Set(heavyAtoms.map((atom) => atom.atomName)).size,
    EXPECTED_LIGAND.heavyAtomCount, 'The registered BQ5 atom names must be unique');
  const heavySet = new Set(heavyIds);
  const heavyBonds = inspection.bonds.filter((bond) =>
    bond.atomIds?.length === 2 && bond.atomIds.every((id) => heavySet.has(id)));
  assert.equal(heavyBonds.length, EXPECTED_LIGAND.heavyBondCount,
    'The registered BQ5 graph must contain exactly 18 heavy-atom bonds');
  assert.equal(connectedAtomCount(heavyIds, heavyBonds), heavyAtoms.length,
    'The registered BQ5 heavy-atom graph must be connected');
  const aromaticBondCount = heavyBonds.filter((bond) => bond.aromatic).length;
  const multipleBondCount = heavyBonds.filter((bond) => Number(bond.order) > 1).length;
  assert(aromaticBondCount >= 5 || multipleBondCount >= 5,
    'BQ5 lacks the CCD aromatic/multiple-bond chemistry; raw PDB CONECT topology is insufficient');
  const atomNameById = new Map(heavyAtoms.map((atom) => [atom.atomId, atom.atomName]));
  const graph = heavyBonds.map((bond) => ({
    atoms:bond.atomIds.map((id) => atomNameById.get(id)).sort(),
    order:Number(bond.order), aromatic:Boolean(bond.aromatic),
  })).sort((first, second) => `${first.atoms}:${first.order}`.localeCompare(
    `${second.atoms}:${second.order}`));
  return {
    identity:{ ...EXPECTED_LIGAND }, atomIds:heavyIds, heavyAtomCount:heavyAtoms.length,
    heavyBondCount:heavyBonds.length, aromaticBondCount, multipleBondCount,
    graphSha256:sha256(JSON.stringify({
      atoms:heavyAtoms.map((atom) => [atom.atomName, atom.element, atom.formalCharge,
        Boolean(atom.aromatic)]).sort(), bonds:graph,
    })),
  };
}

export function verifyVisibleBq5Depiction(depiction, ligand) {
  assert.equal(depiction?.visible, true, 'The BQ5 2D panel is not visible');
  assert.match(String(depiction?.label || ''), /BQ5/i,
    'The visible 2D panel is not labelled as BQ5');
  assert.equal(depiction?.pending, false, 'The BQ5 2D depiction is still pending');
  assert.equal(depiction?.error, null, 'The BQ5 2D depiction reports an error');
  assert.equal(depiction?.hasSvg, true, 'The BQ5 2D depiction has no SVG');
  const atomIndices = [...new Set(depiction.atomIndices || [])].sort((a, b) => a - b);
  const bondIndices = [...new Set(depiction.bondIndices || [])].sort((a, b) => a - b);
  assert.deepEqual(atomIndices,
    Array.from({ length:ligand.heavyAtomCount }, (_, index) => index),
    'The 2D SVG is not the complete ligand-only BQ5 graph');
  assert.equal(bondIndices.length, ligand.heavyBondCount,
    'The 2D SVG bond count does not match the public BQ5 inspection');
  assert(depiction.svgLength > 500, 'The BQ5 2D SVG is unexpectedly empty');
  return { label:depiction.label, heavyAtomCount:atomIndices.length,
    heavyBondCount:bondIndices.length, svgSha256:sha256(depiction.svg) };
}

export function figure1ActionPlan(pdbContent) {
  return [
    { requestId:'figure1-load-6epm', action:'session.loadStructure', args:{
      content:pdbContent, format:'pdb', name:'6EPM · KRAS–SOS1 with fragment F1', polish:false,
    } },
    { requestId:'figure1-prepare-6epm', action:'protein.prepare', args:{
      pH:7.4, histidine:'auto', repairMissingHeavy:true,
      ligandPolicy:'ccd', waterPolicy:'exclude', gapPolicy:'cap',
    } },
    { requestId:'figure1-view-workspace', action:'view.setMode', args:{ mode:'view' } },
    { requestId:'figure1-display-complex', action:'view.setDisplay', args:{
      representation:'cartoon', showHydrogens:false, showInteractions:false,
      showPocketAtoms:true, pocketMode:'radius', showHulls:false, showVdw:false,
      showStericClashes:false, colorTheme:'standard', changeMarkers:'none',
      autoRotate:'none', playing:false,
    } },
    { requestId:'figure1-hide-glycerol', action:'view.setComponentVisibility', args:{
      kind:'ligand', ordinal:0, visible:false,
    } },
    { requestId:'figure1-focus-bq5', action:'view.focusComponent', args:{
      kind:'ligand', ordinal:1, isolate:false,
    } },
    { requestId:'figure1-inspect-bq5', action:'session.inspect', args:{
      scope:'ligand', includeCoordinates:false, maximumAtoms:256,
    } },
  ];
}

function parseArguments(argv) {
  const valueFor = (name) => {
    const index = argv.indexOf(name);
    if (index >= 0) return argv[index + 1];
    return argv.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
  };
  const width = Number(valueFor('--width') || 2048);
  const height = Number(valueFor('--height') || 1280);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1200 || height < 800)
    throw new Error('--width and --height must be integer publication viewports of at least 1200×800');
  return { width, height, install:argv.includes('--install'),
    outputDirectory:resolve(root, valueFor('--output')
      || 'outputs/paper/fig1-molarium-interface') };
}

async function execute(browser, request) {
  const envelope = await browser.evaluate(
    `window.MolariumChemistActions.execute(${JSON.stringify(request)})`);
  if (envelope?.status !== 'completed')
    throw new Error(`${request.action} did not complete through the public API`);
  return envelope;
}

async function readVisibleDepiction(browser) {
  return browser.evaluate(`(() => {
    const panel = document.querySelector('#structure-2d-panel');
    const svg = document.querySelector('#structure-2d-drawing svg');
    const classes = svg ? [...svg.querySelectorAll('[class]')]
      .flatMap((node) => [...node.classList]) : [];
    const uniqueNumbers = (pattern) => [...new Set(classes.flatMap((name) => {
      const match = pattern.exec(name); return match ? [Number(match[1])] : [];
    }))].sort((a, b) => a - b);
    return {
      visible:Boolean(panel && !panel.classList.contains('hidden')),
      pending:Boolean(panel?.dataset.pending), error:panel?.dataset.error || null,
      label:document.querySelector('#structure-2d-label')?.textContent || '',
      hasSvg:Boolean(svg), atomIndices:uniqueNumbers(/^atom-(\\d+)$/),
      bondIndices:uniqueNumbers(/^bond-(\\d+)$/),
      svg:svg?.outerHTML || '', svgLength:svg?.outerHTML?.length || 0,
    };
  })()`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const sourcePath = resolve(root, SOURCE_PATH);
  const sourceBytes = await readFile(sourcePath);
  if (sha256(sourceBytes) !== SOURCE_SHA256)
    throw new Error('The pinned 6EPM source differs from the reviewed Figure 1 input');
  await mkdir(dirname(options.outputDirectory), { recursive:true });
  const stagingDirectory = await mkdtemp(join(dirname(options.outputDirectory),
    '.fig1-molarium-interface-'));
  const browser = await startMolariumBrowser({ root, appPath:'index.html?blank=1',
    width:options.width, height:options.height, localOnly:true });
  let complete = false;
  try {
    await waitFor(async () => browser.evaluate(`document.readyState === 'complete'
      && Boolean(window.MolariumChemistActions)
      && window.MolariumChemistActions.schema === 'molarium.chemist-actions/v1'`),
    90000, 'public Chemist Actions API');
    const networkPolicy = await verifyBrowserLocalLabCapture(browser);
    const description = await browser.evaluate('window.MolariumChemistActions.describe()');
    let inspection;
    for (const request of figure1ActionPlan(sourceBytes.toString('utf8'))) {
      const envelope = await execute(browser, request);
      if (request.action === 'view.focusComponent') {
        assert.match(String(envelope.result?.focusedComponent?.label || ''), /BQ5/i,
          'Ligand ordinal 1 is not BQ5 in the pinned 6EPM structure');
      }
      if (request.action === 'session.inspect') inspection = envelope;
    }
    const ligand = verifyBq5Inspection(inspection);
    await execute(browser, { requestId:'figure1-select-bq5', action:'selection.replace',
      args:{ atomIds:ligand.atomIds } });
    await waitFor(async () => {
      const candidate = await readVisibleDepiction(browser);
      return candidate.hasSvg && !candidate.pending && !candidate.error ? candidate : null;
    }, 90000, 'registered BQ5 2D depiction');
    // Keep BQ5 as the sole visible ligand so the 2D panel remains pinned to it,
    // then clear selection/focus to capture the complete KRAS–SOS1 cartoon cleanly.
    await execute(browser, { requestId:'figure1-clear-selection', action:'selection.clear', args:{} });
    await execute(browser, { requestId:'figure1-clear-component-focus', action:'view.clearFocus',
      args:{ kind:'component' } });
    await execute(browser, { requestId:'figure1-fixed-camera', action:'view.setCamera', args:{
      rotation:{ x:0, y:0, z:0, w:1 }, pan:{ x:0, y:0 }, zoom:1.08,
    } });
    const depiction = verifyVisibleBq5Depiction(await readVisibleDepiction(browser), ligand);
    const interfaceState = await browser.evaluate(`(() => ({
      title:document.title,
      brand:document.querySelector('.brand-name')?.textContent?.trim()
        || document.querySelector('header')?.textContent?.trim() || '',
      activeMode:document.querySelector('[data-mode].active')?.dataset.mode || null,
      canvas:{ width:document.querySelector('#molecule-canvas')?.width || 0,
        height:document.querySelector('#molecule-canvas')?.height || 0 },
      twoDPanelVisible:!document.querySelector('#structure-2d-panel')?.classList.contains('hidden'),
    }))()`);
    assert.match(interfaceState.brand, /MOLARIUM/i, 'The full Molarium interface is not visible');
    assert.equal(interfaceState.activeMode, 'view', 'Figure 1 must show the normal View workspace');
    assert(interfaceState.canvas.width > 500 && interfaceState.canvas.height > 500,
      'The molecular viewer is not large enough for the Figure 1 capture');
    assert.equal(interfaceState.twoDPanelVisible, true, 'The BQ5 2D panel is hidden');
    const png = await browser.capturePng();
    const actionAudit = await browser.evaluate('window.MolariumChemistActions.history()');
    const auditBytes = Buffer.from(`${JSON.stringify({ schema:description.schema,
      figure:'Figure 1', records:actionAudit }, null, 2)}\n`);
    await writeFile(join(stagingDirectory, 'chemist-action-audit.json'), auditBytes);
    await writeFile(join(stagingDirectory, 'fig1_molarium_interface.png'), png);
    const manifest = {
      schema:'molarium.paper-interface-capture/v1', complete:true,
      generatedAt:new Date().toISOString(), figure:'Figure 1',
      source:{ path:SOURCE_PATH, sha256:SOURCE_SHA256, pdbId:'6EPM' },
      scene:{ assembly:'complete deposited KRAS–SOS1 protein assembly',
        selectedLigand:'BQ5/F1', glycerolVisible:false, waterPolicy:'exclude',
        displayHydrogens:false, pocketAtoms:true, representation:'cartoon' },
      ligand, depiction, interface:interfaceState, networkPolicy,
      publicActions:{ schema:description.schema,
        guarantee:description.guarantee, records:actionAudit.length,
        actionNames:actionAudit.map((record) => record.action),
        audit:'chemist-action-audit.json', auditSha256:sha256(auditBytes) },
      viewport:{ width:options.width, height:options.height, deviceScaleFactor:1 },
      image:{ filename:'fig1_molarium_interface.png', sha256:sha256(png), bytes:png.length },
    };
    await writeFile(join(stagingDirectory, 'capture-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`);
    complete = true;
  } finally {
    await browser.close();
  }
  await promoteCompletedRender({ stagingDirectory,
    outputDirectory:options.outputDirectory, complete });
  if (options.install) {
    const verifiedPng = await readFile(join(options.outputDirectory, 'fig1_molarium_interface.png'));
    const installPath = resolve(root, 'paper/figures/fig1_molarium_interface.png');
    const temporaryPath = `${installPath}.pending-${process.pid}`;
    await writeFile(temporaryPath, verifiedPng);
    const { rename } = await import('node:fs/promises');
    await rename(temporaryPath, installPath);
  }
  console.log(`Verified Figure 1 capture: ${relative(root, options.outputDirectory)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
