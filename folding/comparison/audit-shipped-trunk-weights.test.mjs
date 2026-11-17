import test from 'node:test';
import assert from 'node:assert/strict';
import {compareWeights,sharedTable,requireDigest,sha256} from './audit_shipped_trunk_weights.mjs';

test('weight audit retains nonzero perturbations and distinguishes signed zero',()=>{
  const r=compareWeights(new Float32Array([3,-0,0]),new Float32Array([4,0,0]));
  assert.equal(r.relativeRms,1/3);assert.equal(r.maxAbs,1);assert.equal(r.differentValues,1);
  assert.equal(r.differentBits,2);assert.equal(r.maximumIndex,0);
  assert.equal(compareWeights(new Float32Array([0]),new Float32Array([1])).relativeRms,null);
});
test('missing, resized, nonfinite, truncated and changed bytes cannot become a match',()=>{
  const native={tensors:{a:{dtype:'float32',shape:[2],bytes:8}}};
  assert.throws(()=>sharedTable(native,{tensors:{}}),/Missing/);
  assert.throws(()=>sharedTable(native,{tensors:{a:{dtype:'int5',shape:[3]}}}),/shape/);
  assert.throws(()=>sharedTable({tensors:{}},{tensors:{}}),/Empty/);
  assert.throws(()=>compareWeights(new Float32Array([1]),new Float32Array([NaN])),/Non-finite/);
  assert.throws(()=>compareWeights(new Float32Array([1]),new Float32Array()),/length/);
  const raw=Buffer.from([1,2,3]);const digest=sha256(raw);raw[1]^=1;
  assert.throws(()=>requireDigest(raw,digest,'shard'),/Changed bytes/);
});
