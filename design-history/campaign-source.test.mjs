import assert from 'node:assert/strict';
import { resolveCampaignAssetSource } from './campaign-source.mjs';

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
console.log('Campaign source resolver: PASS');
