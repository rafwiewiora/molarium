import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGISTERED_DESIGN_ROUTE_SCHEMA,
  validateRegisteredDesignRoute } from './design-route.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const generated = join(here, 'generated');
const campaign = JSON.parse(await readFile(
  join(generated, 'bclxl-prospective-campaign.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

assert.equal(campaign.schema, REGISTERED_DESIGN_ROUTE_SCHEMA);
assert.equal(validateRegisteredDesignRoute(campaign, { expectedId:'bclxl-hit-only' }), campaign);
assert.equal(campaign.id, 'bclxl-hit-only');
assert.equal(campaign.hit.pdbId, '3SPF');
assert.equal(campaign.hit.ligand, 'B50');
assert.equal(campaign.hit.ligandDefinition.id, 'B50');
assert.equal(campaign.generator.rdkitVersion, '2026.03.4');
assert(campaign.hit.ligandDefinition.atoms.some((atom) => atom.element === 'H'));
assert.deepEqual(campaign.evaluation,
  { status:'locked-until-predictions-frozen', holdouts:[] });
assert.deepEqual(campaign.generator.coordinateFilesRead,
  ['3SPF-B50-bound.sdf', 'generated/3spf-ligand.pdb']);
assert(!/3sp7|03b|bm903/i.test(JSON.stringify({
  hit:campaign.hit, steps:campaign.steps,
  coordinateFilesRead:campaign.generator.coordinateFilesRead,
})), 'pre-freeze campaign inputs must not identify or contain the later structure');

for (const [asset, expected] of [
  ['3spf-protein.pdb', campaign.hit.proteinSha256],
  ['3spf-ligand.pdb', campaign.hit.ligandSha256],
]) assert.equal(sha256(await readFile(join(generated, asset))), expected,
  `${asset} must remain hash-pinned`);

assert.deepEqual(campaign.steps.map((step) => step.id),
  ['compound-6', 'compound-7', 'compound-16', 'compound-21']);
for (const step of campaign.steps) {
  assert.equal(step.inputKind, 'molecular-graph-only');
  assert(step.productSmiles && step.standardInchiKey);
  const map = step.posePropagationMap;
  assert(map.commonHeavyAtoms > 0 && map.commonHeavyAtoms <= map.referenceHeavyAtoms);
  assert.equal(map.commonAtoms.length, map.commonHeavyAtoms);
  assert.equal(map.commonAtoms.length + map.deletedReferenceAtoms.length,
    map.referenceHeavyAtoms);
  assert.equal(map.commonAtoms.length + map.addedProductAtoms.length,
    map.productHeavyAtoms);
  assert(!map.commonAtoms.some((entry) => 'referencePointAngstrom' in entry),
    'graph maps may not smuggle coordinate copies');
}

console.log('BCL-xL hit-only campaign passed coordinate-boundary and graph-map gates');
