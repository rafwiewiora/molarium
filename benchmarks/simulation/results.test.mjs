import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {compare} from './metrics.mjs';
const base=new URL('./results/',import.meta.url);
const sha=b=>createHash('sha256').update(b).digest('hex');
const index=new Map();
for(const directory of readdirSync(base,{withFileTypes:true}).filter(d=>d.isDirectory())){
  const manifest=JSON.parse(readFileSync(new URL(`${directory.name}/manifest.json`,base)));
  for(const entry of manifest.files){
    const path=new URL(`${directory.name}/${entry.name}`,base);
    index.set(entry.uncompressedSha256,{entry,path});
    test(`immutable evidence hash: ${directory.name}/${entry.name}`,()=>{
      const bytes=readFileSync(path);
      assert.equal(sha(bytes),entry.sha256);
      const raw=gunzipSync(bytes);
      assert.equal(sha(raw),entry.uncompressedSha256);assert.equal(raw.length,entry.bytes);
    });
  }
}
const byHash=hash=>{
  const found=index.get(hash);assert.ok(found,`Referenced evidence missing: ${hash}`);
  return JSON.parse(gunzipSync(readFileSync(found.path)));
};
const runs=JSON.parse(readFileSync(new URL('runs.json',base))).runs;
for(const run of runs)test(`recompute every published acceptance decision: ${run.label}`,()=>{
  const score=JSON.parse(gunzipSync(readFileSync(new URL(`${run.scoreDirectory||run.directory}/${run.score}.gz`,base))));
  const packet=byHash(score.sources.packetSha256),reference=byHash(score.sources.referenceSha256),actual=byHash(score.sources.actualSha256);
  assert.equal(packet.cases.length,47);assert.equal(actual.cases.length,47);
  assert.equal(reference.cases.length,47);
  for(const c of packet.cases){
    const a=actual.cases.find(row=>row.id===c.id),r=reference.cases.find(row=>row.id===c.id);
    assert.equal(a.status,'ok');assert.equal(r.status,'ok');
    const recalculated=compare(r.rounded,a.result||a.rounded,packet.protocol.accuracy);
    const reported=score.cases.find(row=>row.id===c.id);
    const verify=(a,b)=>{
      if(typeof a==='number'){
        assert.ok(Math.abs(a-b)<=Math.max(1e-15,Math.abs(a)*2e-12),`${a} != ${b}`);
      }else if(a&&typeof a==='object'){
        assert.deepEqual(Object.keys(a),Object.keys(b));
        for(const key of Object.keys(a))verify(a[key],b[key]);
      }else assert.equal(a,b);
    };
    // Different Node/libm versions can differ in the final ulp of an RMS.
    // Numerical summary checks allow only rounding noise; decisions stay exact.
    verify(recalculated,reported.packedInputAgreement);
    assert.equal(recalculated.passed,reported.passed);
  }
  assert.equal(score.gate.passed,score.cases.every(c=>c.passed));
  assert.equal(score.gate.passedCases,score.cases.filter(c=>c.passed).length);
});
