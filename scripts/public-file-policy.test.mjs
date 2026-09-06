import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolvePublicFile} from './public-file-policy.mjs';

test('only declared regular files inside the canonical web root are served',async()=>{
  const fixture=await mkdtemp(join(tmpdir(),'molarium-public-policy-'));
  const root=join(fixture,'public');
  try {
    await mkdir(root);
    await writeFile(join(root,'index.html'),'public');
    await writeFile(join(root,'private.json'),'private');
    await writeFile(join(root,'.env'),'secret');
    await writeFile(join(fixture,'outside.json'),'outside');
    await symlink(join(fixture,'outside.json'),join(root,'declared.json'));
    const allowed=new Set(['index.html','declared.json','.env']);
    assert.equal((await resolvePublicFile(root,'/',allowed)).relative,'index.html');
    for(const path of ['/private.json','/.env','/%2eenv','/../outside.json',
      '/%2e%2e/outside.json','/declared.json','/%2e%2e%5coutside.json',
      '/index.html%00','/%zz','/%252eenv'])
      assert.equal(await resolvePublicFile(root,path,allowed),null,path);
  } finally {await rm(fixture,{recursive:true,force:true});}
});
