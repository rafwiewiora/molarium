import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {validateScoreInputs,validateObservation} from './score-validation.mjs';
import {compare,summarize} from './metrics.mjs';
import {STORMM_CASES,stormmUnsupportedReason} from './stormm-scope.mjs';

export function scoreStormm(packet,reference,actual) {
  if(actual.data.schema!=='molarium.stormm-simulation-benchmark/v1')
    throw new Error('Expected production STORMM worker results');
  const coverage=validateScoreInputs(packet,reference,actual);
  const rows=[];
  for(const c of packet.data.cases) {
    const r=reference.data.cases.find(row=>row.id===c.id),a=actual.data.cases.find(row=>row.id===c.id);
    if(r.status!=='ok')throw new Error(`Failed native reference: ${c.id}`);
    validateObservation(r.original,c.molecule.atoms.length,c.id,{reference:true});
    const reason=stormmUnsupportedReason(c),supported=STORMM_CASES.includes(c.id);
    if(supported===Boolean(reason))throw new Error(`Capability declaration differs: ${c.id}`);
    if(a.atomCount!==c.molecule.atoms.length)throw new Error(`Wrong atom count: ${c.id}`);
    const row={id:c.id,atomCount:a.atomCount,supported};
    if(!supported) {
      if(a.status!=='unsupported'||a.reason!==reason||a.result)
        throw new Error(`Unsupported case must be reported explicitly, without substituted results: ${c.id}`);
      rows.push({...row,status:'unsupported',reason});continue;
    }
    try {
      if(a.status!=='ok')throw new Error(a.error||'Missing supported calculation');
      validateObservation(a.result,c.molecule.atoms.length,c.id);
      if(a.result.constraintsApplied!==false)throw new Error('Fixed-pose scoring must not project constraints');
      row.originalInputAgreement=compare(r.original,a.result,packet.data.protocol.accuracy);
      row.passed=row.originalInputAgreement.passed;
      row.status='measured';
      if(a.performance)row.performance=Object.fromEntries(Object.entries(a.performance).map(([job,p])=>[job,{
        scope:p.scope,msPerJob:summarize(p.samples.map(s=>s.msPerJob)),
        ...(job==='dynamics'?{nsPerDay:summarize(p.samples.map(s=>s.nsPerDay))}:{}),samples:p.samples}]));
    }catch(error){row.status='error';row.passed=false;row.error=String(error);}
    rows.push(row);
  }
  const supported=rows.filter(r=>r.supported);
  if(supported.length!==22)throw new Error('Missing registered STORMM supported cases');
  return {schema:'molarium.stormm-native-score/v1',
    sources:{packetSha256:packet.sha256,referenceSha256:reference.sha256,actualSha256:actual.sha256,
      protocolSha256:packet.data.protocolSha256},source:actual.data.source,hardware:actual.data.environment,
    comparison:{reference:'independently constructed native OpenMM Reference',input:'original',
      tolerances:'unchanged protocol.json accuracy limits',
      packedInputComparison:false,note:'The direct-worker f32-nm oracle is not STORMM Å/kcal packing.'},
    coverage:{...coverage,supportedCases:22,unsupportedCases:25},
    gate:{passed:supported.every(r=>r.passed),fullSuitePassed:false,total:22,
      passedCases:supported.filter(r=>r.passed).length,failures:supported.filter(r=>!r.passed).map(r=>r.id)},
    cases:rows};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const arg=name=>{const i=process.argv.indexOf(`--${name}`);if(i<0)throw new Error(`Missing --${name}`);return process.argv[i+1];};
  const read=async name=>{const bytes=await readFile(arg(name));return {data:JSON.parse(bytes),sha256:createHash('sha256').update(bytes).digest('hex')};};
  const result=scoreStormm(await read('packet'),await read('reference'),await read('actual'));
  await writeFile(arg('output'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result.gate,null,2));
  if(!result.gate.passed)process.exitCode=1;
}
