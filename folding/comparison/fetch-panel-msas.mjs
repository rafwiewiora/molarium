// Separate controlled MSA experiment: public PDB sequences only, no coordinates.
import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {ColabFoldMsaProvider} from '../../openfold/msa-client.js';
const [panelFile,directory]=process.argv.slice(2),panelBytes=await readFile(panelFile),panel=JSON.parse(panelBytes),out=resolve(directory);
await mkdir(out,{recursive:true});const sha=b=>createHash('sha256').update(b).digest('hex');
const records=[],policy={maxRowsIncludingQuery:256,selection:'Query first, then first unique aligned sequences from UniRef followed by environment; deduplicate ignoring lowercase insertions. No coordinate or prediction-based selection.'};
function selectedA3m(sequence,documents){
 const rows=[],seen=new Set([sequence]);
 for(const text of documents)for(const block of text.replaceAll('\0','\n').split(/^>/m).slice(1)){
  const lines=block.split(/\r?\n/),header=lines.shift(),row=lines.filter(l=>l&&!l.startsWith('#')).join(''),aligned=row.replace(/[a-z]/g,'');
  if(!/^[A-Z-]+$/.test(aligned)||aligned.length!==sequence.length)throw Error('MSA row/query length or alphabet mismatch');
  if(seen.has(aligned))continue;seen.add(aligned);rows.push({header,row});
 }
 return {text:`>query\n${sequence}\n`+rows.slice(0,255).map(r=>`>${r.header}\n${r.row}\n`).join(''),available:rows.length+1,selected:Math.min(rows.length+1,256)};
}
for(const c of panel.cases){
 const root=join(out,c.id);await mkdir(root,{recursive:true});const complete=join(root,'receipt.json');
 if(await Bun.file(complete).exists()){const r=JSON.parse(await readFile(complete));if(r.sequenceSha256!==sha(c.sequence))throw Error('Cached MSA sequence mismatch');records.push(r);continue;}
 const provider=new ColabFoldMsaProvider({fetchImplementation:async(url,options)=>{
   const archive=join(root,'raw-result.tar.gz');
   if(url.includes('/result/download/')&&await Bun.file(archive).exists())return new Response(await readFile(archive));
   const response=await fetch(url,options);const clone=response.clone();
   if(url.includes('/result/download/')){if(response.ok)await writeFile(archive,new Uint8Array(await clone.arrayBuffer()));}
   else await appendFile(join(root,'requests.jsonl'),JSON.stringify({at:new Date().toISOString(),url,status:response.status,response:await clone.text()})+'\n');
   return response;
 }});
 const submit=provider.submit.bind(provider);
 provider.submit=async(sequence,signal)=>{
  const file=join(root,'ticket.json');if(await Bun.file(file).exists())return JSON.parse(await readFile(file));
  const ticket=await submit(sequence,signal);if(ticket.id)await writeFile(file,JSON.stringify(ticket,null,2)+'\n');return ticket;
 };
 console.log(JSON.stringify({caseId:c.id,stage:'searching',residues:c.sequence.length}));
 const result=await provider.search({entities:[{type:'protein',sequence:c.sequence}]},{onProgress:p=>console.log(JSON.stringify({caseId:c.id,stage:p.stage,status:p.status}))});
 const alignment=selectedA3m(c.sequence,result.documents);await writeFile(join(root,'selected-256.a3m'),alignment.text);
 const receipt={caseId:c.id,sequenceSha256:sha(c.sequence),provider:result.provider,endpoint:result.endpoint,mode:result.mode,
  ticketId:result.ticketId,policy,availableRows:alignment.available,selectedRows:alignment.selected,
  file:c.id+'/selected-256.a3m',sha256:sha(alignment.text),rawArchiveSha256:sha(await readFile(join(root,'raw-result.tar.gz')))};
 await writeFile(complete,JSON.stringify(receipt,null,2)+'\n');records.push(receipt);
 await writeFile(join(out,'msa-index.partial.json'),JSON.stringify({panelSha256:sha(panelBytes),policy,cases:records},null,2)+'\n');
}
await writeFile(join(out,'msa-index.json'),JSON.stringify({panelSha256:sha(panelBytes),policy,cases:records},null,2)+'\n');
console.log(JSON.stringify({complete:true,cases:records.length}));
