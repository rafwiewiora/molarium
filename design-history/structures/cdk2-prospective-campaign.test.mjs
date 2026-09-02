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
  join(generated, 'cdk2-prospective-campaign.json'), 'utf8'));
const designerCampaign = JSON.parse(await readFile(
  join(generated, 'cdk2-designer-campaign.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

assert.equal(campaign.schema, REGISTERED_DESIGN_ROUTE_SCHEMA);
assert.equal(validateRegisteredDesignRoute(campaign, { expectedId:'cdk2-hit-only' }), campaign);
assert.equal(campaign.id, 'cdk2-hit-only');
assert.equal(campaign.hit.pdbId, '1H1Q');
assert.equal(campaign.hit.stateId, '2A6');
assert.equal(campaign.hit.ligandDefinition.id, '2A6');
assert.equal(campaign.generator.rdkitVersion, '2026.03.4');
assert.deepEqual(campaign.evaluation,
  { status:'locked-until-predictions-frozen', holdouts:[] });
assert.deepEqual(campaign.generator.coordinateFilesRead,
  ['docking/benchmark/fixtures/pdb/1h1q.pdb']);

const preFreeze = JSON.stringify({ hit:campaign.hit, steps:campaign.steps,
  generator:campaign.generator, evaluation:campaign.evaluation });
assert(!/1h1r|1oiu/i.test(preFreeze),
  'the pre-freeze campaign must not identify either crystal holdout');
assert(!/referencePointAngstrom|Cartn|coordinatesAngstrom/i.test(JSON.stringify(campaign.steps)),
  'graph-only design steps may not contain coordinates');

for (const [asset, expected] of [
  ['cdk2-1h1q-protein.pdb', campaign.hit.proteinSha256],
  ['cdk2-1h1q-ligand.pdb', campaign.hit.ligandSha256],
]) assert.equal(sha256(await readFile(join(generated, asset))), expected,
  `${asset} must remain hash-pinned`);
const proteinPdb = await readFile(join(generated, 'cdk2-1h1q-protein.pdb'), 'utf8');
assert(/^ATOM  .{11}TPO A 160/m.test(proteinPdb),
  'phosphorylated Thr160 must remain a covalent protein residue');
assert(!/^HETATM.{11}TPO A 160/m.test(proteinPdb),
  'TPO must not be misclassified as a free ligand');

assert.deepEqual(campaign.steps.map((step) => [step.referenceStateId, step.stateId]),
  [['2A6', '6CP'], ['6CP', 'N76']]);
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

assert.equal(designerCampaign.schema, REGISTERED_DESIGN_ROUTE_SCHEMA);
assert.equal(validateRegisteredDesignRoute(designerCampaign,
  { expectedId:'cdk2-designer-intent' }), designerCampaign);
assert.equal(designerCampaign.id, 'cdk2-designer-intent');
assert.equal(designerCampaign.hit.proteinSha256, campaign.hit.proteinSha256);
assert.equal(designerCampaign.generator.rdkitVersion, '2026.03.4');
assert.equal(designerCampaign.hit.ligandSha256, campaign.hit.ligandSha256);
assert(!/1h1r|1oiu/i.test(JSON.stringify(designerCampaign)),
  'designer intent must not import either later crystal');
for (const step of designerCampaign.steps) {
  assert.equal(step.inputKind, 'designer-directed-graph-only');
  assert.deepEqual(step.spatialIntent, {
    method:'selected-exit-vector', attachmentReferenceAtomName:'C19',
    declaredBeforePoseSearch:true,
  });
  const productAttachment = step.posePropagationMap.productBoundary[0].commonProductAtomIndex;
  const attachmentMapping = step.posePropagationMap.commonAtoms.find(
    (entry) => entry.productAtomIndex === productAttachment);
  assert.equal(attachmentMapping.referenceAtomName, 'C19',
    `${step.id} must grow from the designer-selected C19 exit vector`);
  assert.equal(step.productAtomNames[productAttachment], 'C19');
}

console.log('CDK2 hit-only campaign passed coordinate-boundary and sequential-state gates');
