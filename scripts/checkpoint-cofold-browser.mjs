// Export only this benchmark's IndexedDB records. Never starts or resumes inference.
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {DevToolsClient} from './headless-chrome.mjs';
export async function checkpointLibraries(evaluate,panel,out,seen=new Set()){
  await mkdir(out,{recursive:true});
  const runs=await evaluate(`(async()=>{const {LibraryStore}=await import('/vendor/foldarium/library-store.js');const store=new LibraryStore();
    try{return await store.listRuns();}finally{await store.opened?.then(db=>db.close()).catch(()=>{});}})()`);
  for(const run of runs){
    if(!panel.cases.some(c=>c.sequence===run.request.sequence&&run.compounds.length===1&&c.id===run.compounds[0].id&&c.smiles===run.compounds[0].smiles))continue;
    const key=JSON.stringify([run.id,run.updatedAt,run.completed,run.failed,run.status]);if(seen.has(key))continue;
    const text=await evaluate(`(async()=>{const {LibraryStore}=await import('/vendor/foldarium/library-store.js');const {stringifyLibrary}=await import('/vendor/foldarium/library-format.js');const store=new LibraryStore();
      try{return stringifyLibrary(await store.bundle(${JSON.stringify(run.id)}));}finally{await store.opened?.then(db=>db.close()).catch(()=>{});}})()`);
    const bytes=text+'\n',hash=createHash('sha256').update(bytes).digest('hex'),bundle=JSON.parse(text);
    const name=`${run.compounds[0].id}-${bundle.poses.filter(p=>p.status==='complete').length}-${hash.slice(0,16)}.json`;
    await writeFile(join(out,name),bytes);await appendFile(join(out,'checkpoints.jsonl'),JSON.stringify({at:new Date().toISOString(),file:name,sha256:hash,status:run.status,complete:bundle.poses.filter(p=>p.status==='complete').length,failed:bundle.poses.filter(p=>p.status==='failed').length})+'\n');
    seen.add(key);
  }
}
async function main(){
 const [port,origin,panelFile,out]=process.argv.slice(2);
 if(!/^\d+$/.test(port??'')||!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin??'')||!out)throw Error('Usage: debug-port exact-local-origin panel.json output-directory');
 const panel=JSON.parse(await Bun.file(panelFile).text()),pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();
 const page=pages.find(p=>p.type==='page'&&new URL(p.url).origin===origin);if(!page)throw Error('Task browser page not found');
 const client=new DevToolsClient(page.webSocketDebuggerUrl);await client.open();
 const evaluate=async expression=>{if(client.socket.readyState!==WebSocket.OPEN)throw Error('Chrome debugging connection closed');
  const r=await client.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
 const seen=new Set(),started=Date.now();
 try{while(Date.now()-started<3*3600*1000){await checkpointLibraries(evaluate,panel,resolve(out),seen);await new Promise(r=>setTimeout(r,5000));}}
 catch(e){console.log(JSON.stringify({checkpointProcessEnded:String(e.message),snapshots:seen.size}));}
 finally{client.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
