// Bounded, source-only selection. Never predicts a structure or inspects a prediction.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const [python,directory,start='2',rankingName='ranking.json']=process.argv.slice(2),root=resolve(directory),sources=join(root,'sources');
if(!python||!directory)throw Error('Usage: analysis-python existing-harvest-root');
await mkdir(sources,{recursive:true});
for(let iteration=Number(start);iteration<=40;iteration++){
 const previous=join(root,`preparation-${String(iteration-1).padStart(3,'0')}`);
 if(await Bun.file(join(previous,'panel.json')).exists()){console.log(JSON.stringify({frozen:previous}));break;}
 const needed=JSON.parse(await readFile(join(previous,'needed-sources.json')));
 const audit=JSON.parse(await readFile(join(previous,'selection-audit.json')));
 const pdbIds=new Set(audit.records.filter(r=>r.status==='needs-source').map(r=>r.pdbId));
 await Promise.all(needed.map(async file=>{
  if(await Bun.file(join(sources,file)).exists())return;
  const url='https://files.rcsb.org/'+(pdbIds.has(file.replace(/\.cif$/,''))?'download/':'ligands/download/')+file;
  const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(url+' HTTP '+r.status);
  const data=new Uint8Array(await r.arrayBuffer());if(data.length>64*1024*1024)throw Error('Source exceeds64MiB '+file);
  await Bun.write(join(sources,file),data);await writeFile(join(sources,file+'.receipt.json'),JSON.stringify({url,sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length,retrievedAt:new Date().toISOString()},null,2)+'\n');
 }));
 const out=join(root,`preparation-${String(iteration).padStart(3,'0')}`);
 const proc=Bun.spawn([python,'folding/comparison/recent_pdb.py','prepare','--ranking',join(root,rankingName),'--sources',sources,'--output',out],
  {env:{...process.env,MPLCONFIGDIR:'/private/tmp/molarium-cofold-mplconfig'},stdout:'pipe',stderr:'pipe'});
 const [stdout,stderr,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
 if(stderr)console.error(stderr.slice(-1200));if(code!==0)throw Error('Preparation failed '+code+' '+stdout);
 console.log(stdout.trim());
 if(await Bun.file(join(out,'panel.json')).exists()){console.log(JSON.stringify({frozen:out}));break;}
 if(iteration===40)throw Error('Bounded40-attempt source-selection limit reached; preserve receipts and inspect.');
}
