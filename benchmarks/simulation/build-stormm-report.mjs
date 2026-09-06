import {readFileSync,writeFileSync} from 'node:fs';
import {readEvidence,evidenceByHash} from './evidence.mjs';
import {summarize} from './metrics.mjs';
import {scoreStormm} from './stormm-score.mjs';
const base=new URL('./results/',import.meta.url);
const runs=JSON.parse(readFileSync(new URL('stormm-runs.json',base))).runs;
const rows=runs.map(run=>{
  const score=readEvidence(run.directory,'score.json').data;
  const actual=readEvidence(run.directory,'stormm.json',score.sources.actualSha256);
  const calculated=scoreStormm(evidenceByHash(score.sources.packetSha256),
    evidenceByHash(score.sources.referenceSha256),actual);
  if(JSON.stringify(calculated.gate)!==JSON.stringify(score.gate))throw new Error('Incorrect frozen STORMM gate');
  return {...run,score,actual:actual.data};
});
const lines=['# Production STORMM-style WebGPU versus native OpenMM','',
  'Generated from hash-verified immutable measurements by `build-stormm-report.mjs`.','',
  'The production browser worker is compared directly against independently constructed',
  'native OpenMM 8.2 Reference Systems—not transitively through the WASM bridge.',
  'Every supported case includes its potential energy and all 3N Cartesian forces.','',
  '## Agreement and explicit coverage','',
  'The full packet has 47 cases: **22 supported; 25 unsupported**. The latter require',
  'nonzero cutoffs and/or more than 512 atoms per replica. They remain in every raw',
  'result, with reasons. No cutoff was dropped and no smaller molecule substituted.','',
  'This gate uses **original inputs** and the unchanged accuracy tolerances in',
  '[protocol.json](../protocol.json). It is not the direct-worker f32-nm packed-input',
  'gate; STORMM uses Å/kcal packing and fixed-point accumulation. A supported-subset',
  'pass is never a full-47 or arbitrary-System certification. Static scoring does',
  'not apply constraint projection to the supplied pose.','',
  '| Hardware | Supported cases passing | Unsupported | Largest force relative RMS |',
  '| --- | ---: | ---: | ---: |'];
for(const row of rows)lines.push(`| ${row.label} | ${row.score.gate.passedCases}/22 | 25 | ${Math.max(...row.score.cases.filter(c=>c.supported).map(c=>c.originalInputAgreement?.forceRelativeRms||0)).toExponential(3)} |`);
lines.push('','Per-case pass/fail remains authoritative, including both 500 Å Trp-cage translation',
  'stress cases. Coverage is smaller than the direct-worker panel, so these counts',
  'must not be presented as a comparison of overall engine accuracy.','',
  '## Single-replica production-job speed','',
  'Median ns/day [P05–P95] from five measured repetitions, at least two seconds per',
  'sample after warm-up; 250 steps/job, 1 fs, 300 K, friction 1/ps, two endpoints.',
  'Each job constructs a fresh one-replica engine and includes transfer and endpoint',
  'readback. STORMM retains its production seeded 0.02 Å initial-coordinate jitter.',
  'These are not kernel-only measurements, aggregate ensemble throughput, or a',
  'matched OpenMM resident-Context speedup.','',
  `| Workload | ${rows.map(r=>r.label).join(' | ')} |`,
  `| --- | ${rows.map(()=>'---:').join(' | ')} |`);
for(const id of ['trpcage-original-vacuum','trpcage-original-obc2','trpcage-hbonds-obc2']) {
  lines.push(`| ${id} | ${rows.map(row=>{
    const p=row.actual.cases.find(c=>c.id===id)?.performance?.dynamics;
    if(!p)return 'not measured';
    if(p.samples.length!==5)throw new Error('Headline requires five samples');
    const s=summarize(p.samples.map(s=>s.nsPerDay));
    return `${s.median.toFixed(1)} [${s.p05.toFixed(1)}–${s.p95.toFixed(1)}]`;
  }).join(' | ')} |`);
}
lines.push('','## Evidence and remaining work','',
  ...rows.map(row=>`- ${row.label}: [manifest and raw vectors/timing samples](${row.directory}/manifest.json).`),
  '- [Direct-worker/native baselines](README.md) retain distinct timing boundaries.',
  '- The bundled WASM oracle remains a portable diagnostic; its historical five-pose native check does not cover every option.',
  '- Multi-replica sweeps, matched native ensemble strategies, third-vendor measurements, and long-time ensemble validation remain open.','');
const text=lines.join('\n'),output=new URL('STORMM.md',base);
if(process.argv.includes('--check')) {
  if(readFileSync(output,'utf8')!==text)throw new Error('STORMM results report is stale');
}else {writeFileSync(output,text);console.log(`Generated ${output.pathname}`);}
