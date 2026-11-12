import {execFileSync} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const source=resolve(process.argv[2]??''),root=resolve(import.meta.dirname,'..'),out=join(root,'vendor/foldarium');
if(!process.argv[2])throw new Error('Usage: node scripts/import-foldarium-review.mjs /path/to/clean/foldarium');
const git=(...args)=>execFileSync('git',['-C',source,...args],{encoding:'utf8'}).trim();
if(git('status','--porcelain'))throw new Error('Commit the Foldarium source before importing it.');
const paths=['library-format.js','library-store.js','library-alignment.js','library-chemistry.js','library-review.js',
  'library-review.html','library-review.css','LICENSE','assets/foldarium-mark.svg'];
const hash=b=>createHash('sha256').update(b).digest('hex');
const receipt={repository:'https://github.com/rafwiewiora/foldarium',revision:git('rev-parse','HEAD'),
  transformation:'Only the two Mol* 5.11.0 CDN URLs in library-review.html are replaced with existing same-version local assets.',files:[]};
// Read immutable Git objects so a concurrent checkout cannot mix source revisions.
for(const path of paths){const upstream=execFileSync('git',['-C',source,'show',`${receipt.revision}:${path}`]);let bytes=upstream;
  if(path==='library-review.html')bytes=Buffer.from(upstream.toString().replace(
    'https://cdn.jsdelivr.net/npm/molstar@5.11.0/build/viewer/molstar.css','../../docking/validation/pose-viewer/vendor/molstar-5.11.0.css').replace(
    'https://cdn.jsdelivr.net/npm/molstar@5.11.0/build/viewer/molstar.js','../../docking/validation/pose-viewer/vendor/molstar-5.11.0.js'));
  await mkdir(dirname(join(out,path)),{recursive:true});await writeFile(join(out,path),bytes);
  receipt.files.push({path,bytes:bytes.length,sha256:hash(bytes),upstreamSha256:hash(upstream)});
}
await writeFile(join(out,'UPSTREAM.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(`Imported Foldarium ${receipt.revision}: ${paths.length} files.`);
