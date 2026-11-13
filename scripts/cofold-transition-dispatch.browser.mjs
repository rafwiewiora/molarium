// Repeated independent native rows expose width-dependent dispatch coverage.
import {readFile,writeFile}from'node:fs/promises';
import {resolve,join,basename,dirname,extname}from'node:path';
import {createHash}from'node:crypto';
import {sourceWebFiles}from'./web-source-files.mjs';
import {startMolariumBrowser,waitFor}from'./headless-chrome.mjs';
const [originalDir,precisionDir,output]=process.argv.slice(2);if(!output)throw Error('Usage: original-FP32-directory precision-fixture-directory NEW-report.json [--after-fix]');
try{await readFile(output);throw Error('Refusing to overwrite a prior measurement');}catch(e){if(e.code!=='ENOENT')throw e;}
const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex'),allowed=new Set(await sourceWebFiles(root));
const originalBytes=await readFile(join(originalDir,'manifest.json')),original=JSON.parse(originalBytes),originalBlob=await readFile(join(originalDir,original.blob.file));
const precisionBytes=await readFile(join(precisionDir,'manifest.json')),precision=JSON.parse(precisionBytes),precisionBlob=await readFile(join(precisionDir,precision.blob.file));
if(sha(originalBlob)!==original.blob.sha256||sha(precisionBlob)!==precision.blob.sha256||sha(originalBytes)!==precision.originalManifestSha256)throw Error('Fixture hash mismatch');
const baseline=await readFile(join(root,'scripts/localfold-patches/transition-5ea3d42c.upstream.txt'));
const files=new Map([['original.json',[originalBytes,'application/json']],['original.bin',[originalBlob,'application/octet-stream']],
 ['precision.json',[precisionBytes,'application/json']],['precision.bin',[precisionBlob,'application/octet-stream']],
 ['vendor/localfold/webgpu/af3/trunk/transition-baseline.js',[baseline,'text/javascript']]]);
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
 const path=new URL(req.url).pathname.slice(1);if(!['GET','HEAD'].includes(req.method))return new Response('Method not allowed',{status:405});
 let body,type;if(!path){body='<html><title>Transition dispatch coverage</title></html>';type='text/html';}
 else if(files.has(path))[body,type]=files.get(path);
 else if(allowed.has(path)){body=Bun.file(join(root,path));type=['.js','.mjs'].includes(extname(path))?'text/javascript':undefined;}
 else return new Response('Not an allowed file',{status:404});
 return new Response(body,{headers:{...(type?{'Content-Type':type}:{}),'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp',
  'Content-Security-Policy':"default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self' blob:"}});
}});
const after=process.argv.includes('--after-fix'),b=await startMolariumBrowser({url:`http://127.0.0.1:${server.port}/`});
try{
 await waitFor(()=>b.evaluate(`location.origin===${JSON.stringify(`http://127.0.0.1:${server.port}`)}&&document.readyState==='complete'`),20000,'dispatch test navigation');
 const measured=await b.evaluate(`(async()=>{
  const {getDevice}=await import('/vendor/localfold/web/model.js'),upstream=await import('/vendor/localfold/webgpu/af3/trunk/transition-baseline.js'),candidate=await import('/vendor/localfold/webgpu/af3/trunk/transition.js');
  const original=await(await fetch('/original.json')).json(),p=await(await fetch('/precision.json')).json();
  const oldBlob=await(await fetch('/original.bin')).arrayBuffer(),blob=await(await fetch('/precision.bin')).arrayBuffer();
  const data=(name,old=false)=>{const d=(old?original:p).arrays[name],T=old||d.dtype==='<f4'?Float32Array:Float64Array;return new T(old?oldBlob:blob,d.byteOffset,d.bytes/T.BYTES_PER_ELEMENT);};
  const c=p.cases.find(c=>c.id==='single-ordinary/f32'),pattern=data(c.inputReference.array,true),expected=data(c.expectedF64),
   weights=Object.fromEntries(Object.entries(c.weights).map(([k,v])=>[k,data(v)])),device=await getDevice(),records=[],raw=[];
  const variants=[['upstream','fast',upstream],['candidate','fast',candidate],...(${after}?[['candidate','shifted-fast',candidate]]:[])];
  for(const rows of [1000,1761])for(const [implementation,mode,module]of variants){
   const input=new Float32Array(rows*c.shape.channels);for(let i=0;i<input.length;i++)input[i]=pattern[i%pattern.length];
   const actual=(await new module.Af3TransitionGpu(device).run(input,{...c.shape,rows},weights,{epsilon:c.epsilon,variance:mode})).output;
   let difference=0,scale=0,maxAbs=0,unwrittenRows=0,finite=true;
   for(let row=0;row<rows;row++){let zero=true;for(let col=0;col<c.shape.channels;col++){
    const i=row*c.shape.channels+col,want=expected[i%expected.length],delta=actual[i]-want;difference+=delta*delta;scale+=want*want;
    maxAbs=Math.max(maxAbs,Math.abs(delta));zero&&=actual[i]===0;finite&&=Number.isFinite(actual[i]);}unwrittenRows+= +zero;}
   const bytes=new Uint8Array(actual.buffer,actual.byteOffset,actual.byteLength),chunks=[];
   for(let i=0;i<bytes.length;i+=8192)chunks.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
   raw.push({rows,implementation,mode,base64:btoa(chunks.join(''))});
   const relativeRms=finite?Math.sqrt(difference/scale):null;
   records.push({rows,channels:c.shape.channels,factor:c.shape.factor,implementation,mode,finite,relativeRms,maxAbs:finite?maxAbs:null,unwrittenRows,
    shaderRowTile:module.transitionRowTile(rows,c.shape.channels),legacyTileIfChannelOmitted:module.transitionRowTile(rows),
    passesF32Gate:finite&&!unwrittenRows&&relativeRms<=1e-4&&maxAbs<=2e-4});
  }
  const adapter=await navigator.gpu.requestAdapter();return {records,raw,userAgent:navigator.userAgent,
   adapter:adapter?.info?Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,adapter.info[k]])):null};
 })()`);
 const {raw,...report}=measured,parts=[];let offset=0;
 const records=raw.map(r=>{const bytes=Buffer.from(r.base64,'base64'),{base64,...id}=r,entry={...id,byteOffset:offset,bytes:bytes.length,sha256:sha(bytes)};parts.push(bytes);offset+=bytes.length;return entry;});
 const blob=Buffer.concat(parts),file=basename(output).replace(/\.json$/,'')+'.outputs.bin';await writeFile(join(dirname(output),file),blob,{flag:'wx'});
 const result={schema:'molarium.transition-dispatch-check.v1',scope:'Actual standalone Af3TransitionGpu.run. Five saved native single-transition rows repeat to 1000/1761 rows; the mathematical transition is independent per row. No model prediction or new random reference.',
  afterFix:after,baselineSourceSha256:sha(baseline),candidateSourceSha256:sha(await readFile(join(root,'vendor/localfold/webgpu/af3/trunk/transition.js'))),
  sourceReceiptSha256:sha(await readFile(join(root,'vendor/localfold/UPSTREAM.json'))),runnerSha256:sha(await readFile(new URL(import.meta.url))),
  originalManifestSha256:sha(originalBytes),precisionManifestSha256:sha(precisionBytes),referenceCase:'single-ordinary/f32',
  outputs:{file,bytes:blob.length,sha256:sha(blob),records},...report};
 await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({afterFix:after,records:report.records.map(r=>({rows:r.rows,implementation:r.implementation,mode:r.mode,unwrittenRows:r.unwrittenRows,relativeRms:r.relativeRms,pass:r.passesF32Gate}))}));
 if(report.records.some(r=>r.implementation==='candidate'&&!r.passesF32Gate))process.exitCode=1;
}finally{await b.close();server.stop(true);}
