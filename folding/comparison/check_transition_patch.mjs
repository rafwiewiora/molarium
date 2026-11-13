// Reuse exact GPU evidence by checking the directly generated shader bytes.
// The original source snapshot is pinned independently of the patched receipt.
import {readFile,writeFile}from'node:fs/promises';
import {resolve,join}from'node:path';
import {pathToFileURL}from'node:url';
import {createHash}from'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function verifyTransitionPatch(root=resolve(import.meta.dirname,'../..')){
 const vendor=join(root,'vendor/localfold'),patchRoot=join(root,'scripts/localfold-patches'),url=pathToFileURL(join(vendor,'webgpu/af3/trunk/transition.js'));
 const declaration=JSON.parse(await readFile(join(patchRoot,'manifest.json'))),patch=declaration.patches[0];
 if(declaration.patches.length!==1||patch.mode!=='shifted-fast')throw Error('Unexpected transition patch declaration');
 const snapshot=await readFile(join(patchRoot,patch.upstreamSnapshot),'utf8'),modified=await readFile(url);
 if(sha(snapshot)!==patch.upstreamSha256||sha(modified)!==patch.sha256||sha(await readFile(join(patchRoot,patch.patchFile)))!==patch.patchSha256)throw Error('Transition patch source hash mismatch');
 const receipt=JSON.parse(await readFile(join(vendor,'UPSTREAM.json')));
 const reportBytes=await readFile(join(root,'reviews/cofold-layer-parity-2026-11-13/production/comparison.json')),report=JSON.parse(reportBytes);
 const fixtures=JSON.parse(await readFile(join(root,'reviews/cofold-layer-parity-2026-11-13/production/reference-manifest.json')));
 // Reconstruct the exact unmodified receipt used by the observed GPU experiment.
 // This binds every other vendored file to that independently recorded pin too.
 const baseReceipt={repository:receipt.repository,revision:receipt.revision,files:receipt.files.map(r=>r.localPatch
  ?{path:r.path,bytes:r.upstreamBytes,sha256:r.upstreamSha256}:r)};
 const baseSha=sha(JSON.stringify(baseReceipt,null,2)+'\n');
 if(baseSha!==report.vendorReceiptSha256||receipt.revision!==declaration.revision)throw Error('Local patches do not reconstruct the measured upstream receipt');
 const portable=snapshot.replace(/(from\s+)(['"])(\.\.?\/[^'"]+)\2/g,(_m,p,q,s)=>p+q+new URL(s,url).href+q);
 const original=await import('data:text/javascript;base64,'+Buffer.from(portable).toString('base64'));
 const candidate=await import(url.href),cases=new Map(fixtures.cases.map(c=>[c.id,c]));
 const check=(a,b,label)=>{if(a!==b)throw Error('Generated shader mismatch: '+label);};
 let defaultConfigurations=0,directShaderHashes=0;const records=[];
 for(const r of report.records.filter(r=>r.shifted)){
  const c=cases.get(r.caseId),precision=c.precision==='f32'?'f32':'f16';
  const shape={...c.shape,weightPrecision:precision,stagePrecision:precision,residual:r.style==='fused-residual',rowRange:r.style==='fused-residual'};
  // Only lengths are needed for this pure shader/offset-table proof. The GPU
  // experiment and independent NumPy test cover the actual parameter values.
  const offsets=original.packTransitionWeights(Object.fromEntries(Object.entries(c.weights)
   .map(([k,v])=>[k,{length:fixtures.arrays[v].shape.reduce((a,b)=>a*b,1)}]))).offsets;
  const matrix={...r.actualMatrix};delete matrix.selectedByProduction;
  for(const mode of ['fast','two-pass']){
   if(r.style==='split'){
    const a=original.createTransitionSplitShaders(c.shape,offsets,c.epsilon,mode,{weightPrecision:precision,matrix});
    const b=candidate.createTransitionSplitShaders(c.shape,offsets,c.epsilon,mode,{weightPrecision:precision,matrix});
    for(const k of ['normalize','wide','down'])check(a[k],b[k],r.caseId+'/'+r.style+'/'+mode+'/'+k);
    check(JSON.stringify(a.tiles),JSON.stringify(b.tiles),'default split dispatch');check(a.storage,b.storage,'default split storage');
   }else check(original.createTransitionShader(shape,offsets,c.epsilon,mode),candidate.createTransitionShader(shape,offsets,c.epsilon,mode),r.caseId+'/'+r.style+'/'+mode);
   defaultConfigurations++;
  }
  if(r.style==='split'){
   const generated=candidate.createTransitionSplitShaders(c.shape,offsets,c.epsilon,'shifted-fast',{weightPrecision:precision,matrix});
   for(const [i,k]of ['normalize','wide','down'].entries()){check(sha(generated[k]),r.shaders[i].executedSha256,r.caseId+'/direct/'+k);directShaderHashes++;}
  }else{check(sha(candidate.createTransitionShader(shape,offsets,c.epsilon,'shifted-fast')),r.shaders[0].executedSha256,r.caseId+'/direct/'+r.style);directShaderHashes++;}
  records.push({caseId:r.caseId,style:r.style,directMode:'shifted-fast',matchesExecutedGpuShaders:true});
 }
 return {schema:'molarium.direct-transition-patch-proof.v1',scope:'Opt-in direct generators. Default shader bytes unchanged; new shader bytes match the exact measured component evidence. No full-model or NVIDIA matrix qualification claim.',
  upstreamRevision:declaration.revision,originalReceiptSha256:baseSha,originalSha256:patch.upstreamSha256,patchedSha256:patch.sha256,patchSha256:patch.patchSha256,
  comparisonSha256:sha(reportBytes),checkerSha256:sha(await readFile(new URL(import.meta.url))),defaultConfigurations,directShaderHashes,records};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const result=await verifyTransitionPatch();if(process.argv[2])await writeFile(resolve(process.argv[2]),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({defaultConfigurations:result.defaultConfigurations,directShaderHashes:result.directShaderHashes,configurations:result.records.length}));
}
