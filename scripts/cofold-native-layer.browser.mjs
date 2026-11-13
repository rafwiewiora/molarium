// Independent official-CPU versus unchanged LocalFold WebGPU layer probe.
// Run after long inference has stopped; this is not a full-model parity test.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join,extname,basename,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {sourceWebFiles} from './web-source-files.mjs';
import {startMolariumBrowser,waitFor} from './headless-chrome.mjs';
const [fixtures,output,f64Fixtures]=process.argv.slice(2);if(!output)throw Error('Usage: official-fixture-directory report.json [official-f64-directory]');
const root=resolve(import.meta.dirname,'..'),allowed=new Set(await sourceWebFiles(root));
const manifestBytes=await readFile(join(fixtures,'manifest.json')),manifest=JSON.parse(manifestBytes);
const blob=await readFile(join(fixtures,manifest.blob.file));
const hash=b=>createHash('sha256').update(b).digest('hex');
if(hash(blob)!==manifest.blob.sha256)throw Error('Official fixture blob hash mismatch');
const f64ManifestBytes=f64Fixtures?await readFile(join(f64Fixtures,'manifest.json')):null;
const f64Manifest=f64ManifestBytes?JSON.parse(f64ManifestBytes):null;
const f64Blob=f64Manifest?await readFile(join(f64Fixtures,f64Manifest.blob.file)):null;
if(f64Manifest&&(f64Manifest.originalManifestSha256!==hash(manifestBytes)||hash(f64Blob)!==f64Manifest.blob.sha256))throw Error('FP64 reference source/hash mismatch');
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
  const path=new URL(req.url).pathname.slice(1);let body,type;
  if(!['GET','HEAD'].includes(req.method))return new Response('Method not allowed',{status:405});
  if(!path){body='<html><title>Official cofolding layer check</title><body>Fixed-input layer validation</body></html>';type='text/html';}
  else if(path==='fixture-manifest.json'){body=manifestBytes;type='application/json';}
  else if(path==='fixture-data.bin'){body=blob;type='application/octet-stream';}
  else if(path==='fixture-f64-manifest.json'&&f64Manifest){body=f64ManifestBytes;type='application/json';}
  else if(path==='fixture-f64-data.bin'&&f64Blob){body=f64Blob;type='application/octet-stream';}
  else if(allowed.has(path)){body=Bun.file(join(root,path));type=['.mjs','.js'].includes(extname(path))?'text/javascript':undefined;}
  else return new Response('Not a declared public file',{status:404});
  return new Response(body,{headers:{...(type?{'Content-Type':type}:{}),
    'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp',
    'Content-Security-Policy':"default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self' blob:"}});
}});
const b=await startMolariumBrowser({url:`http://127.0.0.1:${server.port}/`});
try{
 await waitFor(()=>b.evaluate(`location.origin===${JSON.stringify(`http://127.0.0.1:${server.port}`)}&&document.readyState==='complete'`),20000,'fixture page navigation');
 const report=await b.evaluate(`(async()=>{
   const {getDevice}=await import(new URL('/vendor/localfold/web/model.js',location.href).href);
   const {Af3TransitionGpu}=await import(new URL('/vendor/localfold/webgpu/af3/trunk/transition.js',location.href).href);
   const manifest=await(await fetch('/fixture-manifest.json')).json(),bytes=await(await fetch('/fixture-data.bin')).arrayBuffer();
   const f64Manifest=${Boolean(f64Manifest)}?await(await fetch('/fixture-f64-manifest.json')).json():null;
   const f64Bytes=f64Manifest?await(await fetch('/fixture-f64-data.bin')).arrayBuffer():null;
   const array=name=>{const d=manifest.arrays[name];return new Float32Array(bytes,d.byteOffset,d.bytes/4);};
   const device=await getDevice(),kernel=new Af3TransitionGpu(device),records=[],shaderEdits=[],rawOutputs=[];
   const pipelines=kernel.pipelines;
   for(const c of manifest.cases){
     const input=array(c.input),expected=array(c.expected),weights=Object.fromEntries(Object.entries(c.weights).map(([k,v])=>[k,array(v)]));
     for(const variance of ['fast','two-pass','shifted-fast','shifted-two-pass']){
       // Diagnostic only: translate each row by its first channel before the
       // existing normalization arithmetic. Never changes production/vendor code.
       const shifted=variance.startsWith('shifted-');
       kernel.pipelines={get:async(key,source)=>{
         if(!shifted)return pipelines.get(key,source);
         let replacements=0;
         const translated=source.replace(/input\\[(base_\\d+(?:_\\d+)?|row\\d+ \\* CHANNELS) \\+ (c(?:_ln_\\d+)?)\\]/g,
           (all,base)=>{replacements++;return '('+all+' - input['+base+'])';});
         if(!replacements)throw Error('Pinned shader no longer matches shifted-normalization diagnostic');
         const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
         shaderEdits.push({caseId:c.id,variance,replacements,originalSha256:await digest(source),translatedSha256:await digest(translated)});
         return pipelines.get(key+':molarium-shifted-diagnostic',translated);
       }};
       const actual=(await kernel.run(input,c.shape,weights,{epsilon:c.epsilon,variance:variance.replace('shifted-','')})).output;
       const raw=new Uint8Array(actual.buffer,actual.byteOffset,actual.byteLength),chunks=[];
       for(let i=0;i<raw.length;i+=8192)chunks.push(String.fromCharCode(...raw.subarray(i,i+8192)));
       rawOutputs.push({caseId:c.id,variance,base64:btoa(chunks.join(''))});
       let difference=0,reference=0,maxAbs=0,finite=true;
       for(let i=0;i<expected.length;i++){
         if(!Number.isFinite(actual[i])){finite=false;continue;}
         const d=actual[i]-expected[i];difference+=d*d;reference+=expected[i]*expected[i];maxAbs=Math.max(maxAbs,Math.abs(d));
       }
       const relativeRms=finite?Math.sqrt(difference/reference):null;
       let againstF64=null;
       if(f64Manifest){const d=f64Manifest.records.find(r=>r.caseId===c.id),expected64=new Float64Array(f64Bytes,d.byteOffset,d.bytes/8);
         let error=0,scale=0,maximum=0;
         for(let i=0;i<expected64.length;i++){const delta=actual[i]-expected64[i];error+=delta*delta;scale+=expected64[i]*expected64[i];maximum=Math.max(maximum,Math.abs(delta));}
         againstF64={relativeRms:finite?Math.sqrt(error/scale):null,maxAbs:finite?maximum:null,nativeF32vsF64:d.nativeF32vsF64};}
       records.push({caseId:c.id,shape:c.shape,variance,finite,relativeRms,maxAbs:finite?maxAbs:null,
         ...(againstF64?{againstF64}:{}),
         passesOrdinaryF32Gate:finite&&relativeRms<=1e-4&&maxAbs<=2e-4,
         stressDiagnostic:c.id.includes('near-constant')});
     }
   }
   const adapter=await navigator.gpu.requestAdapter();return {records,shaderEdits,rawOutputs,adapter:adapter?.info?{
     vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description}:null,
     userAgent:navigator.userAgent};
 })()`);
 const {rawOutputs,...measured}=report,outputParts=[];let offset=0;
 const outputRecords=rawOutputs.map(r=>{const bytes=Buffer.from(r.base64,'base64'),entry={caseId:r.caseId,variance:r.variance,byteOffset:offset,bytes:bytes.length,sha256:hash(bytes)};
   outputParts.push(bytes);offset+=bytes.length;return entry;});
 const outputFile=basename(output).replace(/\.json$/,'')+'.outputs.bin',outputBlob=Buffer.concat(outputParts);
 await writeFile(join(dirname(output),outputFile),outputBlob);
 const result={schema:'molarium.official-layer-comparison.v1',scope:manifest.scope,
   runnerSha256:hash(await readFile(new URL(import.meta.url))),
   vendorReceiptSha256:hash(await readFile(join(root,'vendor/localfold/UPSTREAM.json'))),
   transitionSourceSha256:hash(await readFile(join(root,'vendor/localfold/webgpu/af3/trunk/transition.js'))),
   outputs:{file:outputFile,bytes:outputBlob.length,sha256:hash(outputBlob),encoding:'IEEE754 float32 little-endian, including original nonfinite values',records:outputRecords},
   manifestSha256:hash(manifestBytes),blobSha256:hash(blob),officialEnvironment:manifest.environment,
   ...(f64ManifestBytes?{f64ManifestSha256:hash(f64ManifestBytes)}:{}),
   browserImplementation:'Pinned LocalFold Af3TransitionGpu.run, FP32 fixture weights. Modes prefixed shifted- modify only the generated diagnostic shader by subtracting each row first channel before normalization; production/vendor source is unchanged. Trained int5 execution is a separate question.',
   tolerance:{ordinaryRelativeRms:1e-4,ordinaryMaxAbs:2e-4,stress:'Same metrics recorded; near-constant stress failures remain explicit and require diagnosis.'},...measured};
 await writeFile(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
 if(report.records.some(r=>!r.stressDiagnostic&&!r.passesOrdinaryF32Gate))process.exitCode=1;
}finally{await b.close();server.stop(true);}
