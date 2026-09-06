import {readFileSync,readdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const base=new URL('./results/',import.meta.url);
export const evidenceSha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function readEvidence(directory,name,expectedHash) {
  const manifest=JSON.parse(readFileSync(new URL(`${directory}/manifest.json`,base)));
  const entry=manifest.files.find(f=>f.name===name+'.gz');
  if(!entry)throw new Error(`Missing evidence: ${directory}/${name}`);
  const bytes=readFileSync(new URL(`${directory}/${entry.name}`,base));
  if(evidenceSha(bytes)!==entry.sha256)throw new Error('Compressed evidence hash mismatch');
  const raw=gunzipSync(bytes),hash=evidenceSha(raw);
  if(hash!==entry.uncompressedSha256||raw.length!==entry.bytes||(expectedHash&&hash!==expectedHash))
    throw new Error('Uncompressed evidence hash/size mismatch');
  return {data:JSON.parse(raw),sha256:hash};
}
export function evidenceByHash(hash) {
  for(const directory of readdirSync(base,{withFileTypes:true}).filter(d=>d.isDirectory())) {
    const manifest=JSON.parse(readFileSync(new URL(`${directory.name}/manifest.json`,base)));
    const entry=manifest.files.find(f=>f.uncompressedSha256===hash);
    if(entry)return readEvidence(directory.name,entry.name.slice(0,-3),hash);
  }
  throw new Error(`Missing referenced evidence: ${hash}`);
}
