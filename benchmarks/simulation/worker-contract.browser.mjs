import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {startMolariumBrowser} from '../../scripts/headless-chrome.mjs';
const root=resolve(import.meta.dirname,'../..');
const browser=await startMolariumBrowser({root,appPath:'benchmarks/simulation/runner.html'});
try {
  const results=await browser.evaluate(`(async()=>{
    const base={atoms:[{element:'C',x:0,y:0,z:0},{element:'H',x:1.5,y:0,z:0}],bonds:[],
      parameterization:{forcefield:'Analytic bond contract fixture',system:{
        particles:[{mass_amu:12},{mass_amu:1}],constraints:[],
        bonds:[{i:0,j:1,r0_nm:0.14,k_kj_nm2:1000}],angles:[],torsions:[],
        nonbonded:[{charge_e:0,sigma_nm:0.3,epsilon_kj:0},{charge_e:0,sigma_nm:0.2,epsilon_kj:0}],exceptions:[]}}};
    const run=(backend,molecule,options={},job='dynamics')=>new Promise((resolve,reject)=>{
      const worker=new Worker('/'+backend+'-worker.js',backend==='stormm'?{type:'module'}:{});
      const timer=setTimeout(()=>{worker.terminate();reject(new Error(backend+' contract worker timeout'));},60000);
      worker.onmessage=({data})=>{
        if(data.type==='progress')return;
        clearTimeout(timer);worker.terminate();
        resolve({type:data.type,message:data.message,energy:data.finalEnergy,
          forces:Array.from(data.forces||[]),frameCount:data.frameCount,
          constraintsApplied:data.constraintsApplied,
          frameSteps:Array.from(data.frameSteps||[]),replicaCount:data.replicaCount,
          energies:Array.from(data.ensembleEnergies||data.frameEnergies||[]),
          trajectory:Array.from(data.ensembleTrajectory||data.trajectory||[]),
          positions:Array.from(data.positions||[])});
      };
      worker.onerror=event=>{clearTimeout(timer);worker.terminate();reject(new Error(event.message));};
      worker.postMessage({type:'run',id:1,job,molecule,
        options:{stormmSystem:'current',replicaCount:2,steps:2,savedFrameCount:2,temperature:0,...options}});
    });
    const invalid=[];
    for(const backend of ['webgpu','stormm','openmm']) {
      for(const [label,mutate] of [
        ['unknown force',m=>{m.parameterization.system.customExternalForces=[{expression:'k*x*x'}];}],
        ['periodic box',m=>{m.parameterization.system.periodicBoxVectors=[[1,0,0],[0,1,0],[0,0,1]];}],
        ['infinite mass',m=>{m.parameterization.system.particles[0].mass_amu=Infinity;}],
        ['negative epsilon',m=>{m.parameterization.system.nonbonded[0].epsilon_kj=-1;}],
        ['fractional index',m=>{m.parameterization.system.bonds[0].i=0.5;}],
      ]) {
        const molecule=structuredClone(base);mutate(molecule);
        invalid.push({backend,label,...await run(backend,molecule,{},backend==='stormm'?'dynamics':'parameters')});
      }
    }
    for(const backend of ['webgpu','stormm']) {
      for(const savedFrameCount of [NaN,Infinity,'not-a-number',0,2.5])
        invalid.push({backend,label:'invalid frame count',...await run(backend,base,{savedFrameCount})});
      const molecule=structuredClone(base);molecule.atoms[0].x=1e100;
      invalid.push({backend,label:'f32 overflow',...await run(backend,molecule)});
    }
    for(const options of [{cutoffNm:0.8},{nonbondedCutoffNm:0.8},{nonbondedCutoffNm:0,cutoffNm:0.8}])
      invalid.push({backend:'stormm',label:'unsupported cutoff',...await run('stormm',base,options)});
    const direct=await run('webgpu',base,{},'energy');
    const stormm=await run('stormm',base,{
      coordinateStack:new Float32Array([0,0,0,1.5,0,0,0,0,0,1.5,0,0]),
    },'score-batch');
    const dynamics=await run('stormm',base);
    const constrained=structuredClone(base);
    constrained.parameterization.system.constraints=[{i:0,j:1,distance_nm:0.1}];
    const singlePoint=await run('stormm',constrained,{},'energy');
    const constrainedBatch=await run('stormm',constrained,{
      coordinateStack:new Float32Array([0,0,0,1.5,0,0]),
    },'score-batch');
    return {invalid,direct,stormm,dynamics,singlePoint,constrainedBatch};
  })()`);
  for(const row of results.invalid) {
    assert.equal(row.type,'error',`${row.backend}: ${row.label} was accepted`);
    assert.match(row.message,/Unsupported|unsupported|finite|indices|nonnegative|savedFrameCount/i,
      `${row.backend}: ${row.label} must fail for the requested contract, not GPU startup`);
  }
  for(const [name,row] of Object.entries({direct:results.direct,stormm:results.stormm,dynamics:results.dynamics})) {
    assert.equal(row.type,'result',`${name}: ${row.message}`);
    assert.ok(row.positions.length===6&&row.positions.every(Number.isFinite));
    assert.ok(row.energies.length>0&&row.energies.every(Number.isFinite));
  }
  // Analytic 0.5*k*(r-r0)^2 at r=.15 nm, r0=.14 nm, k=1000 kJ/mol/nm².
  assert.ok(Math.abs(results.direct.energy*4.184-0.05)<1e-5);
  assert.deepEqual(results.direct.forces.length,6);
  assert.ok(Math.abs(results.direct.forces[0]-10)<1e-4);
  assert.ok(Math.abs(results.direct.forces[3]+10)<1e-4);
  assert.equal(results.stormm.frameCount,1);assert.equal(results.stormm.replicaCount,2);
  for(const energy of results.stormm.energies)assert.ok(Math.abs(energy*4.184-0.05)<1e-5);
  assert.equal(results.stormm.trajectory.length,12);
  assert.deepEqual(results.dynamics.frameSteps,[0,2]);
  assert.equal(results.dynamics.frameCount,2);assert.equal(results.dynamics.replicaCount,2);
  assert.equal(results.dynamics.energies.length,4);assert.equal(results.dynamics.trajectory.length,24);
  for(const row of [results.singlePoint,results.constrainedBatch]) {
    assert.equal(row.type,'result',row.message);
    assert.equal(row.constraintsApplied,false,'static scoring must not project the supplied pose');
    assert.deepEqual(row.positions,[0,0,0,1.5,0,0]);
    assert.ok(Math.abs(row.energy*4.184-0.05)<1e-5);
  }
  assert.equal(results.singlePoint.forces.length,6);
  assert.ok(Math.abs(results.singlePoint.forces[0]-10)<1e-4);
  assert.ok(Math.abs(results.singlePoint.forces[3]+10)<1e-4);
  console.log(`Worker contracts: ${results.invalid.length} invalid requests rejected; direct analytic energy/all forces, STORMM replica energies, and exact dynamics frames passed`);
} finally { await browser.close(); }
