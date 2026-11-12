import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.argv[2]??join(root,'folding/comparison/inputs'));
const file='reviews/library-cofolding-2026-11-12/library-48/library-1.json';
const bytes=await readFile(join(root,file)),library=JSON.parse(bytes);
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifest={schema:'molarium.native-cofold-comparison.v1',source:{file,sha256:sha(bytes),runId:library.run.id},
  purpose:'Compare the completed 48-pose browser library with independent native inference. These arbitrary protein–ligand pairs have no experimental bound-pose answers.',
  native:{openfold3:{version:'0.5.1',revision:'795e45b03924a8f8ffc72ae50298bd113530b9d3',checkpoint:'of3-ob-2025-06-30-174k.pt'},boltz2:{version:'2.2.1'}},
  caveats:['The browser uses int5 weights; native checkpoints are unquantized.',
    'Browser default sampler is exponential/geometric; native diffusion sampling is its own default.',
    'Equal seed integers do not produce equal random draws across implementations. Report seed-paired and ensemble pose differences.',
    'The low-step native control matches step/recycle counts, not every numerical input. It is not a fixed-tensor parity test.',
    'No MSA search or templates in this comparison, matching the existing browser inputs. Native standard uses standard sampling effort but still single-sequence input.'],
  sequence:library.run.request.sequence,seeds:[0,1,2],compounds:library.run.compounds,
  browser:library.poses.map(p=>({id:p.id,compoundId:p.compoundId,seed:p.seed,
    request:p.result.provenance.request,outputPdbSha256:p.result.provenance.outputPdbSha256})),
  protocols:{'low-step':{steps:25,recycles:2,precision:'32-true'},standard:{steps:200,recycles:3,precision:'bf16-mixed'},
    'torch-reference':{steps:25,recycles:2,precision:'32-true',kernelBackend:'upstream PyTorch dense'}}};
await mkdir(dirname(out),{recursive:true});await mkdir(out);
await writeFile(join(out,'comparison.json'),JSON.stringify(manifest,null,2)+'\n');
const queries={};for(const [i,c]of manifest.compounds.entries())queries[`compound_${String(i).padStart(3,'0')}`]={chains:[
  {molecule_type:'protein',chain_ids:['A'],sequence:manifest.sequence},{molecule_type:'ligand',chain_ids:['B'],smiles:c.smiles}],use_msas:false};
await writeFile(join(out,'openbind-query.json'),JSON.stringify({queries},null,2)+'\n');
const boltz=join(out,'boltz');await mkdir(boltz,{recursive:true});
for(const [i,c]of manifest.compounds.entries())await writeFile(join(boltz,`compound_${String(i).padStart(3,'0')}.yaml`),JSON.stringify({version:1,sequences:[
  {protein:{id:'A',sequence:manifest.sequence,msa:'empty'}},{ligand:{id:'B',smiles:c.smiles}}]},null,2)+'\n');
for(const [name,p]of Object.entries(manifest.protocols))await writeFile(join(out,`openbind-${name}.yaml`),JSON.stringify({
  data_module_args:{num_workers:0,num_workers_validation:0},
  experiment_settings:{seeds:manifest.seeds},pl_trainer_args:{devices:1,num_nodes:1,precision:p.precision},
  model_update:{presets:['predict'],custom:{architecture:{shared:{num_recycles:p.recycles,diffusion:{no_full_rollout_steps:p.steps}}},
    ...(name==='torch-reference'?{settings:{memory:{eval:{use_triton_triangle_kernels:false}}}}:{})}},
  output_writer_settings:{write_full_confidence_scores:false}},null,2)+'\n');
console.log(JSON.stringify({out,compounds:manifest.compounds.length,seeds:manifest.seeds,sourceSha256:manifest.source.sha256}));
