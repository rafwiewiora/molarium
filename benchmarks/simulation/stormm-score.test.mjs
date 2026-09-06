import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {scoreStormm} from './stormm-score.mjs';
import {STORMM_CASES,stormmUnsupportedReason} from './stormm-scope.mjs';
const base=new URL('./results/m1pro-20260905-a07/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',base)));
function load(match) {
  const entry=manifest.files.find(f=>match(f.name));
  const bytes=gunzipSync(readFileSync(new URL(entry.name,base)));
  return {data:JSON.parse(bytes),sha256:createHash('sha256').update(bytes).digest('hex')};
}
const packet=load(name=>name.startsWith('packet-')),reference=load(name=>name==='reference.json.gz');
const valid=()=>({data:{schema:'molarium.stormm-simulation-benchmark/v1',
  packetSha256:packet.sha256,protocolSha256:packet.data.protocolSha256,
  cases:packet.data.cases.map(c=>{const reason=stormmUnsupportedReason(c);return {
    id:c.id,atomCount:c.molecule.atoms.length,...(reason?{status:'unsupported',reason}
      :{status:'ok',result:{...structuredClone(reference.data.cases.find(r=>r.id===c.id).original),constraintsApplied:false}})};})}});
test('STORMM scope is 22 supported + 25 explicitly unsupported, never a full-suite pass',()=>{
  assert.equal(STORMM_CASES.length,22);
  const result=scoreStormm(packet,reference,valid());
  assert.equal(result.gate.passed,true);assert.equal(result.gate.fullSuitePassed,false);
  assert.equal(result.coverage.unsupportedCases,25);assert.equal(result.comparison.packedInputComparison,false);
});
test('STORMM scorer rejects hidden failures, substituted systems, missing cases and truncated forces',()=>{
  for(const mutate of [
    a=>{a.data.cases.pop();},
    a=>{a.data.cases.find(c=>c.status==='unsupported').status='ok';},
    a=>{a.data.cases[0].atomCount=1;},
  ]) {const actual=valid();mutate(actual);assert.throws(()=>scoreStormm(packet,reference,actual));}
  for(const mutate of [
    a=>{a.data.cases[0].status='unsupported';},
    a=>{a.data.cases[0].result.forces.pop();},
    a=>{a.data.cases[0].result.constraintsApplied=true;},
    a=>{a.data.cases[0].result.energy=Infinity;},
  ]) {const actual=valid();mutate(actual);assert.equal(scoreStormm(packet,reference,actual).gate.passed,false);}
});
