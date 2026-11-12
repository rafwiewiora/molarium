// Copy an immutable, unmodified browser module closure from an inspected checkout.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const revision='5ea3d42c911949700401b54003cb28c557fcf2a6';
const source=resolve(process.argv[2]||'');
if(!process.argv[2]||execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim()!==revision)
  throw new Error('Provide a LocalFold checkout at '+revision);
if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:source,encoding:'utf8'}).trim())
  throw new Error('LocalFold source must be unmodified');
const root=resolve(import.meta.dirname,'..','vendor','localfold');
const queue=['web/model.js','web/af3-model.js','webgpu/af2/model/monomer.js',
  'web/prediction-results.js','shared/chem/component.js','shared/af3/featurise/ccd-component.js'];
const seen=new Set();const records=[];
while(queue.length){
  const path=queue.shift();if(seen.has(path))continue;seen.add(path);
  const bytes=await readFile(resolve(source,path));
  if(path.endsWith('.js')){
    const text=bytes.toString();
    for(const match of text.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)["'](\.[^"'\n]+)["']/g)) {
      const next=relative(source,resolve(source,dirname(path),match[1]));
      if(next.startsWith('..')||!next.endsWith('.js'))throw new Error('Unexpected dependency '+next);
      queue.push(next);
    }
  }
  await mkdir(dirname(resolve(root,path)),{recursive:true});
  await copyFile(resolve(source,path),resolve(root,path));
  records.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
for(const path of ['LICENSE','README.md'])await copyFile(resolve(source,path),resolve(root,path));
await writeFile(resolve(root,'UPSTREAM.json'),JSON.stringify({repository:'https://github.com/sokrypton/localfold',
  revision,files:records.sort((a,b)=>a.path.localeCompare(b.path))},null,2)+'\n');
console.log('Imported unmodified LocalFold closure:',records.length,'files',records.reduce((s,r)=>s+r.bytes,0),'bytes');
