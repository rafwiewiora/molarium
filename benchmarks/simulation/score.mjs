import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compare,quantile,summarize} from './metrics.mjs';
const arg = name => {const i=process.argv.indexOf(`--${name}`);if(i<0)throw new Error(`Missing --${name}`);return process.argv[i+1];};
const read = async name => {const bytes=await readFile(arg(name));return {data:JSON.parse(bytes),sha256:createHash('sha256').update(bytes).digest('hex')};};
const packet=await read('packet'),reference=await read('reference'),actual=await read('actual');
if(reference.data.platform!=='Reference')throw new Error('The oracle must be native OpenMM Reference');
for(const result of [reference.data,actual.data]){
  if(result.error)throw new Error(`Failed benchmark: ${result.error}`);
  if(result.packetSha256!==packet.sha256||result.protocolSha256!==packet.data.protocolSha256)
    throw new Error('Packet or protocol provenance mismatch');
}
const rows = [],seen = new Set();
for(const c of packet.data.cases){
  const ref=reference.data.cases.filter(r=>r.id===c.id), measured=actual.data.cases.filter(r=>r.id===c.id);
  if(ref.length!==1||measured.length!==1)throw new Error(`Missing or duplicate case ${c.id}; subset runs are not a full-suite pass`);
  seen.add(c.id);
  const row={id:c.id,atomCount:c.molecule.atoms.length,classification:c.classification||'normal'};
  try{
    if(ref[0].status!=='ok'||measured[0].status!=='ok')throw new Error(ref[0].error||measured[0].error||'Failed calculation');
    const result=measured[0].result||measured[0].rounded;
    row.packedInputAgreement=compare(ref[0].rounded,result,packet.data.protocol.accuracy);
    row.originalInputAgreement=compare(ref[0].original,result,packet.data.protocol.accuracy);
    row.inputQuantization=compare(ref[0].original,ref[0].rounded,packet.data.protocol.accuracy);
    row.passed=row.packedInputAgreement.passed;
    if(measured[0].performance)row.performance=Object.fromEntries(
      Object.entries(measured[0].performance).filter(([,v])=>v?.samples).map(([job,v])=>[job,{scope:v.scope,
        msPerJob:summarize(v.samples.map(s=>s.msPerJob)),
        ...(job==='dynamics'?{nsPerDay:summarize(v.samples.map(s=>s.nsPerDay))}:{}),samples:v.samples}]));
  }catch(error){row.passed=false;row.error=String(error);}
  rows.push(row);
}
for(const dataset of [reference.data,actual.data])
  if(dataset.cases.length!==seen.size||dataset.cases.some(c=>!seen.has(c.id)))throw new Error('Unexpected or duplicate result cases');
const metrics=rows.filter(r=>r.packedInputAgreement).map(r=>r.packedInputAgreement);
const report={schema:'molarium.simulation-benchmark-score/v1',
  sources:{packetSha256:packet.sha256,referenceSha256:reference.sha256,actualSha256:actual.sha256,protocolSha256:packet.data.protocolSha256},
  hardware:actual.data.environment,source:actual.data.source,
  gate:{passed:rows.every(r=>r.passed),total:rows.length,passedCases:rows.filter(r=>r.passed).length,
    failures:rows.filter(r=>!r.passed).map(r=>r.id),
    medianOfCaseMedianSymmetricAtomError:metrics.length?quantile(metrics.map(m=>m.symmetricRelativeAtomError.median),0.5):null,
    maximumForceRelativeRms:metrics.length?Math.max(...metrics.map(m=>m.forceRelativeRms??0)):null},cases:rows};
await writeFile(arg('output'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.gate,null,2));
for(const row of rows.filter(r=>!r.passed))console.log(row.id,JSON.stringify(row.packedInputAgreement||row.error));
if(!report.gate.passed)process.exitCode=1;
