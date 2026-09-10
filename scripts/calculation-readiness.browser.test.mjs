import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';
const browser=await startMolariumBrowser({root:resolve(import.meta.dirname,'..'),appPath:'?blank=1'});
try {
  await waitFor(()=>browser.evaluate('Boolean(window.MolariumChemistActionsReady && window.molariumTest)'),60000,'API');
  await browser.evaluate('window.MolariumChemistActionsReady.then(()=>true)');
  console.log('Readiness API ready');
  const execute=(action,args)=>browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({action,args})})`);
  const calculate=(job,options={})=>execute('calculation.run',{method:'openmm',job,
    options:{steps:2,savedFrameCount:2,implicitSolvent:'obc2',constraintMode:'hbonds',...options}});
  const pre=r=>r.result.calculation.preSimulationMinimization;
  await execute('session.loadStructure',{format:'smiles',content:'CC',polish:false});
  assert.equal(pre(await calculate('dynamics')).status,'performed');
  assert.equal(pre(await calculate('dynamics')).status,'already-minimized');
  // Replay's final frame is rigidly aligned, unlike the raw worker endpoint.
  await execute('calculation.selectFrame',{index:0});
  await execute('calculation.selectFrame',{index:1});
  const replayed=pre(await calculate('dynamics'));
  assert.equal(replayed.status,'already-minimized');
  assert.match(replayed.source,/saved MD frame/);
  await execute('calculation.selectFrame',{index:0});
  assert.equal(pre(await calculate('dynamics')).status,'already-minimized');
  assert.equal(pre(await calculate('dynamics',{implicitSolvent:'vacuum'})).status,'performed');
  await calculate('geometry');
  assert.equal(pre(await calculate('dynamics')).status,'already-minimized');
  assert.equal(pre(await calculate('dynamics',{minimizeBeforeDynamics:false})).status,'disabled');
  // The real Run button obeys the same unchecked setting, and records the choice.
  await execute('view.setMode',{mode:'run'});
  await browser.evaluate(`document.querySelector('#method-select').value='openmm';
    document.querySelector('#job-select').value='dynamics';
    document.querySelector('#simulation-step-count').value='100';
    document.querySelector('#minimize-before-dynamics').checked=false;
    document.querySelector('#run-calculation').click();`);
  await waitFor(()=>browser.evaluate(`document.body.dataset.calculationState==='complete'
    && document.querySelector('#result-meta').textContent.includes('minimization disabled')`),60000,'actual Run');
  await browser.evaluate(`document.querySelector('#minimize-before-dynamics').checked=true`);
  // Actual builder operations invalidate a prepared protein's numeric System.
  // Use a separated small component for a quick offline CI test; the 7KPA
  // diagnostic additionally exercises an R group on the bound ligand itself.
  await execute('session.loadFixture',{fixtureId:'trp-cage'});
  await execute('view.setMode',{mode:'build'});
  const added=await execute('chemistry.addAtom',{element:'C',positionAngstrom:{x:50,y:0,z:0}});
  await execute('chemistry.setEditPolicy',{mode:'staged'});
  await execute('chemistry.addAtom',{element:'C',attachedToAtomId:added.result.addedAtomId});
  await assert.rejects(calculate('energy'),/Finish or discard/);
  await execute('chemistry.finish',{});
  const before=await browser.evaluate('window.molariumTest.current().molecule');
  assert.equal(before.parameterization,undefined);
  assert.ok(before.preparation.lastSuccessfulParameterization);
  assert.equal((await calculate('energy')).status,'completed');
  const after=await browser.evaluate('window.molariumTest.current().molecule');
  assert.equal(after.parameterization.system.particles.length,after.atoms.length);
  assert.deepEqual(after.atoms,before.atoms,'retyping must not move or replace edited atoms');
  assert.deepEqual(after.bonds,before.bonds);
  console.log('Readiness: automatic/manual/repeated minimization, changed settings, explicit/UI disable; edited protein retyped without graph/coordinate loss');
} finally {await browser.close();}
