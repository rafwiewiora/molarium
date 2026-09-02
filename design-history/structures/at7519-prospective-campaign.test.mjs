import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const generated = join(here, 'generated');
const campaign = JSON.parse(await readFile(
  join(generated, 'at7519-prospective-campaign.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

assert.equal(campaign.schema, 'molarium.design-campaign/v1');
assert.equal(campaign.id, 'cdk2-at7519-hit-only');
assert.equal(campaign.hit.pdbId, '2VTA');
assert.equal(campaign.hit.stateId, 'compound-6');
assert.equal(campaign.hit.ligandDefinition.id, 'LZ1');
assert.deepEqual(campaign.evaluation,
  { status:'locked-until-predictions-frozen', holdouts:[] });
assert.deepEqual(campaign.generator.coordinateFilesRead,
  ['outputs/design-history/at7519-preapproval/source/2VTA.pdb']);

const preFreeze = JSON.stringify({ hit:campaign.hit, steps:campaign.steps,
  generator:campaign.generator, evaluation:campaign.evaluation });
assert(!/2vtl|2vtn|2vto|2vtp|2vu3|\blz[5789e]\b/i.test(preFreeze),
  'the pre-freeze campaign must not identify or import a crystal holdout');
assert(!/referencePointAngstrom|Cartn|coordinatesAngstrom/i.test(JSON.stringify(campaign.steps)),
  'graph-only design steps may not contain coordinates');

for (const [asset, expected] of [
  ['at7519-2vta-protein.pdb', campaign.hit.proteinSha256],
  ['at7519-2vta-ligand.pdb', campaign.hit.ligandSha256],
]) assert.equal(sha256(await readFile(join(generated, asset))), expected,
  `${asset} must remain hash-pinned`);

assert.deepEqual(campaign.steps.map((step) => [step.referenceStateId, step.stateId]), [
  ['compound-6', 'compound-15'],
  ['compound-15', 'compound-18'],
  ['compound-18', 'compound-22'],
  ['compound-22', 'compound-23'],
  ['compound-23', 'compound-33'],
]);
assert.deepEqual(campaign.steps.map((step) => [
  step.posePropagationMap.referenceHeavyAtoms,
  step.posePropagationMap.commonHeavyAtoms,
  step.posePropagationMap.productHeavyAtoms,
]), [[9, 5, 14], [14, 14, 19], [19, 18, 24], [24, 24, 26], [26, 18, 25]]);

for (const step of campaign.steps) {
  assert.equal(step.inputKind, 'molecular-graph-only');
  assert.equal(step.productAtomNames.length, step.posePropagationMap.productHeavyAtoms);
  assert.equal(new Set(step.productAtomNames).size, step.productAtomNames.length);
  const map = step.posePropagationMap;
  assert.equal(map.commonAtoms.length, map.commonHeavyAtoms);
  assert.equal(map.commonAtoms.length + map.deletedReferenceAtoms.length,
    map.referenceHeavyAtoms);
  assert.equal(map.commonAtoms.length + map.addedProductAtoms.length,
    map.productHeavyAtoms);
}

const scaffoldHop = campaign.steps[0].posePropagationMap;
assert.equal(scaffoldHop.mcs.method, 'curated-five-membered-hinge-ring');
assert.equal(scaffoldHop.commonHeavyAtoms, 5);
assert.deepEqual(scaffoldHop.commonAtoms.filter((atom) => atom.element === 'N')
  .map((atom) => atom.referenceAtomName).sort(), ['N', 'N2'],
  'the graph-only scaffold-hop map must preserve both hinge nitrogens');
assert(scaffoldHop.deletedReferenceAtoms.length >= 4
  && scaffoldHop.addedProductAtoms.length >= 9,
  'the first decision must be a real scaffold hop, not an R-group add');
assert(campaign.steps[2].posePropagationMap.addedProductAtoms.length >= 6,
  'benzamide growth must add the complete aryl placement decision');
assert(campaign.steps[4].posePropagationMap.deletedReferenceAtoms.length >= 8
  && campaign.steps[4].posePropagationMap.addedProductAtoms.length >= 7,
  'the AT7519 finish must include the terminal ring/scaffold replacement');

console.log('AT7519 hit-only campaign passed five-step graph and coordinate-boundary gates');
