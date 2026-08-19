import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'r2-assets-manifest.json'), 'utf8'));
if (manifest.schema !== 'molarium.r2-assets.v1' || !Array.isArray(manifest.files))
  throw new Error('Unsupported R2 asset manifest');
const origin = new URL(manifest.origin);
if (origin.protocol !== 'https:') throw new Error('Asset origin must use HTTPS');
const rootPrefix = `${root}/`;

async function sha256(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

for (const entry of manifest.files) {
  if (!entry || typeof entry.source !== 'string' || entry.source.startsWith('/')
      || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes)
      || entry.bytes < 0 || typeof entry.key !== 'string'
      || entry.source.split(/[\\/]/).includes('..')
      || !entry.key.startsWith(`${manifest.release}/`) || entry.key.includes('..')
      || /[\\?#]/.test(entry.key))
    throw new Error('Invalid R2 asset manifest entry');
  if (entry.source.startsWith('node_modules/')) continue;
  const destination = resolve(root, entry.source);
  if (!destination.startsWith(rootPrefix)) throw new Error(`Asset path escapes checkout: ${entry.source}`);
  try {
    await access(destination);
    if ((await Bun.file(destination).size) === entry.bytes && await sha256(destination) === entry.sha256) {
      console.log(`present  ${entry.source}`);
      continue;
    }
  } catch { /* download a missing file */ }

  const url = `${manifest.origin}/${entry.key}`;
  const temporary = `${destination}.download`;
  await mkdir(dirname(destination), { recursive:true });
  await rm(temporary, { force:true });
  console.log(`fetching ${entry.source} (${(entry.bytes / 1024 / 1024).toFixed(1)} MiB)`);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
  if (await sha256(temporary) !== entry.sha256) {
    await rm(temporary, { force:true });
    throw new Error(`${entry.source}: SHA-256 mismatch`);
  }
  await rename(temporary, destination);
}

console.log('Molarium model assets are complete and verified.');
