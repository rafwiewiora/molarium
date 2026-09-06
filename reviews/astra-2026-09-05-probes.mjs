// Read-only production-code review; synthetic scorer fixtures live in a fresh temp directory.
// These probes RECORD current behavior. They are not regression tests asserting correctness.
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {buildParameterizedSystem} from '../stormm/core.mjs';
import {compare} from '../benchmarks/simulation/metrics.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(join(root,path));
const json=path=>JSON.parse(read(path));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const frozen=path=>JSON.parse(gunzipSync(read(`benchmarks/simulation/results/${path}.gz`)));
const output=process.argv[2];
const findings={};
const manifest=json('local-lab-manifest.json');
findings.localLabManifest={total:manifest.files.length,mismatches:manifest.files
  .filter(f=>sha(read(f.path))!==f.sha256).map(f=>f.path)};

const molecule={atoms:[{element:'C',x:0,y:0,z:0},{element:'C',x:1.5,y:0,z:0}],bonds:[]};
const system={particles:[{mass_amu:12},{mass_amu:12}],constraints:[],
  bonds:[{i:0,j:1,r0_nm:0.14,k_kj_nm2:1000}],angles:[],torsions:[],
  nonbonded:[{charge_e:0,sigma_nm:0.3,epsilon_kj:0.1},{charge_e:0,sigma_nm:0.3,epsilon_kj:0.1}],exceptions:[]};
const baseline=buildParameterizedSystem(molecule,{system});
const extra=structuredClone(system);
extra.customExternalForces=[{expression:'k*x*x',k:100,particles:[0,1]}];
const unexpected=buildParameterizedSystem(molecule,{system:extra});
findings.unsupportedForce={accepted:true,packedIntegersUnchanged:sha(Buffer.from(baseline.tu.buffer))===sha(Buffer.from(unexpected.tu.buffer)),
  packedFloatsUnchanged:sha(Buffer.from(baseline.tf.buffer))===sha(Buffer.from(unexpected.tf.buffer))};

// Evaluate the actual classic-worker packing function with only its top-level browser globals stubbed.
const context={self:{importScripts(){},addEventListener(){}},GPUBufferUsage:{STORAGE:1,COPY_DST:2,COPY_SRC:4}};
vm.createContext(context);
vm.runInContext(read('webgpu-worker.js').toString()+'\nglobalThis.reviewPack=packSmirnoffModel;',context);
const invalidSystem=structuredClone(system);invalidSystem.particles[0].mass_amu=Infinity;
const packed=context.reviewPack(molecule,invalidSystem,0,'synthetic review fixture');
findings.infiniteMass={accepted:true,inverseMass:packed.posm[3]};
const negative=structuredClone(system);negative.nonbonded.forEach(x=>x.epsilon_kj=-0.1);
const negativePacked=context.reviewPack(molecule,negative,0,'synthetic review fixture');
findings.negativeLennardJones={accepted:true,packedEpsilon:negativePacked.nonbonded[2]};

const protocol=json('benchmarks/simulation/protocol.json');
const protocolHash=sha(read('benchmarks/simulation/protocol.json'));
const temp=mkdtempSync(join(tmpdir(),'molarium-astra-review-'));
const result={energy:0,forces:[0,0,0],components:{bond:0}};
function scoreFixture(label,cases,referenceCases,actualCases){
  const packet={protocol,protocolSha256:protocolHash,cases};
  const bytes=JSON.stringify(packet),packetHash=sha(bytes);
  const common={protocolSha256:protocolHash,packetSha256:packetHash};
  const paths=Object.fromEntries(['packet','reference','actual','score'].map(k=>[k,join(temp,`${label}-${k}.json`)]));
  writeFileSync(paths.packet,bytes);
  writeFileSync(paths.reference,JSON.stringify({...common,platform:'Reference',cases:referenceCases}));
  writeFileSync(paths.actual,JSON.stringify({...common,cases:actualCases}));
  const run=spawnSync(process.execPath,[join(root,'benchmarks/simulation/score.mjs'),
    '--packet',paths.packet,'--reference',paths.reference,'--actual',paths.actual,'--output',paths.score],{encoding:'utf8'});
  return {exitCode:run.status,...(run.status===0?{gate:JSON.parse(readFileSync(paths.score)).gate}:{stderr:run.stderr})};
}
try{
  findings.emptySuite=scoreFixture('empty',[],[],[]);
  findings.truncatedForces=scoreFixture('truncated',[{id:'two-atoms',molecule}],
    [{id:'two-atoms',status:'ok',original:result,rounded:result}],
    [{id:'two-atoms',status:'ok',result}]);
}finally{rmSync(temp,{recursive:true,force:true});}

const reference=frozen('l4-20260905-a07/reference.json');
const native=frozen('l4-20260905-a09/cuda-double.json');
const score=frozen('l4-20260905-a09/cuda-double-score.json');
findings.nativeOriginalScore={recordedOriginalPassing:score.cases.filter(c=>c.originalInputAgreement.passed).length,
  independentlyRecomputedOriginalPassing:native.cases.filter(c=>compare(reference.cases.find(r=>r.id===c.id).original,c.original,protocol.accuracy).passed).length,
  total:native.cases.length};
const runs=json('benchmarks/simulation/results/runs.json').runs;
findings.publishedForceLengths=runs.map(run=>{
  const data=frozen(`${run.directory}/${run.actual}`);
  return {label:run.label,total:data.cases.length,
    invalid:data.cases.filter(c=>{const r=c.result||c.rounded;return r.forces.length!==c.atomCount*3;}).map(c=>c.id)};
});
const report={schema:'molarium.adversarial-review-probes/v1',reviewLabel:'Astra review of Sol work',
  reviewedCommit:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),
  generatedAt:new Date().toISOString(),runtime:process.version,findings};
if(output)writeFileSync(resolve(output),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));
