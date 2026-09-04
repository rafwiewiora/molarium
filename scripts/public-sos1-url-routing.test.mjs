import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const [server, build] = await Promise.all([
  readFile(resolve(root, 'server.js'), 'utf8'),
  readFile(resolve(root, 'scripts/build-web.mjs'), 'utf8'),
]);

for (const source of [server, build]) {
  assert(source.includes('/sos1-hit-to-bay293'));
  assert(source.includes('/?story=sos1-hit-to-bay293'));
  assert(source.includes('/sos1-hit-to-bay293/review'));
  assert(source.includes('/?story=sos1-hit-to-bay293-review'));
  assert(!source.includes(
    '/sos1-hit-to-bay293/replay /design-history/structure-viewer/'));
  assert(!source.includes(
    '/design-history/structure-viewer/?story=sos1-hit-to-bay293-review'));
}

console.log('Public SOS1 URL routing: PASS');
