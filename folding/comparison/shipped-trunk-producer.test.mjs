import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const repo=new URL('../../',import.meta.url),sha=raw=>createHash('sha256').update(raw).digest('hex');
test('shipped-weight producer reverses exactly to the declared measured FP32 producer',async()=>{
  const cert=JSON.parse(await readFile(new URL('reviews/cofold-feature-parity-2026-11-13/shipped-trunk-weights/next-control/producer-adaptation.json',repo)));
  const base=await readFile(new URL(cert.baseFile,repo)),producer=await readFile(new URL(cert.producerFile,repo));
  assert.equal(sha(base),cert.baseSha256);assert.equal(sha(producer),cert.producerSha256);
  let reversed=producer.toString();
  for(const patch of cert.changes.toReversed()){
    assert.equal(reversed.split(patch.to).length-1,patch.occurrences);
    reversed=reversed.replaceAll(patch.to,patch.from);
  }
  assert.equal(reversed,base.toString());
});
test('actual interpolated browser expression parses before requesting hardware',async()=>{
  const source=await readFile(new URL('scripts/cofold-shipped-trunk.browser.mjs',repo),'utf8');
  const first=source.indexOf('String.raw`'),end=source.indexOf('`);',first);
  assert(first>=0&&end>first);
  const template=source.slice(first,end+1);
  const expression=new Function('token','return '+template)('test-token');
  assert.doesNotThrow(()=>new Function('return '+expression));
});
