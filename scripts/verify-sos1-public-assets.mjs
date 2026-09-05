#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { SOS1_INTENT_RELEASE } from './sos1-intent-release.mjs';
import { ARCHIVED_SOS1_VIDEO_PATH } from './web-bundle-dependencies.mjs';

const [baseArg, reportArg] = process.argv.slice(2);
assert(baseArg, 'Expected the explicit deployment origin to verify');
const base = new URL(baseArg);
assert(['http:', 'https:'].includes(base.protocol));
const root = resolve(import.meta.dirname, '..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const declaration = await readFile(resolve(root, SOS1_INTENT_RELEASE));
const files = new Map([[SOS1_INTENT_RELEASE, { path:SOS1_INTENT_RELEASE,
  bytes:declaration.length, sha256:digest(declaration) }]]);
const visit = (value) => {
  if (!value || typeof value !== 'object') return;
  if (typeof value.path === 'string') {
    assert(value.path.startsWith('design-history/publications/sos1/designer-intent-2026-09-04/'));
    assert(!value.path.split('/').includes('..'));
    files.set(value.path, value);
  }
  for (const nested of Object.values(value)) visit(nested);
};
visit(JSON.parse(declaration));
const popupPath = 'design-history/publications/sos1/designer-intent-2026-09-04/checkpoint-popups-v2/movie.json';
try {
  const bytes = await readFile(resolve(root,popupPath));
  files.set(popupPath,{ path:popupPath,bytes:bytes.length,sha256:digest(bytes) });
  visit(JSON.parse(bytes));
} catch (error) { if (error.code !== 'ENOENT') throw error; }
files.delete(ARCHIVED_SOS1_VIDEO_PATH);
const archived = await fetch(new URL(`/${ARCHIVED_SOS1_VIDEO_PATH}`,base),
  { redirect:'manual', cache:'no-store', signal:AbortSignal.timeout(30000) });
assert.equal(archived.status,302,'The full calculation recording must no longer be served');
assert.equal(new URL(archived.headers.get('location'),base).pathname,'/sos1');
const queue = [...files.values()], checked = [];
await Promise.all(Array.from({ length:3 }, async () => {
  for (;;) {
    const file = queue.shift();
    if (!file) return;
    const url = new URL(`/${file.path}`, base);
    const response = await fetch(url, { cache:'no-store', signal:AbortSignal.timeout(120000) });
    assert.equal(response.status, 200, `HTTP response for ${file.path}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, file.bytes, `Deployed byte count: ${file.path}`);
    assert.equal(digest(bytes), file.sha256, `Deployed hash: ${file.path}`);
    checked.push({ path:file.path, bytes:bytes.length, sha256:file.sha256 });
  }
}));
checked.sort((a,b) => a.path.localeCompare(b.path));
const report = { schema:'molarium.sos1-public-asset-verification/v1',
  origin:base.origin, verifiedAt:new Date().toISOString(), passed:true,
  files:checked, archivedVideos:[{ path:ARCHIVED_SOS1_VIDEO_PATH,
    status:archived.status, redirect:'/sos1' }] };
if (reportArg) await writeFile(resolve(reportArg), `${JSON.stringify(report,null,2)}\n`, { flag:'wx' });
console.log(`SOS1 deployed bytes: PASS (${checked.length} files, ${base.origin})`);
