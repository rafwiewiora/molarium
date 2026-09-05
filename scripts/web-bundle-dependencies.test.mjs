import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { browserModuleClosure, sos1ReleaseWebFiles } from './web-bundle-dependencies.mjs';

const root = await mkdtemp(join(tmpdir(), 'molarium-web-closure-test-'));
try {
  await mkdir(join(root, 'nested'));
  await writeFile(join(root, 'app.js'), "import './nested/a.mjs';\n");
  await writeFile(join(root, 'nested/a.mjs'), "export { x } from './b.mjs';\n");
  await writeFile(join(root, 'nested/b.mjs'), "export const x = import('../worker.mjs');\n");
  await writeFile(join(root, 'worker.mjs'), "new URL('./leaf.js', import.meta.url);\n");
  await writeFile(join(root, 'leaf.js'), "import './nested/a.mjs';\n");
  assert.deepEqual(await browserModuleClosure(root, ['app.js']),
    ['app.js','nested/a.mjs','nested/b.mjs','worker.mjs','leaf.js']);
  await writeFile(join(root, 'bad.js'), "import '../outside.mjs';\n");
  await assert.rejects(browserModuleClosure(root, ['bad.js']), /escapes/);
  await writeFile(join(root, 'bad.js'), "import './missing.mjs';\n");
  await assert.rejects(browserModuleClosure(root, ['bad.js']), /ENOENT/);
  assert.deepEqual(await sos1ReleaseWebFiles(root), []);
  const prefix = 'design-history/publications/sos1/designer-intent-2026-09-04';
  await mkdir(join(root, prefix), { recursive:true });
  const declaration = join(root, prefix, 'release.json');
  await writeFile(declaration, JSON.stringify({ nested:{ asset:{ path:`${prefix}/movie.mp4` } } }));
  assert.deepEqual(await sos1ReleaseWebFiles(root), [`${prefix}/release.json`, 'sos1.html', `${prefix}/movie.mp4`]);
  await writeFile(declaration, JSON.stringify({ asset:{ path:`${prefix}/../escape` } }));
  await assert.rejects(sos1ReleaseWebFiles(root));
  const build = await readFile(resolve(import.meta.dirname, 'build-web.mjs'), 'utf8');
  assert(!/^\s*['"]\/sos1 \/sos1\.html 30[1278]['"]/m.test(build),
    'Cloudflare canonical HTML redirects must not form a /sos1 loop');
  console.log('Web bundle recursive dependencies and release paths: PASS');
} finally { await rm(root, { recursive:true, force:true }); }
