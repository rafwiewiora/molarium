import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const root = resolve(import.meta.dirname, '../..');
const browser = await startMolariumBrowser({ root, appPath:'?blank', width:1200, height:800 });
try {
  await waitFor(async () => browser.evaluate('Boolean(window.molariumTest && window.MolariumChemistActions)'),
    30000, 'Molarium test API');
  const load = await browser.evaluate(`window.MolariumChemistActions.execute({
    requestId:'registered-axe-depiction', action:'designRoute.load',
    args:{ routeId:'sos1-hit-only' }
  })`);
  assert.deepEqual(load.result.designRoute.hit.graph, {
    heavyAtomCount:27, bondCount:30, connected:true, coordinateMaximumDisplacement:0,
  });
  const hit = await browser.evaluate('window.molariumTest.waitFor2DDepiction()');
  assert.equal(hit.label, 'AXE ligand');
  assert.equal(hit.heavyAtomCount, 27);
  assert.equal(hit.bondCount, 30);
  assert.equal(hit.hasSvg, true);
  assert.equal(hit.error, null);
  assert.deepEqual(hit.pinnedLigand, {
    residueName:'AXE', chain:'A', residueIndex:1104, insertionCode:'',
  });

  await browser.evaluate(`window.molariumTest.loadObject({
    name:'Disconnected ligand', charge:0, multiplicity:1,
    atoms:[
      { element:'C', x:0, y:0, z:0, record:'HETATM', residueName:'BAD', chain:'L', residueIndex:1, atomName:'C1' },
      { element:'N', x:4, y:0, z:0, record:'HETATM', residueName:'BAD', chain:'L', residueIndex:1, atomName:'N1' }
    ], bonds:[], source:{ format:'pdb' }, prediction:{ kind:'pdb-import' }
  })`);
  await waitFor(async () => browser.evaluate(
    `Boolean(document.querySelector('#structure-2d-panel')?.dataset.error)`),
  10000, 'disconnected depiction rejection');
  const rejected = await browser.evaluate('window.molariumTest.twoDDepiction()');
  assert.match(rejected.error, /disconnected molecular graph/);
  assert.equal(rejected.hasSvg, false);
  assert.equal(rejected.heavyAtomCount, 0);
  console.log('Registered AXE 2D browser regression: PASS');
} finally {
  await browser.close();
}
