// Archive a completed, source-stable regression without replacing an older attempt.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument)
  throw new Error('Usage: node scripts/archive-design-remediation.mjs INPUT_ATTEMPT NEW_ARCHIVE_DIRECTORY');
const input = resolve(inputArgument), output = resolve(outputArgument);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const rawBytes = await readFile(join(input, 'result.json'));
const raw = JSON.parse(rawBytes);
assert.equal(raw.schema, 'molarium.design-contact-remediation/v1');
assert.equal(raw.status, 'passed', 'Only a completed passing attempt can be accepted');
assert.deepEqual(raw.provenance.sourceSha256AtCompletion, raw.provenance.sourceSha256,
  'Source changed during the attempt; preserve it separately and run a source-stable attempt');
const sourceBundle = {};
for (const [path, expected] of Object.entries(raw.provenance.sourceSha256)) {
  assert(!path.startsWith('/') && !path.split('/').includes('..'), 'Source paths must remain repo-relative');
  const bytes = await readFile(join(root, path));
  assert.equal(sha256(bytes), expected, `Source changed since the attempt: ${path}`);
  sourceBundle[path] = { sha256:expected, encoding:'utf8', content:bytes.toString('utf8') };
}
assert(Object.keys(sourceBundle).length > 0);
const fixture = await readFile(join(input, 'parp2-reference.pdb'));
assert.equal(sha256(fixture), raw.provenance.parp2Reference.filteredPdbSha256);
const payloads = [
  ['result.json.gz', rawBytes],
  ['source-bundle.json.gz', Buffer.from(JSON.stringify(sourceBundle, null, 2) + '\n')],
  ['parp2-reference.pdb.gz', fixture],
];
// Exclusive directory creation: a later run can never overwrite accepted evidence.
await mkdir(output, { recursive:false });
const files = [];
for (const [path, bytes] of payloads) {
  const compressed = gzipSync(bytes, { level:9 });
  await writeFile(join(output, path), compressed, { flag:'wx' });
  files.push({ path, encoding:'gzip', bytes:compressed.length, sha256:sha256(compressed),
    decodedBytes:bytes.length, decodedSha256:sha256(bytes) });
}
const manifest = { schema:'molarium.design-remediation-archive/v1',
  archivedAt:new Date().toISOString(), startedAt:raw.startedAt, finishedAt:raw.finishedAt,
  acceptance:'passed-source-stable-development-regression', findings:raw.protocol.findings,
  gitHead:raw.provenance.gitHead, sourceSha256:raw.provenance.sourceSha256, files };
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag:'wx' });
console.log(`Archived ${files.length} verified artifacts in ${output}`);
