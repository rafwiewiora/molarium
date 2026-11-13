// WIP preregistered trained-target-feature check: actual production CPU/GPU paths.
import{readFile,writeFile}from'node:fs/promises';
import{resolve,join,extname}from'node:path';
import{createHash}from'node:crypto';
import{browserModuleClosure}from'./web-bundle-dependencies.mjs';
import{startMolariumBrowser,waitFor}from'./headless-chrome.mjs';
const [fixture,output]=process.argv.slice(2);if(!output)throw Error('fixture NEW-output required');
const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const receiptBytes=await readFile(join(fixture,'receipt.json')),receipt=JSON.parse(receiptBytes);
try{await readFile(output);throw Error('Refusing overwritten measurement');}catch(e){if(e.code!=='ENOENT')throw e;}
const allowed=new Set(await browserModuleClosure(root,['vendor/localfold/web/model.js','vendor/localfold/webgpu/af3/fold.js','vendor/localfold/shared/af3/weights/diffusion-weights.js']));
const data=new Map();for(const path of ['receipt.json','weights.json','weights.bin','controlled-batch/features.json','controlled-batch/features.bin','expected-target.bin'])data.set('/fixture/'+path,await readFile(join(fixture,path)));
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
 const path=new URL(req.url).pathname;if(!['GET','HEAD'].includes(req.method))return new Response(null,{status:405});
 let body,type;
 if(path==='/'){body='<html><title>Trained input embedder control</title></html>';type='text/html';}
 else if(data.has(path)){body=data.get(path);type=path.endsWith('.json')?'application/json':'application/octet-stream';}
 else if(allowed.has(path.slice(1))){body=Bun.file(join(root,path.slice(1)));type=['.js','.mjs'].includes(extname(path))?'text/javascript':undefined;}
 else return new Response(null,{status:404});
 return new Response(body,{headers:{...(type?{'Content-Type':type}:{}),'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Content-Security-Policy':"default-src 'self';connect-src 'self';script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval';worker-src 'self' blob:"}});
}});
const b=await startMolariumBrowser({url:`http://127.0.0.1:${server.port}/`});
try{
 await waitFor(()=>b.evaluate(`document.readyState==='complete'`),20000,'trained fixture');
 const measured=await b.evaluate(`(async()=>{
  const digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
  const receipt=await(await fetch('/fixture/receipt.json')).json();
  const wm=await(await fetch('/fixture/weights.json')).json(),wb=await(await fetch('/fixture/weights.bin')).arrayBuffer();
  if(await digest(wb)!==wm.blob.sha256||wb.byteLength!==wm.blob.bytes)throw Error('Weight fixture changed');
  for(const record of Object.values(wm.tensors))if(await digest(wb.slice(record.byteOffset,record.byteOffset+record.bytes))!==record.sha256)throw Error('Weight slice changed');
  const store={manifest:wm,shape:name=>{if(!wm.tensors[name])throw Error('Missing trained tensor '+name);return wm.tensors[name].shape;},
   tensor:async name=>{const d=wm.tensors[name];if(!d)throw Error('Missing trained tensor '+name);return new Float32Array(wb,d.byteOffset,d.bytes/4);},
   tensorRangeSync:(name,from,count)=>{const d=wm.tensors[name];if(!d||from<0||from+count>d.bytes/4)throw Error('Weight range changed');return new Float32Array(wb,d.byteOffset+from*4,count);}};
  const bm=await(await fetch('/fixture/controlled-batch/features.json')).json(),bb=await(await fetch('/fixture/controlled-batch/features.bin')).arrayBuffer();
  if(await digest(bb)!==bm.blob.sha256)throw Error('Controlled batch changed');
  const classes={'<f4':Float32Array,'<f8':Float64Array,'<i4':Int32Array,'<u4':Uint32Array,'|i1':Int8Array,'|u1':Uint8Array,'|b1':Uint8Array,'<i8':BigInt64Array,'<u8':BigUint64Array};
  const arrays={};for(const [key,d]of Object.entries(bm.arrays)){
   const cls=classes[d.dtype];if(!cls)throw Error('Unsupported dtype '+d.dtype);
   if(await digest(bb.slice(d.byteOffset,d.byteOffset+d.bytes))!==d.sha256)throw Error('Controlled array changed');
   arrays[key]=new cls(bb,d.byteOffset,d.bytes/cls.BYTES_PER_ELEMENT);
  }
  const decode=node=>{
   if('array'in node)return arrays[node.array];if('value'in node)return node.value;
   if('dict'in node)return Object.fromEntries(node.dict.map(([k,v])=>[decode(k),decode(v)]));
   if('list'in node)return node.list.map(decode);if('tuple'in node)return node.tuple.map(decode);
   if('metadataObjectType'in node)return undefined;throw Error('Unsupported tree node');
  };
  const batch=decode(bm.tree),rawExpected=await(await fetch('/fixture/expected-target.bin')).arrayBuffer();
  if(await digest(rawExpected)!==receipt.expectedTargetSha256)throw Error('Native expected output changed');
  const expected=new Float32Array(rawExpected),{targetFeatureWeights}=await import('/vendor/localfold/shared/af3/weights/diffusion-weights.js');
  const {buildTargetFeat}=await import('/vendor/localfold/webgpu/af3/fold.js'),{getDevice}=await import('/vendor/localfold/web/model.js');
  const weights=await targetFeatureWeights(store),device=await getDevice(),records=[],raw=[];
  const metrics=(actual)=>{if(actual.length!==expected.length)throw Error('Output shape changed');let error=0,scale=0,maxAbs=0,finite=true;
   for(let i=0;i<actual.length;i++){const d=actual[i]-expected[i];finite&&=Number.isFinite(actual[i]);error+=d*d;scale+=expected[i]*expected[i];maxAbs=Math.max(maxAbs,Math.abs(d));}
   if(!(scale>0))throw Error('Degenerate native reference');return {finite,relativeRms:finite?Math.sqrt(error/scale):null,maxAbsoluteDifference:finite?maxAbs:null};};
  for(const path of ['production-cpu','production-webgpu']){
   const start=performance.now(),actual=await buildTargetFeat(batch,weights,path.endsWith('webgpu')?device:undefined),elapsed=performance.now()-start;
   const m=metrics(actual),gate=receipt.gatesDeclaredBeforeRun,bytes=new Uint8Array(actual.buffer,actual.byteOffset,actual.byteLength),chunks=[];
   for(let i=0;i<bytes.length;i+=8192)chunks.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
   raw.push({path,base64:btoa(chunks.join('')),sha256:await digest(bytes)});
   records.push({path,elapsedMilliseconds:elapsed,...m,passes: m.finite&&m.relativeRms<=gate.relativeRms&&m.maxAbsoluteDifference<=gate.maxAbsoluteDifference});
  }
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  return {records,raw,adapter:adapter?.info?Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,adapter.info[k]])):null,features:[...device.features],userAgent:navigator.userAgent};
 })()`);
 const {raw,...report}=measured,outputs=[];
 for(const item of raw){const bytes=Buffer.from(item.base64,'base64');if(sha(bytes)!==item.sha256)throw Error('Output transfer changed');const file=output.replace(/\.json$/,'')+'.'+item.path+'.bin';await writeFile(file,bytes,{flag:'wx'});outputs.push({path:item.path,file,bytes:bytes.length,sha256:item.sha256});}
 const result={scope:receipt.scope,fixtureReceiptSha256:sha(receiptBytes),runnerSha256:sha(await readFile(new URL(import.meta.url))),gates:receipt.gatesDeclaredBeforeRun,outputs,...report};
 await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
 if(report.records.some(r=>!r.passes))process.exitCode=1;
}finally{await b.close();server.stop(true);}
