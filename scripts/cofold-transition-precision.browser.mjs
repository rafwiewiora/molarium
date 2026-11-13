// Independent production-generator/packer/decoder qualification; no model run.
import {readFile,writeFile}from'node:fs/promises';
import {resolve,join,basename,dirname,extname}from'node:path';
import {createHash}from'node:crypto';
import {sourceWebFiles}from'./web-source-files.mjs';
import {startMolariumBrowser,waitFor}from'./headless-chrome.mjs';
const [originalDir,precisionDir,output]=process.argv.slice(2);
if(!output)throw Error('Usage: original-fp32-directory precision-fixtures-directory NEW-report.json');
try{await readFile(output);throw Error('Refusing to overwrite a previous diagnostic');}catch(e){if(e.code!=='ENOENT')throw e;}
const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const allowed=new Set(await sourceWebFiles(root));allowed.add('folding/comparison/transition-kernel-probe.mjs');
const originalBytes=await readFile(join(originalDir,'manifest.json')),original=JSON.parse(originalBytes),originalBlob=await readFile(join(originalDir,original.blob.file));
const precisionBytes=await readFile(join(precisionDir,'manifest.json')),precision=JSON.parse(precisionBytes),precisionBlob=await readFile(join(precisionDir,precision.blob.file));
if(precision.originalManifestSha256!==sha(originalBytes)||sha(originalBlob)!==original.blob.sha256||sha(precisionBlob)!==precision.blob.sha256)throw Error('Fixture identity/hash mismatch');
const responses=new Map([['original.json',[originalBytes,'application/json']],['original.bin',[originalBlob,'application/octet-stream']],
 ['precision.json',[precisionBytes,'application/json']],['precision.bin',[precisionBlob,'application/octet-stream']]]);
const tolerances={f32:{full:{relativeRms:1e-4,maxAbs:2e-4},normalization:{relativeRms:1e-5,maxAbs:2e-5}},
 f16:{full:{relativeRms:1e-2,maxAbs:2e-2},normalization:{relativeRms:1e-3,maxAbs:1e-2}},
 rationale:'FP32 full gate unchanged. Half full relative gate follows pinned upstream split checker; additional absolute and normalization gates declared before this experiment. References use matched resident weights; quantization effects are recorded separately.'};
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
 const path=new URL(req.url).pathname.slice(1);if(!['GET','HEAD'].includes(req.method))return new Response('Method not allowed',{status:405});
 let body,type;if(!path){body='<html><title>Production transition qualification</title></html>';type='text/html';}
 else if(responses.has(path))[body,type]=responses.get(path);
 else if(allowed.has(path)){body=Bun.file(join(root,path));type=['.mjs','.js'].includes(extname(path))?'text/javascript':undefined;}
 else return new Response('Not an allowed diagnostic file',{status:404});
 return new Response(body,{headers:{...(type?{'Content-Type':type}:{}),'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp',
  'Content-Security-Policy':"default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self' blob:"}});
}});
const b=await startMolariumBrowser({url:`http://127.0.0.1:${server.port}/`});
try{
 await waitFor(()=>b.evaluate(`location.origin===${JSON.stringify(`http://127.0.0.1:${server.port}`)}&&document.readyState==='complete'`),20000,'diagnostic navigation');
 const measured=await b.evaluate(`(async()=>{
  const {getDevice}=await import('/vendor/localfold/web/model.js'),{probeTransition}=await import('/folding/comparison/transition-kernel-probe.mjs');
  const original=await(await fetch('/original.json')).json(),precision=await(await fetch('/precision.json')).json();
  const originalBlob=await(await fetch('/original.bin')).arrayBuffer(),blob=await(await fetch('/precision.bin')).arrayBuffer(),device=await getDevice();
  const data=(name,old=false)=>{const d=(old?original:precision).arrays[name],buffer=old?originalBlob:blob;
   const T=old||d.dtype==='<f4'?Float32Array:d.dtype==='<f8'?Float64Array:d.dtype==='<f2'?Float16Array:Uint8Array;
   return new T(buffer,d.byteOffset,d.bytes/T.BYTES_PER_ELEMENT);};
  const metrics=(actual,expected)=>{let sum=0,scale=0,maxAbs=0,finite=true;
   for(let i=0;i<actual.length;i++){if(!Number.isFinite(actual[i]))finite=false;const delta=actual[i]-expected[i];sum+=delta*delta;scale+=expected[i]*expected[i];maxAbs=Math.max(maxAbs,Math.abs(delta));}
   return {finite,relativeRms:finite?Math.sqrt(sum/scale):null,maxAbs:finite?maxAbs:null};};
  const rawOutputs=[],records=[],tol=${JSON.stringify(tolerances)};
  const raw=(caseId,style,shifted,kind,buffer,dtype)=>{const bytes=new Uint8Array(buffer),chunks=[];
   for(let i=0;i<bytes.length;i+=8192)chunks.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
   rawOutputs.push({caseId,style,shifted,kind,dtype,base64:btoa(chunks.join(''))});};
  for(const c of precision.cases){
   const input=data(c.inputReference.array,c.inputReference.kind==='original');
   const weights=Object.fromEntries(Object.entries(c.weights).map(([k,v])=>[k,Float32Array.from(data(v))]));
   const encoded=Object.fromEntries(Object.entries(c.encoded).map(([k,v])=>[k,{record:v.record,data:data(v.data)}]));
   const expected=data(c.expectedF64),expectedNorm=data(c.normalizedF64),gate=c.precision==='f32'?tol.f32:tol.f16;
   for(const style of ['fused','fused-residual','split'])for(const shifted of [false,true]){
    let result;try{result=await probeTransition(device,c,input,weights,encoded,style,shifted);}
    catch(e){records.push({caseId:c.id,style,shifted,status:'error',error:e.message});return {records,rawOutputs,stopped:true,features:[...device.features],userAgent:navigator.userAgent};}
    raw(c.id,style,shifted,'output',result.output,'<f4');
    const final=new Float32Array(result.output),delta=Float64Array.from(final,(v,i)=>result.residual?v-input[i]:v),full=metrics(delta,expected);
    let normalization=null;
    if(result.normalized){raw(c.id,style,shifted,'normalized',result.normalized,result.normalizedType==='f16'?'<f2':'<f4');
     normalization=metrics(result.normalizedType==='f16'?new Float16Array(result.normalized):new Float32Array(result.normalized),expectedNorm);}
    const passes=m=>m.finite&&m.relativeRms<=gate.full.relativeRms&&m.maxAbs<=gate.full.maxAbs;
    const normPass=!normalization||(normalization.finite&&normalization.relativeRms<=gate.normalization.relativeRms&&normalization.maxAbs<=gate.normalization.maxAbs);
    const {output,normalized,...details}=result;
    records.push({caseId:c.id,originalCaseId:c.originalCaseId,precision:c.precision,shape:c.shape,style,shifted,status:'complete',
     full,normalization,passesMatchedPrecisionGate:passes(full)&&normPass,stressDiagnostic:c.originalCaseId.includes('near-constant'),...details});
   }
  }
  const adapter=await navigator.gpu.requestAdapter();return {records,rawOutputs,stopped:false,features:[...device.features],
   adapter:adapter?.info?Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,adapter.info[k]])):null,userAgent:navigator.userAgent};
 })()`);
 const {rawOutputs,...report}=measured,parts=[];let offset=0;
 const outputRecords=rawOutputs.map(r=>{const bytes=Buffer.from(r.base64,'base64'),{base64,...rest}=r,entry={...rest,byteOffset:offset,bytes:bytes.length,sha256:sha(bytes)};parts.push(bytes);offset+=bytes.length;return entry;});
 const outputBlob=Buffer.concat(parts),outputFile=basename(output).replace(/\.json$/,'')+'.outputs.bin';
 await writeFile(join(dirname(output),outputFile),outputBlob);
 const result={schema:'molarium.production-transition-qualification.v1',scope:'Pinned production fused, in-place/ranged fused and split generators, packer and actual GPU int5 upload; experimental shifted shaders only. No trained/full-model inference.',
  originalManifestSha256:sha(originalBytes),precisionManifestSha256:sha(precisionBytes),tolerances,
  runnerSha256:sha(await readFile(new URL(import.meta.url))),probeSha256:sha(await readFile(join(root,'folding/comparison/transition-kernel-probe.mjs'))),
  vendorReceiptSha256:sha(await readFile(join(root,'vendor/localfold/UPSTREAM.json'))),
  outputs:{file:outputFile,bytes:outputBlob.length,sha256:sha(outputBlob),records:outputRecords},...report};
 await writeFile(output,JSON.stringify(result,null,2)+'\n');
 const candidate=report.records.filter(r=>r.shifted),failed=candidate.filter(r=>r.status!=='complete'||!r.passesMatchedPrecisionGate);
 console.log(JSON.stringify({records:report.records.length,expected:precision.cases.length*6,candidateFailures:failed,stopped:report.stopped}));
 if(report.stopped||report.records.length!==precision.cases.length*6||failed.length)process.exitCode=1;
}finally{await b.close();server.stop(true);}
