import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'r2-assets-manifest.json'), 'utf8'));
const full = process.argv.includes('--full');
if (manifest.schema !== 'molarium.r2-assets.v1' || !Array.isArray(manifest.files))
  throw new Error('Unsupported R2 asset manifest');

const urlFor = (entry) => `${manifest.origin}/${entry.key.split('/').map(encodeURIComponent).join('/')}`;
async function verifyHeaders(entry) {
  const response = await fetch(urlFor(entry), {
    headers:{ Origin:'https://molarium.org', Range:'bytes=0-0' },
  });
  if (response.status !== 206) throw new Error(`${entry.key}: expected ranged HTTP 206, got ${response.status}`);
  const contentRange = response.headers.get('content-range') || '';
  if (contentRange !== `bytes 0-0/${entry.bytes}`)
    throw new Error(`${entry.key}: Content-Range mismatch (${contentRange || 'missing'})`);
  if ((response.headers.get('content-type') || '').toLowerCase() !== entry.contentType.toLowerCase())
    throw new Error(`${entry.key}: Content-Type mismatch (${response.headers.get('content-type')})`);
  if ((response.headers.get('cache-control') || '').toLowerCase() !== entry.cacheControl.toLowerCase())
    throw new Error(`${entry.key}: Cache-Control mismatch`);
  if (response.headers.get('access-control-allow-origin') !== 'https://molarium.org')
    throw new Error(`${entry.key}: CORS does not allow https://molarium.org`);
  await response.body?.cancel();
  console.log(`headers  ${entry.key}`);
}

async function verifyHash(entry) {
  const response = await fetch(urlFor(entry));
  if (!response.ok || !response.body) throw new Error(`${entry.key}: HTTP ${response.status}`);
  const hasher = new Bun.CryptoHasher('sha256');
  const reader = response.body.getReader();
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    hasher.update(value);
  }
  if (bytes !== entry.bytes || hasher.digest('hex') !== entry.sha256)
    throw new Error(`${entry.key}: downloaded SHA-256 mismatch`);
  console.log(`sha256  ${entry.key}`);
}

for (let start = 0; start < manifest.files.length; start += 4)
  await Promise.all(manifest.files.slice(start, start + 4).map(verifyHeaders));
if (full) for (const entry of manifest.files) await verifyHash(entry);
console.log(`Verified ${manifest.files.length} R2 assets${full ? ' including full content hashes' : ''}.`);
