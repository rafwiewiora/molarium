import assert from 'node:assert/strict';
import {
  REGISTERED_SOFT_SPATIAL_FEATURE_RESTRAINT_SCHEMA,
  REGISTERED_SPATIAL_FEATURE_PARAMETER_DECISION_SCHEMA,
  validateRegisteredSoftSpatialFeatureRestraint,
} from './registered-spatial-feature-restraint.mjs';

const restraint = {
  schema:REGISTERED_SOFT_SPATIAL_FEATURE_RESTRAINT_SCHEMA,
  metric:'graph-symmetry-minimized Cartesian RMSD', toleranceAngstrom:2.25,
  weightKcalMolPerAngstrom2:20, required:true,
  parameterDecision:{
    schema:REGISTERED_SPATIAL_FEATURE_PARAMETER_DECISION_SCHEMA,
    actorClass:'human', basis:'pre-holdout-diagnostic',
    sourceAttemptId:'immutable-pre-holdout-attempt',
    observedBestRmsdAngstrom:2.1617,
    selectedToleranceAngstrom:2.25, holdoutCoordinatesUsed:false,
  },
};
assert.equal(validateRegisteredSoftSpatialFeatureRestraint(restraint), restraint);
assert.throws(() => validateRegisteredSoftSpatialFeatureRestraint({ ...restraint,
  parameterDecision:{ ...restraint.parameterDecision, holdoutCoordinatesUsed:true },
}), /parameterDecision is invalid/);
assert.throws(() => validateRegisteredSoftSpatialFeatureRestraint({ ...restraint,
  toleranceAngstrom:2.1,
}), /parameterDecision is invalid/);
assert.throws(() => validateRegisteredSoftSpatialFeatureRestraint({ ...restraint,
  schema:'unversioned',
}), /schema must be/);
console.log('registered soft spatial-feature restraints are versioned and provenance-bound');
