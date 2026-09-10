// Diagnostic only: direct workers deliberately bypass the application preflight.
// Uses the same freshly prepared input for every comparison; no user molecules.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';
const root = resolve(import.meta.dirname, '..');
const sourcePdb = await readFile(resolve(root,'test/fixtures/7kpa.pdb'),'utf8');
const report={schema:'molarium.dynamics-startup-diagnostic/v1',generatedAt:new Date().toISOString(),
  source:'test/fixtures/7kpa.pdb',sourcePdbSha256:createHash('sha256').update(sourcePdb).digest('hex'),cases:[]};
const browser = await startMolariumBrowser({root, appPath:'?blank=1',localOnly:false});
try {
  await waitFor(() => browser.evaluate('Boolean(window.MolariumChemistActionsReady && window.molariumTest)'), 60000, 'API');
  await browser.evaluate('window.MolariumChemistActionsReady.then(() => true)');
  const execute = (action,args) => browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({action,args})})`);
  await execute('session.loadStructure', {format:'pdb',polish:false,
    content:sourcePdb});
  console.log('Loaded 7KPA; preparing');
  await execute('protein.prepare', {});
  await browser.evaluate(`window.startupInput = window.molariumTest.current().molecule;
    window.workerJob = (method,job,molecule,options) => new Promise((resolve,reject) => {
      const worker = new Worker('./'+method+'-worker.js');
      const timeout=setTimeout(()=>{worker.terminate();reject(new Error('Diagnostic worker exceeded 90 seconds'));},90000);
      worker.onmessage = ({data}) => {
        if (data.type === 'result') { clearTimeout(timeout); worker.terminate(); resolve(data); }
        if (data.type === 'error') { clearTimeout(timeout); worker.terminate(); reject(new Error(data.message)); }
      };
      worker.onerror = event => { clearTimeout(timeout); worker.terminate(); reject(new Error(event.message)); };
      worker.postMessage({type:'run',id:1,job,molecule,options});
    });
    window.summarizeStartup = (r,m) => {
      const ligand = m.atoms.flatMap((a,i) => a.record==='HETATM' && !['HOH','WAT'].includes(a.residueName) && a.element!=='H' ? [i] : []);
      const distance = i => Math.hypot(...['x','y','z'].map((k,j)=>r.positions[3*i+j]-m.atoms[i][k]));
      const center = p => ligand.reduce((s,i)=>s.map((v,j)=>v+p(i,j)/ligand.length),[0,0,0]);
      const a=center((i,j)=>m.atoms[i][['x','y','z'][j]]),b=center((i,j)=>r.positions[3*i+j]);
      return {atoms:m.atoms.length,ligandHeavyAtoms:ligand.length,initialEnergy:r.initialEnergy,
        finalEnergy:r.finalEnergy,frameEnergies:Array.from(r.frameEnergies||[]),elapsedMs:r.elapsedMs,
        constraintError:r.constraintError,timestepFs:r.timestepFs,gpuAdapter:r.gpuAdapter,
        finitePositions:Array.from(r.positions).every(Number.isFinite),
        maxDisplacementAngstrom:Math.max(...m.atoms.map((_,i)=>distance(i))),
        ligandRmsDisplacementAngstrom:Math.sqrt(ligand.reduce((s,i)=>s+distance(i)**2,0)/ligand.length),
        ligandCenterDisplacementAngstrom:Math.hypot(...a.map((v,j)=>b[j]-v))};
    }; true;`);
  const cases = [
    {label:'unminimized-webgpu-hbonds',method:'webgpu',constraintMode:'hbonds'},
    {label:'minimized-webgpu-hbonds',method:'webgpu',constraintMode:'hbonds',minimize:true},
    {label:'unminimized-openmm-hbonds',method:'openmm',constraintMode:'hbonds'},
  ];
  for (const c of cases) {
    console.log('Starting', c.label);
    await browser.evaluate(`window.startupDone=false; window.startupError=null;
      (async()=>{
        const c=${JSON.stringify(c)},m=structuredClone(window.startupInput);
        const options={implicitSolvent:'obc2',constraintMode:c.constraintMode,nonbondedCutoffNm:0,
          steps:250,savedFrameCount:6,maxIterations:750,temperature:300};
        let minimization=null;
        if(c.minimize){
          const r=await window.workerJob(c.method,'geometry',m,options);
          minimization=window.summarizeStartup(r,m);
          m.atoms.forEach((a,i)=>['x','y','z'].forEach((k,j)=>a[k]=r.positions[3*i+j]));
        }
        const r=await window.workerJob(c.method,'dynamics',m,options);
        window.startupResult={label:c.label,minimization,dynamics:window.summarizeStartup(r,m)};
      })().catch(e=>window.startupError=e.message).finally(()=>window.startupDone=true); true;`);
    await waitFor(() => browser.evaluate('window.startupDone'), 1200000,c.label);
    const outcome=await browser.evaluate('window.startupError ? {error:window.startupError} : window.startupResult');
    report.cases.push({label:c.label,...outcome});
    console.log(JSON.stringify(report.cases.at(-1)));
  }
  console.log('Testing application preflight and bound-ligand R-group edit');
  const calculate=(job,steps=5)=>execute('calculation.run',{method:'webgpu',job,
    options:{steps,savedFrameCount:6,implicitSolvent:'obc2',constraintMode:'hbonds'}});
  const first=(await calculate('dynamics',250)).result.calculation;
  assert.equal(first.preSimulationMinimization.status,'performed');
  assert.ok(Number.isFinite(first.finalEnergy) && Math.abs(first.finalEnergy)<1e5);
  const repeated=(await calculate('dynamics')).result.calculation;
  assert.equal(repeated.preSimulationMinimization.status,'already-minimized');
  await execute('view.setMode',{mode:'build'});
  await execute('pose.captureReference',{mode:'propagate'});
  await execute('chemistry.setEditPolicy',{mode:'staged'});
  const anchor=await browser.evaluate(`(()=>{
    const m=window.molariumTest.current().molecule;
    return m.atoms.find((a,i)=>a.record==='HETATM' && a.element==='C'
      && m.bonds.filter(b=>b.a===i||b.b===i).some(b=>m.atoms[b.a===i?b.b:b.a].element==='H'))?.designAtomId;
  })()`);
  assert.ok(anchor,'ligand carbon with a replaceable hydrogen');
  const edit=await execute('chemistry.addAtom',{element:'C',attachedToAtomId:anchor});
  await execute('chemistry.finish',{});
  const before=await browser.evaluate('window.molariumTest.current().molecule');
  assert.equal(before.parameterization,undefined);
  assert.ok(before.preparation.lastSuccessfulParameterization);
  await calculate('energy');
  const after=await browser.evaluate('window.molariumTest.current().molecule');
  assert.deepEqual(after.atoms,before.atoms);
  assert.deepEqual(after.bonds,before.bonds);
  assert.equal(after.parameterization.system.particles.length,after.atoms.length);
  const edited=(await calculate('dynamics',20)).result.calculation;
  assert.equal(edited.preSimulationMinimization.status,'performed');
  report.application={first,repeated,edited,attachmentAtomId:anchor,addedAtomId:edit.result.addedAtomId,
    editedAtoms:after.atoms.length,retypingPreservedCoordinatesAndGraph:true};
  console.log(JSON.stringify(report.application));
  const output=process.argv[process.argv.indexOf('--output')+1];
  if(process.argv.includes('--output')) await writeFile(resolve(output),JSON.stringify(report,null,2)+'\n');
} finally { await browser.close(); }
