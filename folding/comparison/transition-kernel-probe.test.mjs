import test from'node:test';
import assert from'node:assert/strict';
import {createTransitionShader,createTransitionSplitShaders,packTransitionWeights}from'../../vendor/localfold/webgpu/af3/trunk/transition.js';
import {translatedNormalization}from'./transition-kernel-probe.mjs';

test('diagnostic row shifting preserves actual in-place residual write addresses',()=>{
 for(const channels of [64,128,384])for(const precision of ['f32','f16']){
  const weights={inputLayerNormScale:new Float32Array(channels).fill(1),inputLayerNormOffset:new Float32Array(channels),
   transition1:new Float32Array(channels*channels*8),transition2:new Float32Array(channels*channels*4)};
  const packed=packTransitionWeights(weights),shape={rows:1761,channels,factor:4,residual:true,rowRange:true,stagePrecision:precision,weightPrecision:precision};
  const original=createTransitionShader(shape,packed.offsets,1e-5,'fast'),translated=translatedNormalization(original,'fused');
  const stores=s=>[...s.matchAll(/^\s*input\[[^\n]+\] \+= [^\n]+;/gm)].map(m=>m[0].trim());
  assert.ok(stores(original).length);assert.deepEqual(stores(translated.code),stores(original));
  assert.doesNotMatch(translated.code,/\([^\n]+\) \+=/);assert.ok(translated.replacements>0);
  if(channels===64){assert.match(translated.code,/reduce_a\[local\] = centered;/);assert.match(translated.code,/if \(c < CHANNELS\)/);}
 }
});
test('split diagnostic shifts the staged input in full and ragged row tiles',()=>{
 const offsets={inputLayerNormScale:0,inputLayerNormOffset:128,transition1:256,transition2:131328};
 const split=createTransitionSplitShaders({rows:1761,channels:128,factor:4},offsets,1e-5,'fast',{
  normalizedStorage:'f16',wideStorage:'f16',weightPrecision:'f16',matrix:{vector:true,storage:'f16'}});
 const result=translatedNormalization(split.normalize,'split');
 assert.equal(result.replacements,2);assert.equal((result.code.match(/input\[\(base_row \+ index \/ CHANNELS\) \* CHANNELS\]/g)||[]).length,2);
 assert.throws(()=>translatedNormalization('unexpected source','fused'),/no longer matches/);
});
