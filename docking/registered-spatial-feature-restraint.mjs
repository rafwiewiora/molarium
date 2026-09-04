export const REGISTERED_SOFT_SPATIAL_FEATURE_RESTRAINT_SCHEMA =
  'molarium.registered-soft-spatial-feature-restraint/v1';

export const REGISTERED_SPATIAL_FEATURE_PARAMETER_DECISION_SCHEMA =
  'molarium.registered-spatial-feature-parameter-decision/v1';

export function validateRegisteredSoftSpatialFeatureRestraint(value,
  label = 'registered spatial-feature restraint') {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  if (value.schema !== REGISTERED_SOFT_SPATIAL_FEATURE_RESTRAINT_SCHEMA)
    throw new Error(`${label}.schema must be ${REGISTERED_SOFT_SPATIAL_FEATURE_RESTRAINT_SCHEMA}`);
  if (value.metric !== 'graph-symmetry-minimized Cartesian RMSD'
    || value.required !== true
    || !Number.isFinite(Number(value.toleranceAngstrom))
    || Number(value.toleranceAngstrom) <= 0
    || !Number.isFinite(Number(value.weightKcalMolPerAngstrom2))
    || Number(value.weightKcalMolPerAngstrom2) <= 0)
    throw new Error(`${label} is invalid`);
  const decision = value.parameterDecision;
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)
    || decision.schema !== REGISTERED_SPATIAL_FEATURE_PARAMETER_DECISION_SCHEMA
    || decision.actorClass !== 'human'
    || decision.basis !== 'pre-holdout-diagnostic'
    || decision.holdoutCoordinatesUsed !== false
    || typeof decision.sourceAttemptId !== 'string' || !decision.sourceAttemptId
    || !Number.isFinite(Number(decision.observedBestRmsdAngstrom))
    || Number(decision.observedBestRmsdAngstrom) <= 0
    || Number(decision.selectedToleranceAngstrom) !== Number(value.toleranceAngstrom)
    || Number(value.toleranceAngstrom) < Number(decision.observedBestRmsdAngstrom))
    throw new Error(`${label}.parameterDecision is invalid`);
  return value;
}
