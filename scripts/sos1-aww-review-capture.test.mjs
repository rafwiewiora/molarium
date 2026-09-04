import assert from 'node:assert/strict';
import { diagnosticPoseApplyArgs, diagnosticReviewCaptureRecord,
  SOS1_AWW_REVIEW_CAPTURE_SCHEMA } from './sos1-aww-review-capture.mjs';

const digest = (digit) => digit.repeat(64);
const refinement = {
  selectedRank:3,
  inputCoordinateSha256:digest('1'),
  selectedCoordinateSha256:digest('2'),
  inputStateSha256:digest('3'),
  selectedStateSha256:digest('4'),
};
assert.deepEqual(diagnosticPoseApplyArgs(refinement), {
  index:2,
  allowInfeasible:true,
  expectedInputCoordinateSha256:digest('1'),
  expectedSelectedCoordinateSha256:digest('2'),
  expectedInputStateSha256:digest('3'),
  expectedSelectedStateSha256:digest('4'),
});
assert.throws(() => diagnosticPoseApplyArgs({ ...refinement, selectedRank:0 }),
  /positive selectedRank/);
assert.throws(() => diagnosticPoseApplyArgs({ ...refinement,
  selectedCoordinateSha256:'unhashed' }), /lowercase SHA-256/);

const pocket = { scope:'pocket', truncated:false, totalAtomCount:2,
  atoms:[{ atomId:'ligand' }, { atomId:'receptor' }], contacts:[{ contactId:'hbond' }] };
const capture = diagnosticReviewCaptureRecord({ refinement,
  branch:'phe-native', eligible:false, pocket,
  appliedPose:{ index:2, rank:3, infeasibleOverride:true,
    selectedCoordinateSha256:digest('2'), selectedStateSha256:digest('4'),
    outputCoordinateSha256:digest('5'), outputStateSha256:digest('6') } });
assert.equal(capture.schema, SOS1_AWW_REVIEW_CAPTURE_SCHEMA);
assert.equal(capture.diagnosticOnly, true);
assert.equal(capture.promotable, false);
assert.equal(capture.eligibilityUnchanged, false);
assert.equal(capture.selectedFeasible, false);
assert.equal(capture.selectedRank, 3);
assert.equal(capture.appliedPoseIndex, 2);
assert.equal(capture.allowInfeasible, true);
assert.equal(capture.infeasibleOverride, true);
assert.equal(capture.pocketAtomCount, 2);
assert.equal(capture.contactAnnotationCount, 1);
assert.throws(() => diagnosticReviewCaptureRecord({ refinement, branch:'phe-native',
  eligible:false, appliedPose:{ index:2, rank:2,
    selectedCoordinateSha256:digest('2'), selectedStateSha256:digest('4') }, pocket }),
/different ranked pose/);
assert.throws(() => diagnosticReviewCaptureRecord({ refinement, branch:'phe-native',
  eligible:false, appliedPose:{ index:2, selectedCoordinateSha256:digest('2'),
    rank:3, selectedStateSha256:digest('4') }, pocket:{ ...pocket, truncated:true } }),
/untruncated pocket/);

console.log('SOS1 AWW diagnostic review capture is guarded and nonpromotable');
