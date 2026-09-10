import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';
const b=await startMolariumBrowser(process.env.MOLARIUM_READINESS_URL
  ? {url:process.env.MOLARIUM_READINESS_URL}
  : {root:resolve(import.meta.dirname,'..'),appPath:'dist/?blank=1'});
try {
  await waitFor(()=>b.evaluate('Boolean(window.MolariumChemistActionsReady)'),60000,'release API');
  await b.evaluate('window.MolariumChemistActionsReady.then(()=>true)');
  const run=(action,args)=>b.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({action,args})})`);
  const md=()=>run('calculation.run',{method:process.env.MOLARIUM_READINESS_ENGINE||'openmm',
    job:'dynamics',options:{steps:2,savedFrameCount:2,implicitSolvent:'obc2',constraintMode:'hbonds'}});
  await run('session.loadStructure',{format:'smiles',content:'CC',polish:false});
  assert.equal((await md()).result.calculation.preSimulationMinimization.status,'performed');
  assert.equal((await md()).result.calculation.preSimulationMinimization.status,'already-minimized');
  await run('calculation.selectFrame',{index:0});
  await run('calculation.selectFrame',{index:1});
  const replay=(await md()).result.calculation.preSimulationMinimization;
  assert.equal(replay.status,'already-minimized');
  assert.match(replay.source,/saved MD frame/);
  const scripts=await b.evaluate(`Array.from(document.scripts,s=>s.src).filter(s=>s.includes('/app.js'))`);
  assert.ok(scripts.some(s=>new URL(s).searchParams.get('v')),'release entry has version URL');
  console.log('Release bundle: first MD minimized; repeated and display-aligned MD reused: PASS');
} finally {await b.close();}
