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
assert.equal(semantics.hardConstraintAtomNames.length, 15);
assert.equal(semantics.exactAtomPairs.length, 15);
assert.equal(semantics.exactAtomPairs.every((entry) =>
  entry.match === 'exact-element-and-conserved-bond-graph'), true);
assert.equal(semantics.releasedRegions[0].reason, 'attachment-rewire');
assert.deepEqual(semantics.releasedBoundaryAtomNames, ['CX4']);
assert.deepEqual(semantics.introducedBoundaryAtomNames, ['CX3']);
assert.ok(semantics.releasedReferenceAtomNames.includes('CX5'));
assert.ok(semantics.addedProductAtomIndices.includes(8));
assert.match(semantics.featureRule, /restraints, not atom identity/);

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
