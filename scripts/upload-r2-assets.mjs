import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'r2-assets-manifest.json'), 'utf8'));
const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
const dryRun = process.argv.includes('--dry-run');
const concurrency = Math.max(1, Math.min(4, Number(process.env.MOLARIUM_UPLOAD_JOBS) || 2));

if (manifest.schema !== 'molarium.r2-assets.v1' || !Array.isArray(manifest.files))
  throw new Error('Unsupported R2 asset manifest');
if (!endpoint || new URL(endpoint).protocol !== 'https:')
  throw new Error('Set CLOUDFLARE_R2_ENDPOINT to https://<account-id>.r2.cloudflarestorage.com');
if (!dryRun && !Bun.which('aws')) throw new Error('AWS CLI v2 is required for resumable multipart uploads');
if (!dryRun && (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY))
  throw new Error('Set narrowly scoped AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY for molarium-assets');

let next = 0;
async function worker() {
  while (next < manifest.files.length) {
    const entry = manifest.files[next++];
    const source = resolve(root, entry.source);
    if (!source.startsWith(`${root}/`) || !(await Bun.file(source).exists()))
      throw new Error(`Missing or unsafe asset source: ${entry.source}`);
    const destination = `s3://${manifest.bucket}/${entry.key}`;
    const args = ['aws', 's3', 'cp', source, destination, '--endpoint-url', endpoint,
      '--content-type', entry.contentType, '--cache-control', entry.cacheControl,
      '--only-show-errors'];
    console.log(`${dryRun ? 'would upload' : 'uploading'} ${entry.source} -> ${entry.key}`);
    if (dryRun) continue;
    const process = Bun.spawn(args, {
      cwd:root, stdout:'inherit', stderr:'inherit',
      env:{ ...Bun.env, AWS_REGION:'auto', AWS_DEFAULT_REGION:'auto' },
    });
    const exitCode = await process.exited;
    if (exitCode !== 0) throw new Error(`Upload failed for ${entry.source} (exit ${exitCode})`);
  }
}

await Promise.all(Array.from({ length:concurrency }, () => worker()));
console.log(`${dryRun ? 'Validated' : 'Uploaded'} ${manifest.files.length} versioned R2 assets.`);
