import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {SUITES} from './score-validation.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const protocolBytes=readFileSync(new URL('./protocol.json',import.meta.url));
const protocol=JSON.parse(protocolBytes),protocolSha256=sha(protocolBytes);

function fixture(ids=SUITES['openmm-full-47']) {
  const observation={energy:0,forces:[0,0,0,0,0,0],components:{bond:0}};
  return {
    packet:{schema:'molarium.simulation-benchmark-packet/v1',protocol:structuredClone(protocol),
      protocolSha256,cases:ids.map(id=>({id,molecule:{atoms:[{},{}]}}))},
    reference:{schema:'molarium.native-openmm-benchmark/v1',platform:'Reference',protocolSha256,
      cases:ids.map(id=>({id,status:'ok',original:structuredClone(observation),rounded:structuredClone(observation)}))},
    actual:{schema:'molarium.webgpu-simulation-benchmark/v1',protocolSha256,
      cases:ids.map(id=>({id,status:'ok',result:structuredClone(observation)}))},
  };
}
function score(f,{flags=[],wrongPacketHash=false}={}) {
  const dir=mkdtempSync(join(tmpdir(),'molarium-benchmark-score-test-'));
  try {
    const bytes=JSON.stringify(f.packet),packetSha256=sha(bytes);
    writeFileSync(join(dir,'packet.json'),bytes);
    writeFileSync(join(dir,'reference.json'),JSON.stringify({...f.reference,packetSha256}));
    writeFileSync(join(dir,'actual.json'),JSON.stringify({...f.actual,
      packetSha256:wrongPacketHash?'wrong':packetSha256}));
    const output=join(dir,'score.json');
    const result=spawnSync(process.execPath,[new URL('./score.mjs',import.meta.url).pathname,
      '--packet',join(dir,'packet.json'),'--reference',join(dir,'reference.json'),
      '--actual',join(dir,'actual.json'),'--output',output,...flags]);
    return {status:result.status,error:result.stderr.toString(),
      report:existsSync(output)?JSON.parse(readFileSync(output)):null};
  } finally { rmSync(dir,{recursive:true,force:true}); }
}

test('only a complete registered suite can pass its gate',()=>{
  const full=score(fixture());
  assert.equal(full.status,0,full.error); assert.equal(full.report.gate.fullSuitePassed,true);
  assert.equal(full.report.gate.total,47);
  const small=fixture(SUITES['openmm-small-46']);
  assert.notEqual(score(small).status,0);
  const accepted=score(small,{flags:['--suite','openmm-small-46']});
  assert.equal(accepted.status,0,accepted.error);
  assert.equal(accepted.report.gate.passed,true);
  assert.equal(accepted.report.gate.fullSuitePassed,false);
  const subset=fixture(['analytic-total']);
  assert.notEqual(score(subset).status,0);
  const diagnostic=score(subset,{flags:['--diagnostic']});
  assert.equal(diagnostic.status,0,diagnostic.error);
  assert.equal(diagnostic.report.gate.observedCasesPassed,true);
  assert.equal(diagnostic.report.gate.passed,false);
  assert.equal(diagnostic.report.gate.fullSuitePassed,false);
});

test('empty, duplicate, omitted, and unknown cases never become passes',()=>{
  const mutations=[
    f=>{f.packet.cases=[];f.reference.cases=[];f.actual.cases=[];},
    f=>f.packet.cases.push(f.packet.cases[0]),
    f=>{f.packet.cases[0].id='unknown';},
    f=>f.reference.cases.pop(),f=>f.actual.cases.pop(),
    f=>f.reference.cases.push(f.reference.cases[0]),
    f=>f.actual.cases.push(f.actual.cases[0]),
  ];
  for(const mutate of mutations){const f=fixture();mutate(f);
    assert.notEqual(score(f).status,0,String(mutate));}
  assert.notEqual(score(fixture(),{wrongPacketHash:true}).status,0);
});

test('all three input schemas and the actual protocol content are checked',()=>{
  for(const name of ['packet','reference','actual']){
    const f=fixture();f[name].schema='invented/v99';assert.notEqual(score(f).status,0);
  }
  const f=fixture();f.packet.protocol.accuracy.forceRmsAbsoluteTolerance=1e10;
  assert.notEqual(score(f).status,0,'retaining the claimed protocol hash cannot hide changed tolerances');
  f.packet.protocolSha256='forged';f.reference.protocolSha256='forged';f.actual.protocolSha256='forged';
  assert.notEqual(score(f).status,0);
});

test('every reference and measured observation must contain finite exact 3N forces',()=>{
  for(const field of ['original','rounded','result'])for(const forces of [[0,0,0],[],[0,0,0,0,0,null]]){
    const f=fixture();
    (field==='result'?f.actual.cases[0]:f.reference.cases[0])[field].forces=forces;
    const result=score(f);assert.notEqual(result.status,0);
    assert.match(result.report.cases[0].error,/exactly 3N/);
  }
  const f=fixture();f.reference.cases[0].original.energy=null;
  assert.notEqual(score(f).status,0);
  const g=fixture();g.actual.cases[0].atomCount=1;
  assert.match(score(g).report.cases[0].error,/atom count/);
});

test('native original-input scoring uses the original observation, never the rounded one',()=>{
  const f=fixture(['analytic-total']);
  const original={energy:0,forces:[1,0,0,0,0,0],components:{bond:0}};
  f.reference.cases[0].original=structuredClone(original);
  f.actual={...f.actual,schema:'molarium.native-openmm-benchmark/v1',platform:'CUDA',
    cases:structuredClone(f.reference.cases)};
  const result=score(f,{flags:['--diagnostic']});assert.equal(result.status,0,result.error);
  const row=result.report.cases[0];
  assert.equal(row.packedInputAgreement.passed,true);
  assert.equal(row.originalInputAgreement.passed,true);
  assert.equal(row.inputQuantization.passed,false);
  f.actual.cases[0].original.forces=[1,0,0];
  assert.notEqual(score(f,{flags:['--diagnostic']}).status,0);
});
