// Observe the actual production trunk. Native seams/weights are required fixtures.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, join, extname} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {browserModuleClosure} from './web-bundle-dependencies.mjs';
import {startMolariumBrowser, waitFor} from './headless-chrome.mjs';

const [fixture, output] = process.argv.slice(2);
if (!output) throw Error('Usage: bun scripts/cofold-trained-trunk.browser.mjs FIXTURE NEW_OUTPUT_DIRECTORY');
await mkdir(output);
const root = resolve(import.meta.dirname, '..');
const sha = b => createHash('sha256').update(b).digest('hex');
const receiptBytes = await readFile(join(fixture, 'receipt.json'));
const fixtureReceipt = JSON.parse(receiptBytes);
if (fixtureReceipt.schema !== 'molarium.trained-trunk-fixture.v1') throw Error('Wrong fixture');
const allowed = new Set(await browserModuleClosure(root, [
  'vendor/localfold/web/model.js', 'vendor/localfold/webgpu/af3/trunk/trunk.js',
  'vendor/localfold/shared/af3/weights/weights.js',
  'vendor/localfold/shared/af3/featurise/contact-classes.js',
]));
const data = new Set(['receipt.json','weights.json','weights.bin','target.bin','base/features.json','base/features.bin']);
for (let cycle = 0; cycle < fixtureReceipt.cycles; cycle++) {
  data.add(`msa-${cycle}/features.json`); data.add(`msa-${cycle}/features.bin`);
}
const token = randomUUID(), outputs = new Map();
const server = Bun.serve({hostname:'127.0.0.1',port:0,maxRequestBodySize:128*1024*1024,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (req.method === 'POST' && path.startsWith('/output/')) {
      const name = path.slice('/output/'.length), expected = fixtureReceipt.expectedSeams[name];
      if (req.headers.get('authorization') !== token || !expected || outputs.has(name)) return new Response(null,{status:403});
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.byteLength !== expected.bytes) return new Response('Wrong seam size',{status:400});
      await writeFile(join(output,name+'.bin'),bytes,{flag:'wx'});
      outputs.set(name,{file:name+'.bin',bytes:bytes.byteLength,sha256:sha(bytes)});
      console.log(JSON.stringify({saved:name,bytes:bytes.byteLength}));
      return new Response('saved');
    }
    if (!['GET','HEAD'].includes(req.method)) return new Response(null,{status:405});
    let body,type;
    if(path==='/'){body='<html><title>Stock-trained trunk comparison</title></html>';type='text/html';}
    else if(path.startsWith('/fixture/')&&data.has(path.slice(9))){body=Bun.file(join(fixture,path.slice(9)));type=path.endsWith('.json')?'application/json':'application/octet-stream';}
    else if(allowed.has(path.slice(1))){body=Bun.file(join(root,path.slice(1)));type=['.js','.mjs'].includes(extname(path))?'text/javascript':undefined;}
    else return new Response(null,{status:404});
    return new Response(body,{headers:{...(type?{'Content-Type':type}:{}),
      'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp',
      'Content-Security-Policy':"default-src 'self';connect-src 'self';script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval';worker-src 'self' blob:"}});
  }});
const browser = await startMolariumBrowser({url:`http://127.0.0.1:${server.port}/`});
let result = {status:'running',scope:fixtureReceipt.scope,fixtureReceiptSha256:sha(receiptBytes),
  runnerSha256:sha(await readFile(new URL(import.meta.url))),gates:fixtureReceipt.gatesDeclaredBeforeRun};
try {
  await waitFor(()=>browser.evaluate(`document.readyState==='complete'`),20000,'trunk fixture');
  await browser.evaluate(`(()=>{
    window.trunkControl={status:'running',progress:'loading weights'};
    (async()=>{
      const digest=async raw=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),b=>b.toString(16).padStart(2,'0')).join('');
      const json=async path=>(await fetch('/fixture/'+path)).json();
      const receipt=await json('receipt.json'),wm=await json('weights.json');
      const wb=await(await fetch('/fixture/weights.bin')).arrayBuffer();
      if(wb.byteLength!==wm.blob.bytes||await digest(wb)!==wm.blob.sha256)throw Error('Weight blob changed');
      for(const d of Object.values(wm.tensors))if(await digest(wb.slice(d.byteOffset,d.byteOffset+d.bytes))!==d.sha256)throw Error('Weight slice changed');
      const store={manifest:wm,shape:name=>{if(!wm.tensors[name])throw Error('Missing tensor '+name);return wm.tensors[name].shape;},
        tensor:async name=>{const d=wm.tensors[name];if(!d)throw Error('Missing tensor '+name);return new Float32Array(wb,d.byteOffset,d.bytes/4);},
        tensorRangeSync:(name,from,count)=>{const d=wm.tensors[name];if(!d||from<0||from+count>d.bytes/4)throw Error('Weight bounds');return new Float32Array(wb,d.byteOffset+4*from,count);}};
      const snapshot=async path=>{
        const m=await json(path+'/features.json'),b=await(await fetch('/fixture/'+path+'/features.bin')).arrayBuffer();
        if(await digest(b)!==m.blob.sha256)throw Error('Input blob changed');
        const classes={'<f4':Float32Array,'<f8':Float64Array,'<i4':Int32Array,'<u4':Uint32Array,'|u1':Uint8Array,'|i1':Int8Array,'|b1':Uint8Array,'<i8':BigInt64Array,'<u8':BigUint64Array};
        const arrays={};for(const[k,d]of Object.entries(m.arrays)){
          const cls=classes[d.dtype];if(!cls||await digest(b.slice(d.byteOffset,d.byteOffset+d.bytes))!==d.sha256)throw Error('Input slice changed');
          arrays[k]=new cls(b,d.byteOffset,d.bytes/cls.BYTES_PER_ELEMENT);
        }
        const decode=n=>{'use strict';if('array'in n)return arrays[n.array];if('value'in n)return n.value;
          if('dict'in n)return Object.fromEntries(n.dict.map(([k,v])=>[decode(k),decode(v)]));
          if('list'in n)return n.list.map(decode);if('tuple'in n)return n.tuple.map(decode);throw Error('Unsupported control input');};
        return decode(m.tree);
      };
      const base=await snapshot('base'),tb=await(await fetch('/fixture/target.bin')).arrayBuffer();
      if(await digest(tb)!==receipt.targetSha256)throw Error('Target changed');
      const {getDevice}=await import('/vendor/localfold/web/model.js');
      const {trunkWeights}=await import('/vendor/localfold/shared/af3/weights/weights.js');
      const {Af3TrunkGpu}=await import('/vendor/localfold/webgpu/af3/trunk/trunk.js');
      const {af3ContactClasses}=await import('/vendor/localfold/shared/af3/featurise/contact-classes.js');
      const device=await getDevice(),adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
      const info=adapter?.info?Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,adapter.info[k]])):{};
      if(/swiftshader|llvmpipe|software/i.test(JSON.stringify(info)))throw Error('Physical GPU required');
      if(${JSON.stringify(process.env.MOLARIUM_REQUIRE_NVIDIA === '1')}&&!/nvidia|10de/i.test(JSON.stringify(info)))throw Error('This allocation requires a physical NVIDIA adapter');
      const weights=await trunkWeights(store),trunk=new Af3TrunkGpu(device,{
        stagedPrecision:'f32',weightPrecision:'f32',accumulatePrecision:'f32',pairWeightPrecision:'f32'});
      const records=[],contactClasses=af3ContactClasses(base,base.tokens),targetFeat=new Float32Array(tb);
      let previousPair,previousSingle;
      for(let cycle=0;cycle<receipt.cycles;cycle++){
        window.trunkControl.progress='cycle '+cycle;
        const msa=await snapshot('msa-'+cycle),transfers=[],seen=new Set();
        const capture=(name,actual)=>{
          const key='cycle-'+cycle+'.'+name,expected=receipt.expectedSeams[key];if(!expected)return;
          if(seen.has(key)||actual.byteLength!==expected.bytes)throw Error('Wrong/duplicate seam '+key);seen.add(key);
          transfers.push((async()=>{const response=await fetch('/output/'+key,{method:'POST',headers:{authorization:${JSON.stringify(token)}},body:actual});if(!response.ok)throw Error('Seam transfer failed '+key);})());
        };
        const started=performance.now(),out=await trunk.run({...base,...msa,targetFeat,contactClasses,previousPair,previousSingle},weights,weights.dialect,{
          readback:{pair:true,single:true,logits:false},onSeam:capture,
          onStageStart:stage=>{window.trunkControl.progress='cycle '+cycle+': '+stage;},
        });
        capture('trunk-output-single',out.single);
        await Promise.all(transfers);
        const wanted=Object.keys(receipt.expectedSeams).filter(k=>k.startsWith('cycle-'+cycle+'.'));
        if(wanted.some(k=>!seen.has(k)))throw Error('Missing observed seams');
        records.push({cycle,instrumentedMilliseconds:performance.now()-started,timings:out.timings});
        previousPair=out.pair;previousSingle=out.single;
      }
      window.trunkControl={status:'complete',records,adapter:info,userAgent:navigator.userAgent,features:[...device.features]};
    })().catch(e=>{window.trunkControl.status='failed';window.trunkControl.error=String(e.stack??e);});
    return true;
  })()`);
  const measured = await waitFor(()=>browser.evaluate(`window.trunkControl?.status!=='running'?window.trunkControl:null`),20*60*1000,'four trained trunk cycles');
  result = {...result,...measured};
  if(measured.status !== 'complete') throw Error(measured.error);
  if(outputs.size !== Object.keys(fixtureReceipt.expectedSeams).length) throw Error('Incomplete raw output transfer');
} catch(error) {
  result.status='failed'; result.error=String(error.stack??error); process.exitCode=1;
} finally {
  result.outputs=Object.fromEntries(outputs);
  await writeFile(join(output,'receipt.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:result.status,seams:outputs.size,error:result.error}));
  await browser.close();server.stop(true);
}
