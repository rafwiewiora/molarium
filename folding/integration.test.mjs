import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {foldingRequest,installFoldLigand,LOCALFOLD_REVISION,validateFoldComponent,COFOLD_FAMILIES} from './request.mjs';
import {createChemistActionsApi} from '../chemist-actions.mjs';
import {smilesComponent} from '../vendor/localfold/shared/chem/component.js';
import {af3BatchFromA3m} from '../vendor/localfold/shared/af3/featurise/batch.js';
import {featuriserDialect,OPENBIND0} from '../vendor/localfold/shared/af3/dialect.js';
test('dynamic protein requests, legacy bounds and explicit ligand modality',()=>{
  assert.equal(foldingRequest({sequence:'>query\n'+'A'.repeat(129)}).sequence.length,129);
  assert.throws(()=>foldingRequest({model:'openfold',msaMode:'search',sequence:'A'.repeat(129)}),/128/);
  assert.throws(()=>foldingRequest({sequence:'ACD',ligand:{type:'smiles',value:'CCO'}}),/OpenBind/);
  assert.throws(()=>foldingRequest({sequence:'ACD',recycles:-1}),/Recycles/);
  assert.throws(()=>foldingRequest({sequence:'ACD',steps:0}),/steps/);
  assert.throws(()=>foldingRequest({sequence:'ACD',seed:0.1}),/Seed/);
  assert.throws(()=>foldingRequest({sequence:'ACD',msaMode:'search',msaEndpoint:'http://example.org'}),/HTTPS/);
  assert.throws(()=>foldingRequest({sequence:'ACD',msaMode:'provided'}),/A3M/);
  assert.throws(()=>foldingRequest({sequence:'>A\nACD\n>B\nEFG'}),/one protein chain/);
});
test('exact ligand mapping restores aromaticity and charge independent of coordinates',async()=>{
  const component=await smilesComponent('c1ccccc1C(=O)[O-]',{code:'LIG'});
  const {ELEMENT_SYMBOLS}=await import('../vendor/localfold/shared/af3/featurise/ccd-component.js');
  const molecule={atoms:component.atoms.map((a,i)=>({record:'HETATM',chain:'B',atomName:a.name,
    element:ELEMENT_SYMBOLS[a.element-1],x:i*20,y:0,z:0})),bonds:[]};
  const coordinates=structuredClone(molecule.atoms);
  installFoldLigand(molecule,component);
  assert.equal(molecule.bonds.length,component.bonds.length);
  assert.ok(molecule.bonds.some(b=>b.aromatic&&b.order===1.5));
  assert.equal(molecule.atoms.reduce((s,a)=>s+a.formalCharge,0),-1);
  assert.deepEqual(molecule.atoms.map(a=>[a.x,a.y,a.z]),coordinates.map(a=>[a.x,a.y,a.z]));
  const bad=structuredClone(molecule);bad.atoms[0].atomName='not-an-input-atom';
  assert.throws(()=>installFoldLigand(bad,component),/Missing/);
  const wrong=structuredClone(molecule);wrong.atoms[0].element='N';
  assert.throws(()=>installFoldLigand(wrong,component),/element differs/);
});
test('OpenBind featurisation contains real ligand atoms and bonds',async()=>{
  const ligand=await smilesComponent('CCO',{code:'LIG'});
  const {batch}=af3BatchFromA3m('ACDE',null,{ligands:[ligand],seed:0,...featuriserDialect(OPENBIND0)});
  assert.equal(batch.tokens,7,'four protein residues plus three atomised ligand tokens');
  assert.ok(batch.atomCount>ligand.atoms.length);
});
test('Boltz-2 selects its own feature dialect and immutable weight bundle',async()=>{
  const {BOLTZ2}=await import('../vendor/localfold/shared/af3/dialect.js');
  const {MODEL_BUNDLES,loadManifest}=await import('../vendor/localfold/shared/bundles/manifests/index.js');
  const request=foldingRequest({model:'localfold-boltz2',sequence:'ACDE',ligand:{type:'smiles',value:'CCO'}});
  const component=await smilesComponent(request.ligand.value,{code:'LIG'});
  const {batch}=af3BatchFromA3m(request.sequence,null,{ligands:[component],seed:0,...featuriserDialect(BOLTZ2)});
  assert.equal(COFOLD_FAMILIES[request.model],'boltz2');assert.equal(batch.tokens,7);
  assert.equal(BOLTZ2.msaDoubleAddPair,true);assert.equal(BOLTZ2.realignSampler,true);
  assert.notEqual(MODEL_BUNDLES.boltz2.remote,MODEL_BUNDLES.openbind0.remote);
  assert.equal((await loadManifest('boltz2')).model.name,'boltz2');
});
test('oversized and disconnected ligand graphs reject before conformer generation',()=>{
  assert.throws(()=>validateFoldComponent({atoms:Array(151).fill({}),bonds:[]}),/150/);
  assert.throws(()=>validateFoldComponent({atoms:[{},{}],bonds:[]}),/connected/);
  assert.doesNotThrow(()=>validateFoldComponent({atoms:[{},{}],bonds:[{from:0,to:1}]}));
});
test('vendored module bytes match the pinned upstream receipt',async()=>{
  const base=new URL('../vendor/localfold/',import.meta.url);
  const receipt=JSON.parse(await readFile(new URL('UPSTREAM.json',base)));
  assert.equal(receipt.revision,LOCALFOLD_REVISION);
  assert.ok(receipt.files.length>100);
  for(const entry of receipt.files){
    const bytes=await readFile(new URL(entry.path,base));
    assert.equal(bytes.length,entry.bytes,entry.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,entry.path);
  }
});
test('cancel prediction reaches a pending action while ordinary actions remain queued',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});const calls=[];
  const api=createChemistActionsApi({enabledActions:['protein.predict','protein.cancelPrediction','session.inspect'],
    routes:{'protein.predict':async()=>{calls.push('predict');await pending;return {};},
    'protein.cancelPrediction':async()=>{calls.push('cancel');release();return {requested:true};},
    'session.inspect':async()=>{calls.push('inspect');return {};}}});
  const prediction=api.execute({action:'protein.predict'});
  const inspect=api.execute({action:'session.inspect'});
  await Promise.resolve();
  const cancelled=await api.execute({action:'protein.cancelPrediction'});
  assert.equal(cancelled.result.requested,true);
  await prediction;await inspect;
  assert.deepEqual(calls,['predict','cancel','inspect']);
});
