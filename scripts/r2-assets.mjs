import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const release = String(process.env.MOLARIUM_ASSET_RELEASE || `v${packageJson.version}`).replace(/^\/+|\/+$/g, '');
const requestedOrigin = String(process.env.MOLARIUM_ASSET_ORIGIN || 'https://assets.molarium.org');
const parsedOrigin = new URL(requestedOrigin);
if (parsedOrigin.protocol !== 'https:') throw new Error('R2 asset origin must use HTTPS');
const origin = parsedOrigin.origin;
const paths = [
  'mlip/models/ani2x-manifest.json', 'mlip/models/ani2x-goldens.json',
  'mlip/models/ani2x-h.onnx', 'mlip/models/ani2x-c.onnx', 'mlip/models/ani2x-n.onnx',
  'mlip/models/ani2x-o.onnx', 'mlip/models/ani2x-f.onnx', 'mlip/models/ani2x-s.onnx',
  'mlip/models/ani2x-cl.onnx',
  'openfold-export-results/trained/models/iteration_L64.onnx',
  'openfold-export-results/trained/models/iteration.onnx.data',
  'openfold-export-results/trained/models/iteration_L128.onnx',
  'openfold-export-results/trained/models/iteration_L128.onnx.data',
];
const ortDirectory = join(root, 'node_modules/onnxruntime-web/dist');
for (const name of await readdir(ortDirectory)) {
  if (/^ort-wasm-simd-threaded.*\.(mjs|wasm)$/.test(name))
    paths.push(`node_modules/onnxruntime-web/dist/${name}`);
}

const entries = [];
const contentTypeFor = (path) => {
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  if (path.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
};
for (const source of paths.sort()) {
  const absolute = join(root, source);
  const info = await stat(absolute);
  const bytes = await readFile(absolute);
  let target = source;
  if (source.startsWith('node_modules/onnxruntime-web/dist/'))
    target = `onnxruntime-web/1.27.0/${source.split('/').at(-1)}`;
  entries.push({ source, key:`${release}/${target}`, bytes:info.size,
    contentType:contentTypeFor(target), cacheControl:'public, max-age=31536000, immutable',
    sha256:createHash('sha256').update(bytes).digest('hex') });
}
const manifest = { schema:'molarium.r2-assets.v1', release,
  origin, bucket:'molarium-assets', files:entries };
const output = join(root, 'r2-assets-manifest.json');
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${relative(root, output)} with ${entries.length} objects (${(entries.reduce((n, x) => n + x.bytes, 0) / 1024 / 1024).toFixed(2)} MiB)`);
