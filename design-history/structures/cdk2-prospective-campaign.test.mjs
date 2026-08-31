import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const generated = join(here, 'generated');
const campaign = JSON.parse(await readFile(
  join(generated, 'cdk2-prospective-campaign.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

assert.equal(campaign.schema, 'molarium.design-campaign/v1');
assert.equal(campaign.id, 'cdk2-hit-only');
assert.equal(campaign.hit.pdbId, '1H1Q');
assert.equal(campaign.hit.stateId, '2A6');
assert.equal(campaign.hit.ligandDefinition.id, '2A6');
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

console.log('CDK2 hit-only campaign passed coordinate-boundary and sequential-state gates');
