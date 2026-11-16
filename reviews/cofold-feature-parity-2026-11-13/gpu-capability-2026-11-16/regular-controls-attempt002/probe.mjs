// Capability diagnostics only: no weights, features, model or prediction calls.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {startMolariumBrowser} from '/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261115-attempt001/scripts/headless-chrome.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const helper = '/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261115-attempt001/scripts/headless-chrome.mjs';
if (sha(await readFile(helper)) !== 'b55a1197a5c2d2a112ea0b46d233b32a1e7aa7e1c5f7c06f32217ea9c9b19d13') throw Error('Shared browser helper changed');
const startedAt = new Date().toISOString();
const server = Bun.serve({hostname:'127.0.0.1', port:0, fetch(){return new Response('<!doctype html><title>GPU capability probe</title>',{headers:{'Content-Type':'text/html','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}});}});
let browser, result;
try {
  browser = await startMolariumBrowser({url:`http://127.0.0.1:${server.port}/`});
  const system = await browser.client.call('SystemInfo.getInfo').catch(error=>({unavailable:String(error)}));
  const webgpu = await browser.evaluate(`(async()=>{
    const report={userAgent:navigator.userAgent,secureContext:isSecureContext,webgpuAvailable:!!navigator.gpu};
    if(!navigator.gpu) return report;
    const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
    report.adapterAvailable=!!adapter;if(!adapter)return report;
    const info=adapter.info || await adapter.requestAdapterInfo();
    report.adapter=Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,info[k]]));
    report.features=[...adapter.features];report.limits=Object.fromEntries(Object.keys(Object.getPrototypeOf(adapter.limits)).map(k=>[k,adapter.limits[k]]));
    if(!JSON.stringify(report.adapter).toLowerCase().includes('nvidia')||info.isFallbackAdapter)throw Error('Physical NVIDIA adapter required');
    const device=await adapter.requestDevice();
    const buffer=device.createBuffer({size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
    const read=device.createBuffer({size:4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    const module=device.createShaderModule({code:'@group(0) @binding(0) var<storage,read_write> output: array<u32>; @compute @workgroup_size(1) fn main(){ output[0]=7u; }'});
    const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
    const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}}]});
    const encoder=device.createCommandEncoder();const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();encoder.copyBufferToBuffer(buffer,0,read,0,4);device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);report.integerProbe=new Uint32Array(read.getMappedRange())[0];read.unmap();buffer.destroy();read.destroy();device.destroy();
    if(report.integerProbe!==7)throw Error('Capability readback failed');return report;
  })()`);
  result={status:webgpu.adapterAvailable&&webgpu.integerProbe===7?'complete':'no-adapter',system,webgpu};
} catch(error) {result={status:'failed',error:error.stack||String(error)};}
finally {await browser?.close();server.stop(true);}
result={schema:'molarium.physical-gpu-capability-probe.v1',scope:'Browser startup, physical NVIDIA adapter and integer readback only; zero model or scientific inference calls.',startedAt,finishedAt:new Date().toISOString(),slurmJobId:process.env.SLURM_JOB_ID,helperSha256:sha(await readFile(helper)),...result};
await writeFile('probe-result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:result.status,adapter:result.webgpu?.adapter,error:result.error}));
if(result.status!=='complete')process.exitCode=1;
