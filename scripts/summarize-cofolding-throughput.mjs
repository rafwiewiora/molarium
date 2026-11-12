import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const sources=process.argv.slice(2);
if(!sources.length)throw new Error('Supply completed library JSON files in execution order.');
const cases=[];
for(const path of sources){const bytes=await readFile(resolve(root,path)),bundle=JSON.parse(bytes),run=bundle.run;
  const poses=bundle.poses.filter(p=>p.status==='complete').sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
  const warm=poses.slice(1),mean=warm.reduce((a,p)=>a+p.wallMs,0)/warm.length;
  cases.push({source:relative(root,resolve(root,path)),sha256:createHash('sha256').update(bytes).digest('hex'),
    name:run.name,residues:run.request.sequence.length,compounds:run.compounds.length,samples:run.samples,
    request:run.request,environment:run.environment,completed:poses.length,failed:bundle.poses.filter(p=>p.status==='failed').length,
    firstPoseWallMs:poses[0]?.wallMs,warmMeanWallMs:mean,warmPosesPerMinute:60000/mean,
    warmRangeMs:warm.length?[Math.min(...warm.map(p=>p.wallMs)),Math.max(...warm.map(p=>p.wallMs))]:null,
    sessionMs:run.sessions.map(s=>s.elapsedMs),poses:poses.map(p=>({id:p.id,startedAt:p.startedAt,wallMs:p.wallMs,
      inferenceMs:p.result.elapsedMs,runtime:p.result.runtime,pdbSha256:p.result.provenance.outputPdbSha256}))});
}
const summary={schema:'molarium.cofolding-throughput-summary.v1',hardware:process.env.MOLARIUM_BENCH_HARDWARE??'See recorded adapter information',
  scope:'Single-machine engineering throughput, not pose accuracy. No MSA search; arbitrary small ligands. Serial queue, one prediction per seed.',
  timingBoundary:'wallMs includes featurization, model loading and inference. Warm mean excludes the first chronological pose, not the first lexicographic ID. InferenceMs starts after model loading.',cases};
const out=resolve(root,'reviews/library-cofolding-2026-11-12/summary.json');await mkdir(resolve(out,'..'),{recursive:true});
await writeFile(out,JSON.stringify(summary,null,2)+'\n');
for(const c of cases)console.log(`${c.residues} aa, ${c.request.steps} steps, ${c.request.recycles} recycles: first ${(c.firstPoseWallMs/1000).toFixed(2)} s, warm ${(c.warmMeanWallMs/1000).toFixed(2)} s/pose (${c.warmPosesPerMinute.toFixed(1)}/min)`);
