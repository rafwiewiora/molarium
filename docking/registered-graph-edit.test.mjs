import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildRegisteredPoseTransferPlan,
  validateRegisteredPosePropagationPolicy } from './registered-graph-edit.mjs';
import { validateRegisteredDesignRoute } from
  '../design-history/structures/design-route.mjs';

const route = JSON.parse(await readFile(new URL(
  '../design-history/structures/generated/sos1-prospective-campaign.json', import.meta.url)));
validateRegisteredDesignRoute(route);
const policy = validateRegisteredPosePropagationPolicy(route.posePropagationPolicy);
const finalStep = route.steps.find((step) => step.id === 'finish-bay-293');
const semantics = buildRegisteredPoseTransferPlan(finalStep.posePropagationMap, policy);

assert.equal(semantics.schema, 'molarium.pose-transfer-plan/v2');
assert.equal(semantics.editKind, 'attachment-rewire');
assert.equal(semantics.elementAgnosticAtomMatching, false);
assert.equal(semantics.mappedAtomPairs.length, 15);
assert.equal(semantics.hardConstraintAtomNames.length, 10);
assert.equal(semantics.exactAtomPairs.length, 10);
assert.equal(semantics.releasedMappedAtomPairs.length, 5);
assert.equal(semantics.exactAtomPairs.every((entry) =>
  entry.match === 'exact-element-and-conserved-bond-graph'), true);
assert.equal(semantics.releasedRegions[0].reason, 'attachment-rewire');
assert.equal(semantics.releasedRegions[1].reason,
  'attachment-migration-within-mapped-biconnected-ring');
assert.equal(semantics.releasedRegions[2].reason,
  'edit-associated-ring-bearing-mapped-rotor-distal-release');
assert.deepEqual(semantics.releasedRegions[2].referenceBondAtomNames,
  ['C12','C15']);
assert.deepEqual(semantics.releasedRegions[2].coordinateInputs, []);
assert.deepEqual(semantics.releasedBoundaryAtomNames, ['CX4']);
assert.deepEqual(semantics.introducedBoundaryAtomNames, ['CX3']);
assert.ok(semantics.releasedReferenceAtomNames.includes('CX5'));
assert.deepEqual(semantics.releasedMappedAtomNames,
  ['C15', 'CX2', 'CX3', 'CX4', 'SX1']);
assert.ok(semantics.addedProductAtomIndices.includes(8));
assert.match(semantics.featureRule, /registered designer-intent retention/);
assert.equal(semantics.featureCorrespondences.length, 1);
assert.deepEqual(semantics.featureCorrespondences[0].mappingVariants[0], {
  referenceAtomNames:['CX5','CX11','CX12','CX13','CX14','CX15','CX16'],
  productAtomIndices:[8,7,6,5,4,3,2],
});
assert.equal(semantics.featureCorrespondences[0].mappingVariants.length, 4,
  'phenyl graph symmetry must remain explicit while seeds are enumerated');
assert.equal(semantics.featureCorrespondences[0].transferMode, 'score-only');
assert.equal(semantics.featureCorrespondences[0].treatment, 'soft-restraint');
assert.equal(semantics.featureCorrespondences[0].required, true);
assert.equal(semantics.featureCorrespondences[0].registeredIntentId,
  'retain-terminal-feature-through-bay293');
assert.deepEqual(semantics.featureCorrespondences[0].restraint, {
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

const requiredFeature = structuredClone(finalStep.posePropagationMap);
requiredFeature.spatialFeatureCorrespondences[0] = {
  ...requiredFeature.spatialFeatureCorrespondences[0], source:'automatic-proposal',
};
assert.throws(() => buildRegisteredPoseTransferPlan(requiredFeature, policy),
  /lacks registered designer intent/);

const growth = buildRegisteredPoseTransferPlan({
  commonAtoms:[
    { referenceAtomName:'A', productAtomIndex:0, element:'C' },
    { referenceAtomName:'B', productAtomIndex:1, element:'C' },
    { referenceAtomName:'C', productAtomIndex:2, element:'N' },
  ],
  deletedReferenceAtoms:[], addedProductAtoms:[{ productAtomIndex:3, element:'C' }],
  referenceBoundary:[], productBoundary:[{ commonProductAtomIndex:2 }],
}, policy);
assert.equal(growth.editKind, 'fragment-growth');
assert.throws(() => validateRegisteredPosePropagationPolicy({ ...policy,
  atomCorrespondence:'any-element' }), /must be exact-element/);

console.log('registered graph edits distinguish exact atom identity from pharmacophore transfer');
