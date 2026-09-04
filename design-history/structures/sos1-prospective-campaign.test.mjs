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
const automaticallyRequired = structuredClone(campaign);
const automaticallyRequiredFeature = automaticallyRequired.steps.at(-1)
  .posePropagationMap.spatialFeatureCorrespondences[0];
automaticallyRequiredFeature.transferMode = 'score-only';
automaticallyRequiredFeature.treatment = 'soft-restraint';
automaticallyRequiredFeature.required = true;
automaticallyRequiredFeature.source = 'automatic-proposal';
assert.throws(() => validateRegisteredDesignRoute(automaticallyRequired),
  /required soft restraint must be registered designer intent/);
const unregisteredIntent = structuredClone(campaign);
unregisteredIntent.steps.at(-1).retainedFeatureIntents = [];
assert.throws(() => validateRegisteredDesignRoute(unregisteredIntent),
  /lacks its registered route intent declaration/);
const mismatchedIntent = structuredClone(campaign);
mismatchedIntent.steps.at(-1).posePropagationMap
  .spatialFeatureCorrespondences[0].registeredIntentId = 'forged-intent';
assert.throws(() => validateRegisteredDesignRoute(mismatchedIntent),
  /lacks its registered route intent declaration/);
assert.equal(campaign.id, 'sos1-hit-only');
assert.equal(campaign.hit.pdbId, '5OVE');
assert.equal(campaign.hit.stateId, 'AXE');
assert.equal(campaign.hit.ligandDefinition.id, 'AXE');
assert.equal(campaign.generator.rdkitVersion, '2026.03.4');
assert.deepEqual(campaign.posePropagationPolicy, {
  schema:'molarium.registered-pose-propagation-policy/v1',
  atomCorrespondence:'exact-element', bondCorrespondence:'exact-order',
  ringCorrespondence:'complete-rings-only',
  changedRingTreatment:'release-from-hard-core',
  featureTransfer:'role-compatible-restraints',
});
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
      method:'exact-common-subgraph-after-topology-release/v1',
      label:'exact mapped atoms outside attachment-migrated ring blocks',
      referenceAtomNames:['C1', 'C2', 'N6', 'C11', 'N8', 'C3', 'N7', 'C12',
        'C16', 'C15', 'CX1'],
      atoms:11,
      bonds:11,
      releasedRegions:[
        'mapped biconnected ring atoms affected by attachment migration',
        'unmapped deleted and added graph regions',
      ],
    });
    assert.equal(map.mcs.atoms, map.commonHeavyAtoms);
    assert.equal(map.hardCoordinateHeavyAtoms, 11);
    assert.equal(map.releasedMappedHeavyAtoms, 4);
    assert.deepEqual(map.releasedMappedAtoms.map((entry) => entry.referenceAtomName),
      ['CX2', 'CX3', 'CX4', 'SX1']);
    assert.equal(map.mappedRingAttachmentMigrations.length, 1);
    assert.deepEqual(map.mappedRingAttachmentMigrations[0], {
      id:'mapped-ring-attachment-migration-1',
      reason:'attachment-migration-within-mapped-biconnected-ring',
      referenceBlockAtomNames:['C15', 'CX2', 'CX3', 'CX4', 'SX1'],
      productBlockAtomIndices:[12, 31, 9, 10, 11],
      referenceAttachmentAtomNames:['CX4'],
      productAttachmentReferenceAtomNames:['CX3'],
      retainedJunctionReferenceAtomNames:['C15'],
      releasedReferenceAtomNames:['CX2', 'CX3', 'CX4', 'SX1'],
      releasedProductAtomIndices:[31, 9, 10, 11],
    });
    assert.equal(map.seedMatchedHeavyAtoms, 7);
    assert.equal(map.totalReferencedHeavyAtoms, 22);
    assert.equal(map.spatialFeatureCorrespondences.length, 1);
    const feature = map.spatialFeatureCorrespondences[0];
    assert.equal(feature.kind, 'conserved-fragment-rmsd');
    assert.equal(feature.transferMode, 'score-only');
    assert.equal(feature.treatment, 'soft-restraint');
    assert.equal(feature.required, true);
    assert.equal(feature.source, 'registered-designer-intent');
    assert.equal(feature.registeredIntentId,
      'retain-terminal-feature-through-bay293');
    assert.deepEqual(step.retainedFeatureIntents.map((intent) => intent.id),
      ['retain-terminal-feature-through-bay293']);
    assert.deepEqual(feature.restraint, {
      schema:'molarium.registered-soft-spatial-feature-restraint/v1',
      metric:'graph-symmetry-minimized Cartesian RMSD', toleranceAngstrom:2.25,
      weightKcalMolPerAngstrom2:20, required:true,
      parameterDecision:{
        schema:'molarium.registered-spatial-feature-parameter-decision/v1',
        actorClass:'human', basis:'pre-holdout-diagnostic',
        sourceAttemptId:'sos1-final-retention-9a73dd8-20260904t0535z-use1b-a010-r01',
        observedBestRmsdAngstrom:2.161703263647055,
        selectedToleranceAngstrom:2.25, holdoutCoordinatesUsed:false,
      },
    });
    assert.equal(feature.mappingVariants.length, 4);
    assert.deepEqual(feature.referenceAtomNames,
      ['CX5','CX11','CX12','CX13','CX14','CX15','CX16']);
    assert.match(map.transitionExplanation, /attachment atom within a mapped biconnected ring/);
    assert.match(map.transitionExplanation, /registered designer intent/);
  } else {
    assert.deepEqual(step.retainedFeatureIntents, []);
    assert(map.commonHeavyAtoms >= 15, `${step.id} must retain a substantial 3D anchor`);
    assert.equal(map.mcs.atoms, map.commonHeavyAtoms);
    assert.equal(map.hardCoordinateHeavyAtoms, map.commonHeavyAtoms);
    assert.equal(map.releasedMappedHeavyAtoms, 0);
    assert.deepEqual(map.releasedMappedAtoms, []);
    assert.deepEqual(map.mappedRingAttachmentMigrations, []);
    assert.equal(map.seedMatchedHeavyAtoms, 0);
    assert.equal(map.totalReferencedHeavyAtoms, map.commonHeavyAtoms);
    assert.deepEqual(map.spatialFeatureCorrespondences, []);
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
