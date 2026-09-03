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
  join(generated, 'sos1-prospective-campaign.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

assert.equal(campaign.schema, REGISTERED_DESIGN_ROUTE_SCHEMA);
assert.equal(validateRegisteredDesignRoute(campaign, { expectedId:'sos1-hit-only' }), campaign);
assert.equal(campaign.id, 'sos1-hit-only');
assert.equal(campaign.hit.pdbId, '5OVE');
assert.equal(campaign.hit.stateId, 'AXE');
assert.equal(campaign.hit.ligandDefinition.id, 'AXE');
assert.equal(campaign.generator.rdkitVersion, '2026.03.4');
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
  if (step.id === 'finish-bay-293') {
    assert.equal(map.commonHeavyAtoms, 15);
    assert.deepEqual(map.protectedReferenceAnchor, {
      method:'maximum-common-substructure/v1',
      label:'AWW proximal quinazoline-thiophene core',
      referenceAtomNames:['C1', 'C2', 'N6', 'C11', 'N8', 'C3', 'N7', 'C12',
        'C16', 'C15', 'CX2', 'CX3', 'CX4', 'SX1', 'CX1'],
      atoms:15,
      bonds:16,
      releasedRegions:[
        'regioisomeric distal phenyl/benzylic arm',
        'hydroxymethyl-to-methylaminomethyl substituent',
      ],
    });
    assert.equal(map.mcs.atoms, map.commonHeavyAtoms);
    assert.match(map.transitionExplanation, /different thiophene positions/);
  } else {
    assert(map.commonHeavyAtoms >= 15, `${step.id} must retain a substantial 3D anchor`);
    assert.equal(map.mcs.atoms, map.commonHeavyAtoms);
  }
  assert.equal(map.commonAtoms.length, map.commonHeavyAtoms);
  assert.equal(map.commonAtoms.length + map.deletedReferenceAtoms.length,
    map.referenceHeavyAtoms);
  assert.equal(map.commonAtoms.length + map.addedProductAtoms.length,
    map.productHeavyAtoms);
  assert(map.ambiguity.candidateMaps >= 1);
}

const finalStep = campaign.steps.at(-1);
assert.equal(finalStep.label,
  'preserve the proximal quinazoline-thiophene core while rebuilding the regioisomeric distal arm');
assert.deepEqual(finalStep.posePropagationMap.commonAtoms.map((entry) => [
  entry.referenceAtomName, entry.productAtomIndex,
]), [
  ['C1', 30], ['C2', 21], ['N6', 20], ['C11', 18], ['N8', 17],
  ['C3', 16], ['N7', 15], ['C12', 13], ['C16', 14], ['C15', 12],
  ['CX2', 31], ['CX3', 9], ['CX4', 10], ['SX1', 11], ['CX1', 19],
]);

console.log('SOS1 hit-only campaign passed coordinate-boundary, graph-map, and sequence gates');
