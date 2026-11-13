import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeNativeInputs} from './prepare-native.mjs';
test('provided native alignments preserve exact bytes and enable both official model inputs',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'molarium-native-msa-'));
  const a3m='>query\nACDE\n>homologue\nACdDE\n';
  const manifest={sequence:'ACDE',seeds:[0,1,2],compounds:[{id:'test',smiles:'CCO'}],
    alignment:{a3m,sha256:createHash('sha256').update(a3m).digest('hex')},protocols:{standard:{steps:200,recycles:3,precision:'bf16-mixed'}}};
  try{
    const out=join(dir,'inputs');await writeNativeInputs(manifest,out);
    assert.equal(await readFile(join(out,'msa/colabfold_main.a3m'),'utf8'),a3m);
    const query=JSON.parse(await readFile(join(out,'openbind-query.json'))).queries.compound_000;
    assert.equal(query.use_msas,true);assert.equal(query.use_paired_msas,false);
    assert.deepEqual(query.chains[0].main_msa_file_paths,['msa/colabfold_main.a3m']);
    const yaml=JSON.parse(await readFile(join(out,'boltz/compound_000.yaml')));
    assert.equal(yaml.sequences[0].protein.msa,'msa/colabfold_main.a3m');
    await assert.rejects(writeNativeInputs({...manifest,sequence:'AAAA'},join(dir,'wrong-query')),/query/);
    await assert.rejects(writeNativeInputs({...manifest,alignment:{...manifest.alignment,sha256:'0'.repeat(64)}},join(dir,'wrong-hash')),/hash/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('native inputs retain literal seeds, official config nesting and accepted file suffixes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'molarium-native-inputs-')),out=join(dir,'inputs');
  try{
    execFileSync(process.execPath,[new URL('./prepare-native.mjs',import.meta.url).pathname,out]);
    const spec=JSON.parse(await readFile(join(out,'comparison.json'),'utf8'));
    assert.equal(spec.source.sha256,'35fedd547dd342b0bdc1b2fa192338074a1751fa8be4cae8addf30355052e3b9');
    assert.equal(spec.compounds.length,16);assert.deepEqual(spec.seeds,[0,1,2]);
    for(const protocol of ['low-step','standard','torch-reference','torch-standard']){
      const standard=protocol.endsWith('standard');
      const runner=JSON.parse(await readFile(join(out,`openbind-${protocol}.yaml`),'utf8'));
      assert.deepEqual(runner.experiment_settings.seeds,[0,1,2]);
      assert.equal(runner.pl_trainer_args.enable_progress_bar??true,true,'upstream installs a progress callback');
      assert.equal(runner.data_module_args.num_workers,0,'respect the small host memory/CPU grant instead of spawning ten data workers');
      assert.equal(runner.model_update.custom.architecture.shared.diffusion.no_full_rollout_steps,standard?200:25);
      assert.equal(runner.model_update.custom.architecture.shared.num_recycles,standard?3:2);
    }
    const files=await readdir(join(out,'boltz'));assert.equal(files.length,16);assert.ok(files.every(f=>f.endsWith('.yaml')));
    assert.throws(()=>execFileSync(process.execPath,[new URL('./prepare-native.mjs',import.meta.url).pathname,out],{stdio:'pipe'}));
    assert.deepEqual(JSON.parse(await readFile(join(out,'comparison.json'),'utf8')),spec,'consumed input directory cannot be overwritten');
  }finally{await rm(dir,{recursive:true,force:true});}
});
