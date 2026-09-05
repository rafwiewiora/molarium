// Uses the production worker and its public messages, not a second implementation.
const worker = new Worker('/webgpu-worker.js');
const pending = new Map(); let id = 0;
worker.addEventListener('message', ({data}) => {
  if (data.type === 'progress') return;
  const entry = pending.get(data.id); if (!entry) return;
  pending.delete(data.id); clearTimeout(entry.timer);
  if (data.type === 'error') entry.reject(new Error(data.message)); else entry.resolve(data);
});
worker.addEventListener('error', event => {
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(event.message)); }
  pending.clear();
});
function run(molecule, options, job='energy') {
  return new Promise((resolve,reject) => {
    const jobId = ++id;
    const timer = setTimeout(() => {pending.delete(jobId);reject(new Error('Worker job timed out'));},300000);
    pending.set(jobId,{resolve,reject,timer});
    worker.postMessage({type:'run',id:jobId,job,molecule,options});
  });
}
window.simulationBenchmark = {
  async environment() {
    const adapter = await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
    if (!adapter) throw new Error('No WebGPU adapter');
    const info = adapter.info || await adapter.requestAdapterInfo();
    const record = Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter']
      .map(k=>[k,info[k] ?? adapter[k] ?? null]));
    if (record.isFallbackAdapter || /swiftshader|llvmpipe|lavapipe|software/i.test(JSON.stringify(record)))
      throw new Error(`Software GPU is not a hardware benchmark: ${JSON.stringify(record)}`);
    return {userAgent:navigator.userAgent,adapter:record,features:[...adapter.features],
      limits:Object.fromEntries(['maxBufferSize','maxStorageBufferBindingSize','maxStorageBuffersPerShaderStage']
        .map(k=>[k,adapter.limits[k]])),hardwareConcurrency:navigator.hardwareConcurrency};
  },
  async accuracy(c) {
    const r = await run(c.molecule,c.options);
    if (r.gpuAdapter?.isFallbackAdapter || /swiftshader|llvmpipe|lavapipe|software/i.test(JSON.stringify(r.gpuAdapter)))
      throw new Error('Production worker selected a software adapter');
    return {energy:r.finalEnergy*4.184,forces:Array.from(r.forces),elapsedMs:r.elapsedMs,
      gpuAdapter:r.gpuAdapter,
      atomCount:c.molecule.atoms.length,constraintCount:r.constraintCount,cutoffNm:r.cutoffNm,
      implicitSolvent:r.implicitSolvent};
  },
  async speed(c,p,repeats,seconds) {
    const results = {};
    for (const job of ['energy','dynamics']) {
      const samples=[];
      for (let repeat=-p.warmups;repeat<repeats;repeat++) {
        let jobs=0,workerMs=0,last;
        const start=performance.now();
        do {
          last=await run(c.molecule,{...c.options,dt:p.timestepPs,steps:p.mdStepsPerJob,
            temperature:p.temperatureK,friction:p.frictionPerPs,savedFrameCount:p.savedFramesPerJob},job);
          workerMs+=last.elapsedMs; jobs++;
        } while ((performance.now()-start)<seconds*1000);
        const elapsed=(performance.now()-start)/1000;
        if (!Number.isFinite(last.finalEnergy) || !Array.from(last.forces).every(Number.isFinite))
          throw new Error('Non-finite trajectory or timed single-point result');
        if (repeat>=0) samples.push({seconds:elapsed,jobs,msPerJob:elapsed*1000/jobs,
          workerMsPerJob:workerMs/jobs,stepsPerSecond:job==='dynamics'?jobs*p.mdStepsPerJob/elapsed:null,
          nsPerDay:job==='dynamics'?jobs*p.mdStepsPerJob*p.timestepPs*86.4/elapsed:null,
          finalEnergy:last.finalEnergy*4.184,constraintError:last.constraintError,frameCount:last.frameCount});
      }
      results[job]={scope:'production worker end-to-end; fresh simulation each job; compilation warmed; transfer and endpoint readbacks included',samples};
    }
    return results;
  },
};
