import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function writeNativeInputs(manifest,out){
const alignment=manifest.alignment;
if(alignment){
  const rows=alignment.a3m.split(/^>/m).slice(1).map(b=>b.split(/\r?\n/).slice(1).join('').replace(/[a-z\s]/g,''));
  if(!rows.length||rows[0]!==manifest.sequence||rows.some(r=>r.length!==manifest.sequence.length||!/^[A-Z-]+$/.test(r)))
    throw Error('Provided native A3M query, row lengths or alphabet differ');
  if(createHash('sha256').update(alignment.a3m).digest('hex')!==alignment.sha256)throw Error('Provided native A3M hash mismatch');
}
await mkdir(dirname(out),{recursive:true});await mkdir(out);
await writeFile(join(out,'comparison.json'),JSON.stringify(manifest,null,2)+'\n');
if(alignment){await mkdir(join(out,'msa'));await writeFile(join(out,'msa/colabfold_main.a3m'),alignment.a3m);}
const queries={};for(const [i,c]of manifest.compounds.entries())queries[`compound_${String(i).padStart(3,'0')}`]={chains:[
  {molecule_type:'protein',chain_ids:['A'],sequence:manifest.sequence,...(alignment?{main_msa_file_paths:['msa/colabfold_main.a3m']}:{})},
  {molecule_type:'ligand',chain_ids:['B'],smiles:c.smiles}],use_msas:Boolean(alignment),...(alignment?{use_paired_msas:false}:{})};
await writeFile(join(out,'openbind-query.json'),JSON.stringify({queries},null,2)+'\n');
const boltz=join(out,'boltz');await mkdir(boltz,{recursive:true});
for(const [i,c]of manifest.compounds.entries())await writeFile(join(boltz,`compound_${String(i).padStart(3,'0')}.yaml`),JSON.stringify({version:1,sequences:[
  {protein:{id:'A',sequence:manifest.sequence,msa:alignment?'msa/colabfold_main.a3m':'empty'}},{ligand:{id:'B',smiles:c.smiles}}]},null,2)+'\n');
for(const [name,p]of Object.entries(manifest.protocols))await writeFile(join(out,`openbind-${name}.yaml`),JSON.stringify({
  data_module_args:{num_workers:0,num_workers_validation:0},
  experiment_settings:{seeds:manifest.seeds},pl_trainer_args:{devices:1,num_nodes:1,precision:p.precision},
  model_update:{presets:['predict'],custom:{architecture:{shared:{num_recycles:p.recycles,diffusion:{no_full_rollout_steps:p.steps}}},
    ...(p.kernelBackend?{settings:{memory:{eval:{use_triton_triangle_kernels:false}}}}:{})}},
  output_writer_settings:{write_full_confidence_scores:false}},null,2)+'\n');
}

async function main(){
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
    'torch-reference':{steps:25,recycles:2,precision:'32-true',kernelBackend:'upstream PyTorch dense'},
    'torch-standard':{steps:200,recycles:3,precision:'32-true',kernelBackend:'upstream PyTorch dense'}}};
await writeNativeInputs(manifest,out);
console.log(JSON.stringify({out,compounds:manifest.compounds.length,seeds:manifest.seeds,sourceSha256:manifest.source.sha256}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
