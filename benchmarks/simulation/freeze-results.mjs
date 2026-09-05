// Compress immutable evidence without changing any raw result or its provenance.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {basename,resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const sha=b=>createHash('sha256').update(b).digest('hex');
const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Usage: node freeze-results.mjs ATTEMPT_DIRECTORY NEW_EVIDENCE_DIRECTORY');
await mkdir(resolve(output)); // fails if already frozen
const files=[];
for(const name of (await readdir(input)).sort()){
  if(!name.endsWith('.json'))continue;
  const bytes=await readFile(join(input,name)); JSON.parse(bytes);
  const zipped=gzipSync(bytes,{level:9});
  await writeFile(join(output,`${name}.gz`),zipped,{flag:'wx'});
  files.push({name:`${name}.gz`,sha256:sha(zipped),uncompressedSha256:sha(bytes),bytes:bytes.length,compressedBytes:zipped.length});
}
if(!files.length)throw new Error('No JSON evidence to freeze');
await writeFile(join(output,'manifest.json'),JSON.stringify({schema:'molarium.simulation-benchmark-evidence/v1',attempt:basename(resolve(input)),files},null,2)+'\n',{flag:'wx'});
console.log(`Froze ${files.length} files in ${output}`);
