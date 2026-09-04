import assert from 'node:assert/strict';

export const SOS1_AWW_REVIEW_CAPTURE_SCHEMA =
  'molarium.sos1-aww-selected-pose-coordinate-capture/v1';

function sha256(value, label) {
  const text = String(value || '');
  assert.match(text, /^[0-9a-f]{64}$/, `${label} must be a lowercase SHA-256 digest`);
  return text;
}

export function diagnosticPoseApplyArgs(refinement, { allowInfeasible = true } = {}) {
  const selectedRank = Number(refinement?.selectedRank);
  assert(Number.isInteger(selectedRank) && selectedRank >= 1,
    'Diagnostic review capture requires a positive selectedRank');
  return {
    index:selectedRank - 1,
    allowInfeasible:Boolean(allowInfeasible),
    expectedInputCoordinateSha256:sha256(refinement.inputCoordinateSha256,
      'refinement.inputCoordinateSha256'),
    expectedSelectedCoordinateSha256:sha256(refinement.selectedCoordinateSha256,
      'refinement.selectedCoordinateSha256'),
    expectedInputStateSha256:sha256(refinement.inputStateSha256,
      'refinement.inputStateSha256'),
    expectedSelectedStateSha256:sha256(refinement.selectedStateSha256,
      'refinement.selectedStateSha256'),
  };
}

export function diagnosticReviewCaptureRecord({ refinement, appliedPose, pocket,
  branch, eligible, reviewModeRequested = false, allowInfeasible = false }) {
  assert.equal(pocket?.scope, 'pocket');
  assert.equal(pocket?.truncated, false,
    'Diagnostic review capture requires an untruncated pocket inspection');
  assert.equal(pocket?.totalAtomCount, pocket?.atoms?.length,
    'Diagnostic review capture pocket atom count is incomplete');
  assert.equal(appliedPose?.index, Number(refinement?.selectedRank) - 1,
    'Diagnostic review capture applied the wrong selected result');
  assert.equal(appliedPose?.rank, Number(refinement?.selectedRank),
    'Diagnostic review capture applied a different ranked pose');
  assert.equal(appliedPose?.selectedCoordinateSha256,
    refinement?.selectedCoordinateSha256,
  'Diagnostic review capture selected-coordinate hash changed during apply');
  assert.equal(appliedPose?.selectedStateSha256, refinement?.selectedStateSha256,
    'Diagnostic review capture selected-state hash changed during apply');
  return {
    schema:SOS1_AWW_REVIEW_CAPTURE_SCHEMA,
    requested:true,
    reviewModeRequested:Boolean(reviewModeRequested),
    disposition:eligible ? 'eligible' : 'rejected-nonpromotable',
    diagnosticOnly:!eligible,
    promotable:Boolean(eligible),
    branch:String(branch),
    prospectiveEligible:Boolean(eligible),
    eligibilityUnchanged:true,
    selectedFeasible:refinement?.selectedFeasible === true,
    selectedRank:Number(refinement.selectedRank),
    appliedPoseIndex:Number(appliedPose.index),
    allowInfeasible:Boolean(allowInfeasible),
    infeasibleOverride:Boolean(appliedPose.infeasibleOverride),
    selectedCoordinateSha256:refinement.selectedCoordinateSha256,
    selectedStateSha256:refinement.selectedStateSha256,
    outputCoordinateSha256:appliedPose.outputCoordinateSha256,
    outputStateSha256:appliedPose.outputStateSha256,
    pocketAtomCount:pocket.atoms.length,
    contactAnnotationCount:pocket.contacts?.length || 0,
    purpose:eligible
      ? 'Automatic coordinate preservation for a prospectively eligible selected pose.'
      : 'Automatic coordinate preservation of a rejected pose for diagnosis only; never production selection or promotion evidence.',
  };
}
