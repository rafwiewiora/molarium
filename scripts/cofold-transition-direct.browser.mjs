// Exercise the real Af3TransitionGpu.run opt-in, with no shader rewriting.
import {readFile,writeFile}from'node:fs/promises';
import {resolve,join,basename,dirname,extname}from'node:path';
import {createHash}from'node:crypto';
import {sourceWebFiles}from'./web-source-files.mjs';
import {startMolariumBrowser,waitFor}from'./headless-chrome.mjs';
const [originalDir,precisionDir,output]=process.argv.slice(2);if(!output)throw Error('Usage: original-FP32-directory precision-fixture-directory NEW-report.json');
try{await readFile(output);throw Error('Refusing to overwrite a prior measurement');}catch(e){if(e.code!=='ENOENT')throw e;}
const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex'),allowed=new Set(await sourceWebFiles(root));
const originalBytes=await readFile(join(originalDir,'manifest.json')),original=JSON.parse(originalBytes),originalBlob=await readFile(join(originalDir,original.blob.file));
const precisionBytes=await readFile(join(precisionDir,'manifest.json')),precision=JSON.parse(precisionBytes),precisionBlob=await readFile(join(precisionDir,precision.blob.file));
const comparisonBytes=await readFile(join(root,'reviews/cofold-layer-parity-2026-11-13/production/comparison.json'));
if(sha(originalBlob)!==original.blob.sha256||sha(precisionBlob)!==precision.blob.sha256||sha(originalBytes)!==precision.originalManifestSha256)throw Error('Fixture hash mismatch');
const files=new Map([['original.json',[originalBytes,'application/json']],['original.bin',[originalBlob,'application/octet-stream']],
 ['precision.json',[precisionBytes,'application/json']],['precision.bin',[precisionBlob,'application/octet-stream']],['comparison.json',[comparisonBytes,'application/json']]]);
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
 const path=new URL(req.url).pathname.slice(1);if(!['GET','HEAD'].includes(req.method))return new Response('Method not allowed',{status:405});
 let body,type;if(!path){body='<html><title>Direct transition mode</title></html>';type='text/html';}
 else if(files.has(path))[body,type]=files.get(path);
 else if(allowed.has(path)){body=Bun.file(join(root,path));type=['.js','.mjs'].includes(extname(path))?'text/javascript':undefined;}
 else return new Response('Not an allowed file',{status:404});
 return new Response(body,{headers:{...(type?{'Content-Type':type}:{}),'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp',
  'Content-Security-Policy':"default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self' blob:"}});
}});
const b=await startMolariumBrowser({url:`http://127.0.0.1:${server.port}/`});
try{
 await waitFor(()=>b.evaluate(`location.origin===${JSON.stringify(`http://127.0.0.1:${server.port}`)}&&document.readyState==='complete'`),20000,'direct test navigation');
 const measured=await b.evaluate(`(async()=>{
  const {getDevice}=await import('/vendor/localfold/web/model.js'),{Af3TransitionGpu}=await import('/vendor/localfold/webgpu/af3/trunk/transition.js');
  const original=await(await fetch('/original.json')).json(),p=await(await fetch('/precision.json')).json(),prior=await(await fetch('/comparison.json')).json();
  const oldBlob=await(await fetch('/original.bin')).arrayBuffer(),blob=await(await fetch('/precision.bin')).arrayBuffer();
  const array=(name,old=false)=>{const d=(old?original:p).arrays[name],T=old||d.dtype==='<f4'?Float32Array:Float64Array;return new T(old?oldBlob:blob,d.byteOffset,d.bytes/T.BYTES_PER_ELEMENT);};
  const device=await getDevice(),kernel=new Af3TransitionGpu(device),records=[],raw=[];
  for(const c of p.cases.filter(c=>c.precision==='f32')){
   const input=array(c.inputReference.array,c.inputReference.kind==='original'),expected=array(c.expectedF64),weights=Object.fromEntries(Object.entries(c.weights).map(([k,v])=>[k,array(v)]));
   const actual=(await kernel.run(input,c.shape,weights,{epsilon:c.epsilon,variance:'shifted-fast'})).output;
   const bytes=new Uint8Array(actual.buffer,actual.byteOffset,actual.byteLength),chunks=[];
   for(let i=0;i<bytes.length;i+=8192)chunks.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
   raw.push({caseId:c.id,base64:btoa(chunks.join(''))});
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   const previous=prior.outputs.records.find(r=>r.caseId===c.id&&r.style==='fused'&&r.shifted&&r.kind==='output');
   let error=0,scale=0,maxAbs=0,finite=true;for(let i=0;i<actual.length;i++){const d=actual[i]-expected[i];error+=d*d;scale+=expected[i]*expected[i];maxAbs=Math.max(maxAbs,Math.abs(d));finite&&=Number.isFinite(actual[i]);}
   const relativeRms=finite?Math.sqrt(error/scale):null;
   records.push({caseId:c.id,finite,relativeRms,maxAbs:finite?maxAbs:null,outputSha256:hash,priorOutputSha256:previous.sha256,
    exactPriorOutputMatch:hash===previous.sha256,passesF32Gate:finite&&relativeRms<=1e-4&&maxAbs<=2e-4});
  }
  const adapter=await navigator.gpu.requestAdapter();return {records,raw,userAgent:navigator.userAgent,
   adapter:adapter?.info?Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,adapter.info[k]])):null};
 })()`);
 const {raw,...report}=measured,parts=[];let offset=0;
 const records=raw.map(r=>{const bytes=Buffer.from(r.base64,'base64'),entry={caseId:r.caseId,byteOffset:offset,bytes:bytes.length,sha256:sha(bytes)};parts.push(bytes);offset+=bytes.length;return entry;});
 const blob=Buffer.concat(parts),file=basename(output).replace(/\.json$/,'')+'.outputs.bin';await writeFile(join(dirname(output),file),blob,{flag:'wx'});
 const result={schema:'molarium.direct-transition-entrypoint.v1',scope:'Actual Af3TransitionGpu.run with variance shifted-fast, no shader rewriting and no trained/full-model prediction.',
  sourceReceiptSha256:sha(await readFile(join(root,'vendor/localfold/UPSTREAM.json'))),transitionSourceSha256:sha(await readFile(join(root,'vendor/localfold/webgpu/af3/trunk/transition.js'))),
  runnerSha256:sha(await readFile(new URL(import.meta.url))),originalManifestSha256:sha(originalBytes),precisionManifestSha256:sha(precisionBytes),priorComparisonSha256:sha(comparisonBytes),
  outputs:{file,bytes:blob.length,sha256:sha(blob),records},...report};
 await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({cases:report.records.length,exactMatches:report.records.filter(r=>r.exactPriorOutputMatch).length,allPass:report.records.every(r=>r.passesF32Gate)}));
 if(report.records.length!==7||report.records.some(r=>!r.passesF32Gate||!r.exactPriorOutputMatch))process.exitCode=1;
}finally{await b.close();server.stop(true);}
