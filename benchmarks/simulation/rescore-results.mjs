// Re-score archived measurements into a NEW attempt; never rerun or overwrite science.
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const base=join(root,'benchmarks/simulation/results');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const output=process.argv[2];
if(!output)throw new Error('Usage: node benchmarks/simulation/rescore-results.mjs NEW_ATTEMPT_DIRECTORY');
await mkdir(dirname(resolve(output)),{recursive:true});
await mkdir(resolve(output)); // exclusive: no reuse of an earlier attempt
const runs=JSON.parse(await readFile(join(base,'runs.json'))).runs;
async function artifact(directory,name,expectedHash) {
  const manifest=JSON.parse(await readFile(join(base,directory,'manifest.json')));
  const entry=manifest.files.find(f=>f.name===`${name}.gz`);
  if(!entry)throw new Error(`Missing evidence: ${directory}/${name}`);
  const compressed=await readFile(join(base,directory,entry.name));
  if(sha(compressed)!==entry.sha256)throw new Error('Compressed evidence hash mismatch');
  const raw=gunzipSync(compressed);
  if(sha(raw)!==entry.uncompressedSha256||raw.length!==entry.bytes
    ||expectedHash&&sha(raw)!==expectedHash)throw new Error('Raw evidence hash mismatch');
  return raw;
}
const work=await mkdtemp(join(tmpdir(),'molarium-rescore-'));
const provenance={schema:'molarium.simulation-benchmark-rescoring/v1',
  sourceHashes:Object.fromEntries(await Promise.all([
    'rescore-results.mjs','score.mjs','score-validation.mjs','metrics.mjs','protocol.json',
  ].map(async name=>[name,sha(await readFile(new URL(name,import.meta.url)))]))),runs:[]};
try {
  for(const run of runs) {
    const prior=await artifact(run.scoreDirectory||run.directory,run.score);
    const oldScore=JSON.parse(prior);
    const referenceDirectory=run.referenceDirectory||run.directory;
    const packet=await artifact(referenceDirectory,`packet-${oldScore.sources.packetSha256}.json`,oldScore.sources.packetSha256);
    const reference=await artifact(referenceDirectory,'reference.json',oldScore.sources.referenceSha256);
    const actual=await artifact(run.directory,run.actual,oldScore.sources.actualSha256);
    for(const [name,bytes] of Object.entries({packet,reference,actual}))
      await writeFile(join(work,`${name}.json`),bytes);
    const scoreName=`${run.directory}-${basename(run.actual,'.json')}-score.json`;
    const destination=resolve(output,scoreName);
    execFileSync(process.execPath,[fileURLToPath(new URL('./score.mjs',import.meta.url)),
      '--packet',join(work,'packet.json'),'--reference',join(work,'reference.json'),
      '--actual',join(work,'actual.json'),'--output',destination],{stdio:'inherit'});
    provenance.runs.push({label:run.label,score:scoreName,
      priorScore:{directory:run.scoreDirectory||run.directory,name:run.score,sha256:sha(prior)},
      correctedScoreSha256:sha(await readFile(destination)),sources:oldScore.sources});
  }
  await writeFile(resolve(output,'rescoring-provenance.json'),JSON.stringify(provenance,null,2)+'\n',{flag:'wx'});
} finally { await rm(work,{recursive:true,force:true}); }
console.log(`Preserved ${runs.length} corrected scores in ${resolve(output)}; raw measurements and previous scores are unchanged.`);
