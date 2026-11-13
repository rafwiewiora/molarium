import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateLibrary} from '../../vendor/foldarium/library-format.js';
const base=new URL('../../reviews/cofold-recent-pdb-2026-11-13/',import.meta.url);
const hash=b=>createHash('sha256').update(b).digest('hex');
test('recent review preserves every original prediction, exact source hashes and separate reference cards',async()=>{
  const panelBytes=await readFile(new URL('panel.json',base)),panel=JSON.parse(panelBytes);
  const index=JSON.parse(await readFile(new URL('review-index.json',base)));
  assert.equal(index.panelSha256,hash(panelBytes));assert.equal(index.cases.length,9);
  let predictions=0;
  for(const [i,c]of panel.cases.entries()){
    const raw=new Map();
    for(const phase of index.phases){
      const bytes=await readFile(new URL(`${phase.directory}/library-${i+1}.json`,base));
      const bundle=validateLibrary(JSON.parse(bytes));assert.equal(bundle.decisions.length,0);
      assert.equal(bundle.run.request.sequence,c.sequence);
      for(const pose of bundle.poses){
        assert.equal(hash(pose.result.pdb),pose.result.provenance.outputPdbSha256);
        raw.set(hash(bytes)+'::'+pose.id,pose);
      }
    }
    const entry=index.cases.find(e=>e.id===c.id);let referenceCount=0;
    for(const descriptor of [entry.predictions,entry.withReference]){
      const bytes=await readFile(new URL(descriptor.file,base));assert.equal(hash(bytes),descriptor.sha256);
      const bundle=validateLibrary(JSON.parse(bytes));assert.equal(bundle.decisions.length,0);
      const saved=bundle.poses.filter(p=>p.role!=='experimental-reference');assert.equal(saved.length,raw.size);
      const seen=new Set();
      for(const pose of saved){
        const key=pose.sourcePose.librarySha256+'::'+pose.sourcePose.id;
        assert.ok(raw.has(key));assert.ok(!seen.has(key));seen.add(key);
        assert.equal(pose.result.pdb,raw.get(key).result.pdb);
        assert.equal(pose.seed,raw.get(key).seed);
        assert.deepEqual(pose.result.provenance,raw.get(key).result.provenance);
      }
      const refs=bundle.poses.filter(p=>p.role==='experimental-reference');
      assert.equal(refs.length,descriptor.reference?1:0);referenceCount+=refs.length;
      if(refs.length)assert.equal(refs[0].result.provenance.sourceReferenceSha256,c.referenceSha256);
    }
    assert.equal(referenceCount,1);predictions+=raw.size;
  }
  assert.equal(predictions,index.predictions);
});
