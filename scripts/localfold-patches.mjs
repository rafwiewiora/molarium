// Reproduce explicitly recorded local changes over the immutable upstream pin.
import {readFile,writeFile,mkdir,lstat}from'node:fs/promises';
import {resolve,join,dirname,isAbsolute}from'node:path';
import {execFileSync}from'node:child_process';
import {createHash}from'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeRelative=path=>typeof path==='string'&&!isAbsolute(path)&&!path.includes('\\')
 &&path.split('/').every(p=>p&&!p.startsWith('.'));
export async function applyLocalFoldPatches(repoRoot,{revision,patchRoot=resolve(import.meta.dirname,'localfold-patches')}={}){
 const declaration=JSON.parse(await readFile(join(patchRoot,'manifest.json')));
 if(declaration.schema!=='molarium.localfold-patches.v1'||declaration.revision!==revision)throw Error('LocalFold patch revision mismatch');
 const results=[];
 for(const patch of declaration.patches){
  if(![patch.path,patch.patchFile,patch.upstreamSnapshot].every(safeRelative))throw Error('Invalid local patch path');
  const target='vendor/localfold/'+patch.path,file=resolve(repoRoot,target),patchFile=resolve(patchRoot,patch.patchFile);
  const original=await readFile(resolve(patchRoot,patch.upstreamSnapshot)),diff=await readFile(patchFile);
  if(digest(original)!==patch.upstreamSha256||digest(diff)!==patch.patchSha256)throw Error('LocalFold patch/snapshot hash mismatch');
  const text=diff.toString('utf8'),before=[...text.matchAll(/^--- a\/(.+)$/gm)].map(m=>m[1]),after=[...text.matchAll(/^\+\+\+ b\/(.+)$/gm)].map(m=>m[1]);
  if(before.length!==1||after.length!==1||before[0]!==target||after[0]!==target)throw Error('LocalFold patch must change only its declared file');
  const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw Error('LocalFold patch target must be a regular file');
  const current=digest(await readFile(file));
  if(current!==patch.upstreamSha256&&current!==patch.sha256)throw Error('LocalFold patch source hash mismatch');
  if(current===patch.upstreamSha256){
   execFileSync('git',['apply','--check',patchFile],{cwd:repoRoot,stdio:'pipe'});
   execFileSync('git',['apply',patchFile],{cwd:repoRoot,stdio:'pipe'});
  }
  const patched=await readFile(file);if(digest(patched)!==patch.sha256)throw Error('LocalFold patched output hash mismatch');
  results.push({id:patch.id,path:patch.path,mode:patch.mode,activation:patch.activation,
   upstreamBytes:original.length,upstreamSha256:patch.upstreamSha256,bytes:patched.length,sha256:patch.sha256,
   patchFile:'scripts/localfold-patches/'+patch.patchFile,patchSha256:patch.patchSha256});
 }
 return results;
}
export function localFoldSourceIdentity(receiptBytes){
 const receipt=JSON.parse(receiptBytes);
 return {repository:receipt.repository,revision:receipt.revision,receiptSha256:digest(receiptBytes),
  localPatches:(receipt.localPatches??[]).map(p=>({id:p.id,path:p.path,mode:p.mode,activation:p.activation,
   upstreamSha256:p.upstreamSha256,sha256:p.sha256,patchSha256:p.patchSha256}))};
}
export async function writeLocalFoldSourceIdentity(repoRoot,receiptBytes){
 const file=resolve(repoRoot,'folding/localfold-source.mjs');await mkdir(dirname(file),{recursive:true});
 await writeFile(file,'// Generated from the complete vendored source receipt by import-localfold.mjs.\n'
  +'export const LOCALFOLD_SOURCE = Object.freeze('+JSON.stringify(localFoldSourceIdentity(receiptBytes),null,2)+');\n');
}
