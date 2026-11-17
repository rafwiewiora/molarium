// Compare saved native weights with the pinned shipped bundle; zero model calls.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,mkdir,open,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {MANIFEST} from '../../vendor/localfold/shared/bundles/manifests/openbind0.js';
import {readTensor,tensorElements} from '../../vendor/localfold/shared/weights/dtype.js';

export const sha256 = raw => createHash('sha256').update(raw).digest('hex');
export function requireDigest(raw,expected,label) {
  if(sha256(raw)!==expected)throw Error('Changed bytes: '+label);
}
export function sharedTable(native,stock) {
  const entries=Object.entries(native.tensors);
  if(!entries.length)throw Error('Empty native weight table');
  for(const[name,t]of entries){
    const s=stock.tensors[name];
    if(!s||JSON.stringify(s.shape)!==JSON.stringify(t.shape))throw Error('Missing or mismatched shape: '+name);
    if(t.dtype!=='float32'||t.bytes!==tensorElements(s)*4)throw Error('Invalid native representation: '+name);
    if(!['float32','int5'].includes(s.dtype))throw Error('Unplanned stock representation: '+name);
  }
  return entries;
}
export function compareWeights(native,stored) {
  if(native.length!==stored.length||native.length===0)throw Error('Invalid weight vector lengths');
  let referenceSquares=0,errorSquares=0,maxAbs=0,maximumIndex=0,differentValues=0,differentBits=0;
  const nBits=new Uint32Array(native.buffer,native.byteOffset,native.length);
  const sBits=new Uint32Array(stored.buffer,stored.byteOffset,stored.length);
  for(let i=0;i<native.length;i++){
    const n=native[i],s=stored[i];
    if(!Number.isFinite(n)||!Number.isFinite(s))throw Error('Non-finite weight at '+i);
    const difference=Math.abs(n-s);referenceSquares+=n*n;errorSquares+=difference*difference;
    if(difference>maxAbs){maxAbs=difference;maximumIndex=i;}
    if(n!==s)differentValues++;
    if(nBits[i]!==sBits[i])differentBits++;
  }
  return {values:native.length,referenceSquares,errorSquares,
    referenceRms:Math.sqrt(referenceSquares/native.length),rmsError:Math.sqrt(errorSquares/native.length),
    relativeRms:referenceSquares?Math.sqrt(errorSquares/referenceSquares):errorSquares?null:0,
    maxAbs,differentValues,differentBits,maximumIndex,nativeAtMaximum:native[maximumIndex],storedAtMaximum:stored[maximumIndex]};
}
async function fileHash(path) {
  const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');
}
async function main(planFile,output) {
  if(!output)throw Error('Usage: node audit_shipped_trunk_weights.mjs PLAN_JSON NEW_OUTPUT_DIRECTORY');
  const planBytes=await readFile(planFile),plan=JSON.parse(planBytes);
  if(plan.schema!=='molarium.shipped-trunk-weight-plan.v1'||plan.newModelCalls!==0)throw Error('Wrong audit plan');
  const root=resolve(import.meta.dirname,'../..');
  for(const[name,digest]of Object.entries(plan.sourceFiles)){
    if(!name.startsWith('folding/comparison/')&&!name.startsWith('vendor/localfold/'))throw Error('Unexpected source path');
    if(await fileHash(join(root,name))!==digest)throw Error('Source changed: '+name);
  }
  const fixture=resolve(plan.fixture),nativeManifestBytes=await readFile(join(fixture,'weights.json'));
  requireDigest(nativeManifestBytes,plan.nativeWeightManifestSha256,'native weight table');
  requireDigest(await readFile(join(fixture,'receipt.json')),plan.fixtureReceiptSha256,'native fixture receipt');
  const nativeManifest=JSON.parse(nativeManifestBytes),entries=sharedTable(nativeManifest,MANIFEST);
  if(entries.length!==plan.expectedTensors)throw Error('Incomplete native tensor coverage');
  const nativePath=join(fixture,'weights.bin');
  if((await stat(nativePath)).size!==nativeManifest.blob.bytes||await fileHash(nativePath)!==nativeManifest.blob.sha256
     ||nativeManifest.blob.sha256!==plan.nativeWeightBlobSha256)throw Error('Native weights changed');
  if(!/^https:\/\/huggingface\.co\/sokrypton\/localfold\/resolve\/[a-f0-9]{40}\/openbind0-int5\/$/.test(plan.stockBaseUrl))throw Error('Stock URL must pin one immutable revision');
  await mkdir(output);await mkdir(join(output,'shards'));
  const needed=[...new Set(entries.map(([name])=>MANIFEST.tensors[name].file))].sort(),shards=[];
  for(const name of needed){
    if(!/^weights-\d\d\.int5\.bin$/.test(name)||!MANIFEST.shardDigests[name])throw Error('Unpinned shard');
    const url=new URL(name,plan.stockBaseUrl).href,response=await fetch(url);
    if(!response.ok)throw Error('Shard download failed: '+response.status+' '+name);
    const bytes=Buffer.from(await response.arrayBuffer());requireDigest(bytes,MANIFEST.shardDigests[name],name);
    await writeFile(join(output,'shards',name),bytes,{flag:'wx'});
    shards.push({file:name,bytes:bytes.length,sha256:sha256(bytes),url});
  }
  const records=[],handle=await open(nativePath,'r');
  try{
    for(const shard of shards){
      const raw=await readFile(join(output,'shards',shard.file));requireDigest(raw,shard.sha256,shard.file);
      const buffer=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
      for(const[name,t]of entries.filter(([name])=>MANIFEST.tensors[name].file===shard.file)){
        const s=MANIFEST.tensors[name],nativeRaw=Buffer.alloc(t.bytes);
        let offset=0;while(offset<t.bytes){const r=await handle.read(nativeRaw,offset,t.bytes-offset,t.byteOffset+offset);if(!r.bytesRead)throw Error('Short native tensor');offset+=r.bytesRead;}
        requireDigest(nativeRaw,t.sha256,name);
        const native=new Float32Array(nativeRaw.buffer,nativeRaw.byteOffset,t.bytes/4);
        const stored=readTensor(s,buffer,s.byteOffset),metrics=compareWeights(native,stored);
        records.push({name,shape:t.shape,stockDtype:s.dtype,shard:shard.file,nativeSha256:t.sha256,
          decodedStockSha256:sha256(new Uint8Array(stored.buffer,stored.byteOffset,stored.byteLength)),...metrics});
      }
    }
  }finally{await handle.close();}
  const byDtype={};
  for(const r of records){const a=byDtype[r.stockDtype]??={tensors:0,values:0,differentValues:0,differentBits:0,referenceSquares:0,errorSquares:0,maxAbs:0};
    for(const k of ['values','differentValues','differentBits','referenceSquares','errorSquares'])a[k]+=r[k];a.tensors++;a.maxAbs=Math.max(a.maxAbs,r.maxAbs);}
  for(const a of Object.values(byDtype))a.relativeRms=a.referenceSquares?Math.sqrt(a.errorSquares/a.referenceSquares):null;
  const report={schema:'molarium.shipped-trunk-weight-audit.v1',status:'complete',finishedAt:new Date().toISOString(),
    scope:plan.scope,planSha256:sha256(planBytes),nativeWeightBlobSha256:plan.nativeWeightBlobSha256,
    stockBaseUrl:plan.stockBaseUrl,allNativeTrunkTensorsCompared:true,tensors:records.length,byDtype,shards,records,
    newModelCalls:0,newNativeCaptureCalls:0,newConversions:0,localLaptopShardCopies:0,
    limitations:['Parameter comparison only; no network propagation or pose inference.',
      'Uses the actual host decoder; GPU int5 upload and half arithmetic are separate boundaries.',
      'No pass threshold is inferred for quantized weights. Exact re-encoding is checked separately.']};
  await writeFile(join(output,'analysis.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  await writeFile(join(output,'stock-manifest.json'),JSON.stringify(MANIFEST,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:report.status,tensors:report.tensors,byDtype}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  await main(...process.argv.slice(2));
}
