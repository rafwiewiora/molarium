import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [dispatcher, frozenVerifier, packageJson] = await Promise.all([
  readFile(new URL('./verify-sos1-deployment.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./verify-sos1-frozen-browser-publication.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
]);
assert.equal(packageJson.scripts['verify:sos1-publication'],
  'node scripts/verify-sos1-deployment.mjs');
assert.match(dispatcher, /verifySos1FrozenBrowserPublication/);
assert.match(dispatcher, /verifySos1Publication/);
assert.match(frozenVerifier, /verifyCompleteFrozenSos1Run/);
assert.match(frozenVerifier, /buildFrozenSos1ReplayScript/);
assert.match(frozenVerifier, /campaign\.import/);
assert.match(frozenVerifier, /review\.bytes\.length < 1024 \* 1024/);
assert(!frozenVerifier.includes('verifyAcceptedSos1Run'));
console.log('SOS1 deployment verifier dispatch: PASS');
