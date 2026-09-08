import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyEntries, verifySubmission } from './verify-paper-submission.mjs';

test('submitted PDF, final source, figures, archive, and publication wiring agree', async () => {
  const result = await verifySubmission();
  assert.equal(result.archivedOriginals, 564);
  assert.equal(result.figures, 6);
});

test('artifact verifier rejects changed bytes, missing files, duplicates, and unsafe paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'molarium-paper-hashes-'));
  try {
    const data = Buffer.from('original');
    const entry = {path:'artifact', bytes:data.length, sha256:createHash('sha256').update(data).digest('hex')};
    await writeFile(join(dir, 'artifact'), data);
    assert.equal(await verifyEntries(dir, [entry]), 1);
    await assert.rejects(verifyEntries(dir, [entry, entry]), /Duplicate/);
    await assert.rejects(verifyEntries(dir, [{...entry,path:'../outside'}]), /escapes/);
    await assert.rejects(verifyEntries(dir, [{...entry,path:'/absolute'}]), /relative/);
    await assert.rejects(verifyEntries(dir, [{...entry,path:'missing'}]), /ENOENT/);
    await writeFile(join(dir, 'artifact'), 'tampered');
    await assert.rejects(verifyEntries(dir, [entry]), /Hash mismatch/);
    await writeFile(join(dir, 'artifact'), 'longer tampering');
    await assert.rejects(verifyEntries(dir, [entry]), /Size mismatch/);
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
});
