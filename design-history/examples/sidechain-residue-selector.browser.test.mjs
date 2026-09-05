import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';

const root = resolve(import.meta.dirname, '../..');
const browser = await startMolariumBrowser({ root, appPath:'?blank=1',
  width:1000, height:700, localOnly:true });

try {
  await waitFor(async () => browser.evaluate(`Boolean(window.MolariumChemistActionsReady)`),
    30000, 'Chemist Actions API');
  const result = await browser.evaluate(`(async () => {
    const execute = (action, args) => window.MolariumChemistActions.execute({
      requestId:'stable-residue-' + action, action, args,
    });
    await execute('designRoute.load', { routeId:'sos1-hit-only' });
    await execute('view.setMode', { mode:'build' });
    const enumerated = await execute('pose.enumerateSidechainRotamers', {
      receptorResidue:{ residueName:'PHE', chain:'A', residueIndex:890,
        insertionCode:'' },
      maximumCandidates:32,
    });
    const applied = await execute('pose.applySidechainRotamer', {
      chiDegrees:[-180,-90],
    });
    return { enumerated, applied };
  })()`);
  assert.equal(result.enumerated.status, 'completed');
  assert.deepEqual(result.enumerated.result.sidechainRotamers.residue, {
    residueName:'PHE', chain:'A', residueIndex:890, insertionCode:'',
    atomIndices:result.enumerated.result.sidechainRotamers.residue.atomIndices,
    sidechainAtomIndices:result.enumerated.result.sidechainRotamers.residue.sidechainAtomIndices,
  });
  assert.ok(result.enumerated.result.sidechainRotamers.generatedCandidateCount > 0);
  assert.equal(result.enumerated.result.sidechainRotamers.receptorAtomId.includes(':PHE:890::CG:'), true,
    'the stable residue selector should resolve the canonical CG representative');
  assert.equal(result.applied.status, 'completed');
  assert.ok(Math.abs(Math.abs(result.applied.result.sidechainRotamer.chiDegrees[0]) - 180)
    < 0.001);
  assert.equal(result.applied.result.sidechainRotamer.chiDegrees[1], -90);
  console.log('Stable side-chain residue selector browser regression: PASS');
} finally {
  await browser.close();
}
