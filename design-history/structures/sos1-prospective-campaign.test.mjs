import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const generated = join(here, 'generated');
const campaign = JSON.parse(await readFile(
  join(generated, 'sos1-prospective-campaign.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

assert.equal(campaign.schema, 'molarium.design-campaign/v1');
assert.equal(campaign.id, 'sos1-hit-only');
assert.equal(campaign.hit.pdbId, '5OVE');
assert.equal(campaign.hit.stateId, 'AXE');
assert.equal(campaign.hit.ligandDefinition.id, 'AXE');
assert(campaign.hit.ligandDefinition.atoms.some((atom) => atom.element === 'H'));
assert.deepEqual(campaign.evaluation,
  { status:'locked-until-predictions-frozen', holdouts:[] });
assert(campaign.generator.coordinateFilesRead.length > 0);
assert(campaign.generator.coordinateFilesRead.every((path) => /5ove/i.test(path)),
  'only the hit PDB may contribute coordinates');

const preFreeze = JSON.stringify({ hit:campaign.hit, steps:campaign.steps,
  generator:campaign.generator, evaluation:campaign.evaluation });
assert(!/5ovf|5ovg|5ovh|5ovi/i.test(preFreeze),
  'the pre-freeze campaign must not identify a later crystal');
assert(!/referencePointAngstrom|Cartn|coordinatesAngstrom/i.test(JSON.stringify(campaign.steps)),
  'graph-only design steps may not contain coordinates');

for (const [asset, expected] of [
  ['sos1-5ove-protein.pdb', campaign.hit.proteinSha256],
  ['sos1-5ove-ligand.pdb', campaign.hit.ligandSha256],
]) assert.equal(sha256(await readFile(join(generated, asset))), expected,
  `${asset} must remain hash-pinned`);

assert.deepEqual(campaign.steps.map((step) => [step.referenceStateId, step.stateId]), [
  ['AXE', 'AWT'], ['AWT', 'AWZ'], ['AWZ', 'AWW'], ['AWW', 'AXH'],
]);
assert.deepEqual(campaign.steps.map((step) => step.compound), ['17', '18', '21', '23']);
for (const step of campaign.steps) {
  assert.equal(step.inputKind, 'molecular-graph-only');
  assert.equal(step.productAtomNames.length, step.posePropagationMap.productHeavyAtoms);
  assert.equal(new Set(step.productAtomNames).size, step.productAtomNames.length);
  const map = step.posePropagationMap;
  assert(map.commonHeavyAtoms >= 15, `${step.id} must retain a substantial 3D anchor`);
  assert.equal(map.commonAtoms.length, map.commonHeavyAtoms);
  assert.equal(map.commonAtoms.length + map.deletedReferenceAtoms.length,
    map.referenceHeavyAtoms);
  assert.equal(map.commonAtoms.length + map.addedProductAtoms.length,
    map.productHeavyAtoms);
  assert(map.ambiguity.candidateMaps >= 1);
}

console.log('SOS1 hit-only campaign passed coordinate-boundary, graph-map, and sequence gates');
