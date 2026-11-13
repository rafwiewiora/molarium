// Reconstruct the production shared JS features from a saved input component.
// No GPU, weights, conformer regeneration or model inference is involved.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {af3BatchFromA3m} from '../../vendor/localfold/shared/af3/featurise/batch.js';
import {OPENBIND0,featuriserDialect} from '../../vendor/localfold/shared/af3/dialect.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
const dtypes={Float32Array:'<f4',Float64Array:'<f8',Int8Array:'|i1',Uint8Array:'|u1',
  Int16Array:'<i2',Uint16Array:'<u2',Int32Array:'<i4',Uint32Array:'<u4',
  BigInt64Array:'<i8',BigUint64Array:'<u8',Uint8ClampedArray:'|u1'};

export async function freezeFeatures(batch,output){
  if(new Uint8Array(new Uint32Array([1]).buffer)[0]!==1)throw Error('Explicit little-endian host required');
  await mkdir(output);
  const chunks=[],arrays={},unsupported=[];let size=0;
  function visit(value,path){
    if(ArrayBuffer.isView(value)){
      const dtype=dtypes[value.constructor.name];if(!dtype)throw Error('Unknown numeric view '+value.constructor.name);
      const key=`array-${String(Object.keys(arrays).length).padStart(4,'0')}`;
      const padding=Buffer.alloc((8-size%8)%8);chunks.push(padding);size+=padding.length;
      const data=Buffer.from(new Uint8Array(value.buffer,value.byteOffset,value.byteLength));
      arrays[key]={path,shape:[value.length],dtype,byteOffset:size,bytes:data.length,sha256:sha(data)};
      if(value instanceof Float32Array||value instanceof Float64Array)
        arrays[key].nonFiniteValues=Array.from(value).filter(v=>!Number.isFinite(v)).length;
      chunks.push(data);size+=data.length;return {array:key};
    }
    if(Array.isArray(value))return {list:value.map((v,i)=>visit(v,path+'/'+i))};
    if(value&&Object.getPrototypeOf(value)===Object.prototype)
      return {dict:Object.entries(value).map(([k,v])=>[{value:k},visit(v,path+'/'+k)])};
    if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'){
      if(typeof value==='number'&&!Number.isFinite(value))return {nonFiniteScalar:String(value)};
      return {value};
    }
    if(typeof value==='bigint')return {bigint:value.toString()};
    if(value===undefined)return {undefined:true};
    const type=value?.constructor?.name??typeof value;
    unsupported.push({path,type});return {metadataObjectType:type};
  }
  const tree=visit(batch,'batch'),blob=Buffer.concat(chunks);
  const manifest={schema:'molarium.native-feature-capture.v1',
    scope:'Production shared JavaScript featurizer reconstructed from the saved input component; no model execution. Flat typed-array shapes retain the production batch scalar dimensions.',
    arrays,tree,unserializedMetadata:unsupported,
    blob:{file:'features.bin',bytes:blob.length,sha256:sha(blob)}};
  await writeFile(join(output,'features.bin'),blob);
  await writeFile(join(output,'features.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}

async function main(){
  const args=process.argv.slice(2);let library,output,seed=0;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--library')library=args[++i];
    else if(args[i]==='--output')output=args[++i];
    else if(args[i]==='--seed')seed=Number(args[++i]);
    else throw Error('Unknown argument '+args[i]);
  }
  if(!library||!output||!Number.isInteger(seed))throw Error('Provide --library, --output, and optional integer --seed');
  const bytes=await readFile(library),source=JSON.parse(bytes);
  const pose=source.poses.find(p=>p.seed===seed&&p.status==='complete');if(!pose)throw Error('Saved complete seed missing');
  const result=pose.result,request=result.provenance.request,component=result.component;
  if(request.model!=='localfold-openbind0'||request.seed!==seed)throw Error('This audit requires a saved OpenBind request');
  if(sha(JSON.stringify(component))!==result.provenance.ligandComponentSha256)throw Error('Saved input component changed');
  const alignment=result.provenance.alignment??source.run.alignment;
  if(sha(alignment)!==result.provenance.alignmentSha256)throw Error('Saved alignment changed');
  const {batch,rows}=af3BatchFromA3m(request.sequence,alignment,
    {seed,ligands:[component],...featuriserDialect(OPENBIND0)});
  const manifest=await freezeFeatures(batch,output);
  const root=resolve(dirname(new URL(import.meta.url).pathname),'../..');
  const sources={};
  for(const file of ['folding/comparison/capture-browser-features.mjs',
    'vendor/localfold/UPSTREAM.json','vendor/localfold/shared/af3/featurise/batch.js',
    'vendor/localfold/shared/af3/featurise/featurise.js','vendor/localfold/shared/af3/dialect.js'])
    sources[file]=sha(await readFile(join(root,file)));
  await writeFile(join(output,'receipt.json'),JSON.stringify({schema:'molarium.browser-feature-reconstruction.v1',
    scope:'Shared production featurizer, saved input conformer and alignment. This reconstructs features; it is not a historical live-tensor capture or a GPU/model test.',
    librarySha256:sha(bytes),inputComponentSha256:sha(JSON.stringify(component)),
    sequence:request.sequence,smiles:component.smiles,alignmentSha256:sha(alignment),seed,
    tokens:batch.tokens,dense:batch.dense,msaDepth:rows.depth,capturedArrays:Object.keys(manifest.arrays).length,
    sourceFiles:sources,outputs:{'features.json':sha(await readFile(join(output,'features.json'))),
      'features.bin':manifest.blob.sha256}},null,2)+'\n');
  console.log(JSON.stringify({arrays:Object.keys(manifest.arrays).length,tokens:batch.tokens,bytes:manifest.blob.bytes}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
