import {foldingRequest,LOCALFOLD_REVISION,FOLD_MODELS,validateFoldComponent} from './request.mjs';
import {ColabFoldMsaProvider} from '../openfold/msa-client.js';
const providers=new Map();
const check=signal=>{if(signal?.aborted)throw signal.reason??new DOMException('Aborted','AbortError');};
async function sha(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function predictLocalFold(input,{signal,onProgress=()=>{}}={}) {
  const totalStarted=performance.now();
  const request=foldingRequest(input);check(signal);
  if(request.model==='openfold')throw new Error('Use the legacy OpenFold backend for this request.');
  const modelOverride=typeof location==='undefined'?null:new URLSearchParams(location.search).get('model');
  if(request.model==='localfold-af2'&&modelOverride&&(modelOverride.includes('/')||modelOverride.endsWith('.json')))
    throw new Error('Remove the model URL override to use the pinned Molarium folding model.');
  let alignment=request.msaMode==='provided'?request.a3m:null;
  let msa={provider:request.msaMode};
  if(request.msaMode==='search'){
    if(!providers.has(request.msaEndpoint))providers.set(request.msaEndpoint,new ColabFoldMsaProvider({endpoint:request.msaEndpoint}));
    msa=await providers.get(request.msaEndpoint).search({entities:[{type:'protein',sequence:request.sequence}]},{signal,onProgress});
    alignment=`>query\n${request.sequence}\n`+msa.documents.join('\n').replaceAll('\0','\n');
  }
  // Validate query identity before allocating/downloads; preserve A3M insertion syntax.
  if(alignment){
    const query=alignment.split(/^>/m).find(s=>s.trim())?.split(/\r?\n/).slice(1).join('')
      .replace(/[a-z\s]/g,'');
    if(query!==request.sequence)throw new Error('The A3M query does not match the protein sequence.');
  }
  const {getDevice,loadModel}=await import('../vendor/localfold/web/model.js');
  const report=message=>onProgress({stage:'folding',message});
  const loading=p=>onProgress({stage:'model',message:`Loading ${FOLD_MODELS[request.model]} weights…`,...p});
  const device=await getDevice();check(signal);
  let started;let pdb,plddt,ptm,iptm,pae,component,msaDepth,geometry,meanPlddt,confidenceLayout;
  if(request.model==='localfold-af2'){
    const [{AlphaFoldMonomerGpu},{predictionToPdb}]=await Promise.all([
      import('../vendor/localfold/webgpu/af2/model/monomer.js'),
      import('../vendor/localfold/web/prediction-results.js')]);
    const model=await loadModel('msa',loading,signal,'monomer');check(signal);
    report('Folding protein with AlphaFold2…');
    started=performance.now();
    const result=await new AlphaFoldMonomerGpu(device).predictA3m(alignment??`>query\n${request.sequence}\n`,
      model.weights,model.featureTables,{recycles:request.recycles,randomSeed:request.seed,signal},model.paeBreaks,
      (_r,i)=>report(`AlphaFold2 pass ${i+1} complete`),
      p=>{check(signal);report(`AlphaFold2 · ${Math.round(100*p.completed/p.total)}%`);});
    const final=result.final;plddt=final.confidence.plddt;ptm=final.confidence.ptm;pae=final.confidence.predictedAlignedError;
    meanPlddt=final.confidence.meanPlddt;
    pdb=predictionToPdb(request.sequence,final.structure,plddt);
    confidenceLayout={plddt:'one value per protein residue',pae:'row-major residue pairs',tokens:request.sequence.length};
    msaDepth=alignment?alignment.split(/^>/m).length-1:1;
  } else {
    const [{loadAf3Weights},{af3BatchFromA3m},{featuriserDialect},{foldBatch,toPdb}]=await Promise.all([
      import('../vendor/localfold/web/af3-model.js'),
      import('../vendor/localfold/shared/af3/featurise/batch.js'),
      import('../vendor/localfold/shared/af3/dialect.js'),
      import('../vendor/localfold/webgpu/af3/fold.js')]);
    if(request.ligand){
      if(request.ligand.type==='smiles'){
        const {parseSmiles}=await import('../vendor/localfold/shared/chem/smiles.js');
        validateFoldComponent(parseSmiles(request.ligand.value));
        const {smilesComponent}=await import('../vendor/localfold/shared/chem/component.js');
        component=await smilesComponent(request.ligand.value,{code:'LIG',seed:request.seed});
      }else{
        const {ccdUrl,parseCcdComponent}=await import('../vendor/localfold/shared/af3/featurise/ccd-component.js');
        const response=await fetch(ccdUrl(request.ligand.value),{signal});
        if(!response.ok)throw new Error('CCD download failed: HTTP '+response.status);
        component=parseCcdComponent(await response.text());
      }
      validateFoldComponent(component);
    }
    const {withAbort}=await import('../vendor/localfold/webgpu/runtime/abort.js');
    const weights=await withAbort(loadAf3Weights(loading,'openbind0'),signal);check(signal);
    const {batch,rows}=af3BatchFromA3m(request.sequence,alignment,{seed:request.seed,
      ligands:component?[component]:[],...featuriserDialect(weights.trunk.dialect)});
    msaDepth=rows.depth;
    report('Folding with OpenBind-0…');
    started=performance.now();
    const result=await foldBatch(device,batch,weights,{steps:request.steps,recycles:request.recycles,seed:request.seed,
      onStage:async phase=>{check(signal);report('OpenBind-0 · '+phase);},
      onStep:async frame=>{check(signal);report(`OpenBind-0 · sampling ${frame.step}/${request.steps}`);}});
    check(signal);ptm=result.ptm;iptm=result.iptm;pae=result.scores?.pae;geometry=result.geometry;
    plddt=result.scores?.plddt;meanPlddt=result.meanPlddt;
    const {pdbSlots}=await import('../vendor/localfold/shared/af3/structure/pdb.js');
    confidenceLayout={plddt:'dense atom slots',pae:'row-major token pairs',tokens:batch.tokens,
      slotsPerToken:batch.dense,pdbAtoms:pdbSlots(batch)};
    pdb=toPdb(batch,result.positions,plddt,{remark:['OPENBIND-0 PREDICTION VIA LOCALFOLD / MOLARIUM','B-FACTOR IS pLDDT (0-100).']});
  }
  check(signal);
  const manifestModule=await import('../vendor/localfold/shared/bundles/manifests/index.js');
  const family=request.model==='localfold-af2'?'monomer':'openbind0';
  const manifest=await manifestModule.loadManifest(family);
  return {schema:'molarium.fold-result.v2',kind:'localfold',sequence:request.sequence,
    model:FOLD_MODELS[request.model],provider:'webgpu',recycles:request.recycles,msaDepth,
    pdb,plddt,meanPlddt,ptm,iptm,pae,component,geometry,confidenceLayout,elapsedMs:performance.now()-started,
    totalElapsedMs:performance.now()-totalStarted,
    provenance:{upstream:{repository:'https://github.com/sokrypton/localfold',revision:LOCALFOLD_REVISION},
      request,alignment,alignmentSha256:alignment?await sha(alignment):null,
      ligandComponentSha256:component?await sha(JSON.stringify(component)):null,
      modelManifestSha256:await sha(JSON.stringify(manifest)),
      modelBundle:{model:manifestModule.MODEL_BUNDLES[family].model,
        remote:manifestModule.MODEL_BUNDLES[family].remote,release:manifestModule.MODEL_BUNDLES[family].release},
      msa:{provider:msa.provider,endpoint:msa.endpoint??null,ticketId:msa.ticketId??null},
      outputPdbSha256:await sha(pdb),createdAt:new Date().toISOString()}};
}
