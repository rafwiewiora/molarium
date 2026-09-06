import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVED_SOS1_VIDEO_PATH } from './web-bundle-dependencies.mjs';
import { sourceWebFiles } from './web-source-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const requestedAssetOrigin = String(process.env.MOLARIUM_ASSET_ORIGIN || 'https://assets.molarium.org');
const parsedAssetOrigin = new URL(requestedAssetOrigin);
if (!['https:', 'http:'].includes(parsedAssetOrigin.protocol))
  throw new Error(`Unsupported asset origin protocol: ${parsedAssetOrigin.protocol}`);
const assetOrigin = parsedAssetOrigin.origin;
const assetRelease = String(process.env.MOLARIUM_ASSET_RELEASE || `v${packageJson.version}`).replace(/^\/+|\/+$/g, '');
const assetBase = `${assetOrigin}/${assetRelease}/`;

const files = await sourceWebFiles(root);

// Fail during the build, rather than in the browser, when a top-level app
// module is omitted from the explicit Cloudflare bundle.
const deployedFiles = new Set(files);
const appSource = await readFile(join(root, 'app.js'), 'utf8');
for (const match of appSource.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]/g)) {
  const importedPath = match[1].replace(/^\.\//, '');
  if (!deployedFiles.has(importedPath))
    throw new Error(`app.js imports ${importedPath}, but the web bundle omits it`);
}

const headers = `/*
  Cache-Control: no-cache
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  Origin-Agent-Cluster: ?1
  Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), serial=(), usb=()
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Content-Security-Policy: default-src 'self'; base-uri 'none'; connect-src 'self' ${assetOrigin} https://files.rcsb.org https://api.colabfold.com; font-src 'self'; form-action 'none'; frame-ancestors 'none'; frame-src 'none'; img-src 'self' data: blob:; manifest-src 'self'; media-src 'self' blob:; object-src 'none'; script-src 'self' ${assetOrigin} blob: 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:
`;

await rm(output, { recursive: true, force: true });
for (const path of files) {
  const source = join(root, path);
  const destination = join(output, path);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination);
}

await writeFile(join(output, 'runtime-config.js'),
  `globalThis.MOLARIUM_RUNTIME_CONFIG = Object.freeze(${JSON.stringify({
    mode:'connected', localOnly:false, policy:'connected-v1',
    allowedNetworkOrigins:[assetOrigin, 'https://files.rcsb.org', 'https://api.colabfold.com'],
    buildManifest:'./local-lab-manifest.json', assetBase,
  })});\n`);
await writeFile(join(output, '_headers'), headers);
await writeFile(join(output, '_redirects'), [
  // Pages serves sos1.html at /sos1 and canonicalizes /sos1.html back to it.
  // An explicit /sos1 -> /sos1.html redirect would therefore loop.
  '/sos1/ /sos1 302',
  '/reproductions/ /reproductions 302',
  '/sos1-hit-to-bay293/movies /sos1 302',
  `/${ARCHIVED_SOS1_VIDEO_PATH} /sos1 302`,
  '/sos1-hit-to-bay293/movie /sos1#movie 302',
  '/sos1-hit-to-bay293/replay /?story=sos1-hit-to-bay293-review 302',
  '/sos1-hit-to-bay293/replay/ /?story=sos1-hit-to-bay293-review 302',
  '/sos1-hit-to-bay293/review /?story=sos1-hit-to-bay293-review 302',
  '/sos1-hit-to-bay293/review/ /?story=sos1-hit-to-bay293-review 302',
  '/sos1-hit-to-bay293 /?story=sos1-hit-to-bay293 302',
  '/sos1-hit-to-bay293/ /?story=sos1-hit-to-bay293 302',
  '',
].join('\n'));

const manifestFiles = [];
// Cloudflare Pages consumes `_headers` as deployment configuration and does not
// guarantee that it remains fetchable as a public asset. Verify only files the
// deployed application can retrieve.
for (const path of [...files, 'runtime-config.js'].sort()) {
  const bytes = await readFile(join(output, path));
  if (bytes.length > 25 * 1024 * 1024)
    throw new Error(`${path} is ${(bytes.length / 1024 / 1024).toFixed(2)} MiB; Cloudflare Pages permits at most 25 MiB`);
  manifestFiles.push({ path, bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex') });
}
const manifest = {
  schema:'molarium.web-release.v1', algorithm:'SHA-256', version:packageJson.version,
  assetBase, files:manifestFiles,
};
await writeFile(join(output, 'local-lab-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const totalBytes = manifestFiles.reduce((sum, entry) => sum + entry.bytes, 0);
console.log(`Built ${relative(root, output)}: ${manifestFiles.length} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`External assets: ${assetBase}`);
