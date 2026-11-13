import test from'node:test';
import assert from'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm}from'node:fs/promises';
import {join,resolve,dirname}from'node:path';
import {tmpdir}from'node:os';
import {verifyTransitionPatch}from'./check_transition_patch.mjs';
import {applyLocalFoldPatches,localFoldSourceIdentity}from'../../scripts/localfold-patches.mjs';
import {LOCALFOLD_SOURCE}from'../localfold-source.mjs';
import {Af3TransitionGpu}from'../../vendor/localfold/webgpu/af3/trunk/transition.js';
const root=resolve(import.meta.dirname,'../..');
test('direct mode preserves default shaders and exactly ports all measured candidate bytes',async()=>{
 const result=await verifyTransitionPatch(root);
 assert.equal(result.defaultConfigurations,126);assert.equal(result.directShaderHashes,105);assert.equal(result.records.length,63);
 const frozen=JSON.parse(await readFile(join(root,'scripts/localfold-patches/direct-proof.json')));
 assert.deepEqual(result,frozen);
});
test('verified local patch applies reproducibly, is idempotent, and rejects a modified base',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'molarium-patch-check-'));
 try{
  const declaration=JSON.parse(await readFile(join(root,'scripts/localfold-patches/manifest.json'))),p=declaration.patches[0];
  const source=await readFile(join(root,'scripts/localfold-patches',p.upstreamSnapshot)),target=join(dir,'vendor/localfold',p.path);
  await mkdir(dirname(target),{recursive:true});await writeFile(target,source);
  const first=await applyLocalFoldPatches(dir,{revision:declaration.revision});
  assert.deepEqual(await readFile(target),await readFile(join(root,'vendor/localfold',p.path)));
  assert.deepEqual(await applyLocalFoldPatches(dir,{revision:declaration.revision}),first);
  await writeFile(target,Buffer.concat([source,Buffer.from('\n// unrelated change\n')]));const changed=await readFile(target);
  await assert.rejects(applyLocalFoldPatches(dir,{revision:declaration.revision}),/source hash mismatch/);
  assert.deepEqual(await readFile(target),changed);
  await assert.rejects(applyLocalFoldPatches(dir,{revision:'wrong'}),/revision mismatch/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('prediction source provenance binds the exact fork receipt and local patch hashes',async()=>{
 const receipt=await readFile(join(root,'vendor/localfold/UPSTREAM.json'));
 assert.deepEqual(LOCALFOLD_SOURCE,localFoldSourceIdentity(receipt));
 assert.equal(LOCALFOLD_SOURCE.localPatches.length,1);
 assert.equal(LOCALFOLD_SOURCE.localPatches[0].mode,'shifted-fast');
 const clone=structuredClone(LOCALFOLD_SOURCE);clone.localPatches[0].id='changed returned record';
 assert.notEqual(clone.localPatches[0].id,LOCALFOLD_SOURCE.localPatches[0].id);
});
test('standalone runner dispatch covers the generated shader tile at every tested width',async()=>{
 // API contract test only: the recording device does not execute numerical work.
 // Real GPU outputs are checked separately against saved native references.
 const previousUsage=globalThis.GPUBufferUsage,previousMode=globalThis.GPUMapMode;
 globalThis.GPUBufferUsage={MAP_READ:1,MAP_WRITE:2,COPY_SRC:4,COPY_DST:8,UNIFORM:64,STORAGE:128};
 globalThis.GPUMapMode={READ:1};
 try{
  for(const channels of [64,128,384])for(const rows of [1000,1761])for(const variance of ['fast','shifted-fast']){
   let shader='',dispatch=null;
   const device={limits:{maxBufferSize:2**30},queue:{writeBuffer(){},submit(){}},
    pushErrorScope(){},async popErrorScope(){return null;},createBindGroup(){return{};},
    createBuffer({size,label}){return{size,label,mapAsync:async()=>{},getMappedRange:()=>new ArrayBuffer(size),unmap(){},destroy(){}};},
    createCommandEncoder(){return{beginComputePass(){return{setPipeline(){},setBindGroup(){},dispatchWorkgroups(x,y){dispatch=[x,y];},end(){}};},copyBufferToBuffer(){},finish(){return{};}};}};
   const kernel=new Af3TransitionGpu(device);kernel.pipelines={async get(_key,source){shader=source;return{getBindGroupLayout(){return{};}};}};
   const factor=2,weights={inputLayerNormScale:new Float32Array(channels).fill(1),inputLayerNormOffset:new Float32Array(channels),
    transition1:new Float32Array(channels*channels*factor*2),transition2:new Float32Array(channels*channels*factor)};
   await kernel.run(new Float32Array(rows*channels),{rows,channels,factor},weights,{variance});
   const tile=Number(shader.match(/const TILE: u32 = (\d+)u;/)?.[1]);assert.ok(tile&&dispatch);
   const covered=dispatch[0]*dispatch[1]*tile;
   assert.ok(covered>=rows&&covered<rows+tile,`${channels} channels / ${rows} rows: ${covered} covered by tile ${tile}`);
   assert.equal(kernel.allocator.snapshot().currentBytes,0);
  }
 }finally{globalThis.GPUBufferUsage=previousUsage;globalThis.GPUMapMode=previousMode;}
});
