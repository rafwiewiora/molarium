import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { resolveCampaignAssetSource, readCampaignAssetResponse,
  MAX_CAMPAIGN_ASSET_BYTES } from './campaign-source.mjs';

const digest = 'a'.repeat(64);
const source = resolveCampaignAssetSource(
  './design-history/publications/sos1/checkpoints/final.json', digest,
  'https://molarium.org/index.html');
assert.equal(source.url,
  'https://molarium.org/design-history/publications/sos1/checkpoints/final.json');
for (const path of ['../secret.json','/absolute.json','https://elsewhere.test/a.json',
  './campaign.json?x=1','design-history\\campaign.json'])
  assert.throws(() => resolveCampaignAssetSource(path, digest,
    'https://molarium.org/'), /relative|traversal-free/);
assert.throws(() => resolveCampaignAssetSource('./campaign.json', 'BAD',
  'https://molarium.org/'), /lowercase SHA-256/);
const canonical = Buffer.from('{"campaign":"unchanged coordinates and history"}\n');
assert.deepEqual(Buffer.from(await readCampaignAssetResponse(new Response(canonical))), canonical);
assert.deepEqual(Buffer.from(await readCampaignAssetResponse(
  new Response(gzipSync(canonical)), 'gzip')), canonical);
await assert.rejects(readCampaignAssetResponse(new Response(canonical), 'zip'), /sourceEncoding/);
await assert.rejects(readCampaignAssetResponse(new Response('not gzip'), 'gzip'));
const oversized = Buffer.alloc(MAX_CAMPAIGN_ASSET_BYTES + 1, 32);
await assert.rejects(readCampaignAssetResponse(new Response(oversized)), /32 MiB/);
await assert.rejects(readCampaignAssetResponse(new Response(gzipSync(oversized)), 'gzip'), /32 MiB/);
console.log('Campaign source resolver and bounded lossless transport: PASS');
