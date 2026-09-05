import assert from 'node:assert/strict';
import { releasePath, verifyNativeScriptAudit } from './sos1-intent-release.mjs';
assert.throws(() => releasePath('/tmp/release', '../escape'), /escapes/);
assert.throws(() => releasePath('/tmp/release', '/absolute'));
assert.equal(releasePath('/tmp/release', 'evidence/file.json'), '/tmp/release/evidence/file.json');
const hash = 'a'.repeat(64), prefix = `story-${hash.slice(0,12)}`;
const script = { actions:[
  { action:'session.inspect', args:{ scope:'ligand' }, capture:{ atoms:'atoms' },
    expect:{ valid:true } },
  { action:'view.highlightAtoms', args:{ atomIds:{ $binding:'atoms' } } },
] };
const audit = { records:[
  { requestId:`${prefix}-1`, status:'completed', action:'session.inspect',
    args:{ scope:'ligand' }, result:{ atoms:['a','b'], valid:true } },
  { requestId:`${prefix}-2`, status:'completed', action:'view.highlightAtoms',
    args:{ atomIds:['a','b'] }, result:{} },
] };
assert.equal(verifyNativeScriptAudit(script, audit, hash), true);
for (const mutate of [
  (records) => records.pop(),
  (records) => records.push(records[0]),
  (records) => { records[0].result.valid = false; },
  (records) => { records[1].args.atomIds = ['other']; },
  (records) => { records[1].status = 'failed'; },
]) {
  const changed = structuredClone(audit); mutate(changed.records);
  assert.throws(() => verifyNativeScriptAudit(script, changed, hash));
}
console.log('SOS1 release audit binding and safe paths: PASS');
