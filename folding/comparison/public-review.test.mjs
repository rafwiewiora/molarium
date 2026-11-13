import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {checkedBundleUrl,importPublicBundle} from './public-review.mjs';
const base='https://molarium.org/reviews/test/index.html';
test('public review rejects cross-directory paths and byte substitution',async()=>{
  const entry={file:'review/a.library.json',sha256:'0'.repeat(64)};
  assert.equal(checkedBundleUrl(entry,base).pathname,'/reviews/test/review/a.library.json');
  for(const file of ['../../a.library.json','https://example.com/a.library.json','a.library.json?x=1','%2e%2e/a.library.json'])
    assert.throws(()=>checkedBundleUrl({...entry,file},base));
  await assert.rejects(importPublicBundle(entry,{base,fetcher:async()=>new Response('{}')}),/hash mismatch/);
});
test('reopening an exact public bundle keeps local pose decisions',async()=>{
  const data=await readFile(new URL('../../reviews/cofold-crystal-reference-2026-11-13/review/181l-bnz.library.json',import.meta.url));
  const entry={file:'review/a.library.json',reference:true,sha256:createHash('sha256').update(data).digest('hex')};
  const runs=[];let imports=0;
  const store={listRuns:async()=>runs,import:async bundle=>{imports++;return {...bundle.run,id:'local-1'};},saveRun:async run=>runs.push(run)};
  const options={base,store,fetcher:async()=>new Response(data)};
  assert.equal((await importPublicBundle(entry,options)).reused,false);
  runs[0].localDecisions='preserved';
  assert.equal((await importPublicBundle(entry,options)).run.localDecisions,'preserved');assert.equal(imports,1);
  await assert.rejects(importPublicBundle({...entry,reference:false},options),/reference count/);
});
