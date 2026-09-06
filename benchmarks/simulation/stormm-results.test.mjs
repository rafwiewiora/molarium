import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {readEvidence,evidenceByHash,evidenceSha} from './evidence.mjs';
import {scoreStormm} from './stormm-score.mjs';
const runs=JSON.parse(readFileSync(new URL('./results/stormm-runs.json',import.meta.url))).runs;
function verifyNear(a,b) {
  if(typeof a==='number')assert.ok(Math.abs(a-b)<=Math.max(1e-15,Math.abs(a)*2e-12));
  else if(a&&typeof a==='object') {
    assert.deepEqual(Object.keys(a),Object.keys(b));
    for(const key of Object.keys(a))verifyNear(a[key],b[key]);
  } else assert.equal(a,b);
}
for(const run of runs)test(`recompute source-current native STORMM agreement: ${run.label}`,()=>{
  const score=readEvidence(run.directory,'score.json').data;
  const actual=readEvidence(run.directory,'stormm.json',score.sources.actualSha256);
  const reference=evidenceByHash(score.sources.referenceSha256),packet=evidenceByHash(score.sources.packetSha256);
  const calculated=scoreStormm(packet,reference,actual);
  assert.deepEqual(calculated.gate,score.gate);
  assert.deepEqual(calculated.coverage,score.coverage);
  // Per-case decisions remain exact across platforms; metrics tolerate only final-ulp libm differences.
  verifyNear(calculated.cases,score.cases);
  assert.equal(score.gate.total,22);assert.equal(score.coverage.unsupportedCases,25);
  assert.equal(score.gate.fullSuitePassed,false);
  for(const [path,hash] of Object.entries(actual.data.source.sourceHashes))
    assert.equal(evidenceSha(readFileSync(new URL(`../../${path}`,import.meta.url))),hash,
      `Current STORMM source differs from measured source: ${path}`);
});
test('STORMM readable report matches frozen evidence',()=>{
  const child=spawnSync(process.execPath,[new URL('./build-stormm-report.mjs',import.meta.url).pathname,'--check']);
  assert.equal(child.status,0,child.stderr.toString());
});
