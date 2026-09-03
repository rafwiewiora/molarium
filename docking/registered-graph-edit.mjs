export const REGISTERED_POSE_PROPAGATION_POLICY_SCHEMA =
  'molarium.registered-pose-propagation-policy/v1';

const REQUIRED_POLICY = Object.freeze({
  atomCorrespondence:'exact-element',
  bondCorrespondence:'exact-order',
  ringCorrespondence:'complete-rings-only',
  changedRingTreatment:'release-from-hard-core',
  featureTransfer:'role-compatible-restraints',
});

export const EXACT_REGISTERED_POSE_PROPAGATION_POLICY = Object.freeze({
  schema:REGISTERED_POSE_PROPAGATION_POLICY_SCHEMA,
  ...REQUIRED_POLICY,
});

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value;
}

export function validateRegisteredPosePropagationPolicy(value) {
  const policy = record(value, 'posePropagationPolicy');
  if (policy.schema !== REGISTERED_POSE_PROPAGATION_POLICY_SCHEMA)
    throw new Error(`posePropagationPolicy.schema must be ${REGISTERED_POSE_PROPAGATION_POLICY_SCHEMA}`);
  for (const [field, expected] of Object.entries(REQUIRED_POLICY)) {
    if (policy[field] !== expected)
      throw new Error(`posePropagationPolicy.${field} must be ${expected}`);
  }
  return policy;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((first, second) => String(first).localeCompare(String(second)));
}

// A registered map is generated from molecular graphs, never later coordinates.
// This classifier makes the coordinate consequence explicit. Exact common atoms
// may be hard constrained; deleted/added graph regions are released. If the old
// and new regions meet different common atoms, the operation is an attachment
// rewire rather than a substituent swap.
export function buildRegisteredPoseTransferPlan(poseMap, policy) {
  validateRegisteredPosePropagationPolicy(policy);
  const map = record(poseMap, 'posePropagationMap');
  const common = Array.from(map.commonAtoms || []);
  if (common.length < 3) throw new Error('A registered pose map needs at least three exact common atoms');
  const byProductIndex = new Map();
  const hardConstraintAtomNames = [];
  for (const entry of common) {
    if (!Number.isInteger(entry?.productAtomIndex)
      || typeof entry.referenceAtomName !== 'string' || !entry.referenceAtomName
      || typeof entry.element !== 'string' || !entry.element)
      throw new Error('Registered common atoms need product index, reference name, and element');
    if (byProductIndex.has(entry.productAtomIndex))
      throw new Error(`Registered pose map repeats product atom ${entry.productAtomIndex}`);
    byProductIndex.set(entry.productAtomIndex, entry.referenceAtomName);
    hardConstraintAtomNames.push(entry.referenceAtomName);
  }
  if (new Set(hardConstraintAtomNames).size !== hardConstraintAtomNames.length)
    throw new Error('Registered pose map repeats a reference atom name');

  const referenceBoundaryAtomNames = uniqueSorted(Array.from(map.referenceBoundary || [])
    .map((entry) => entry?.commonAtomName).filter(Boolean));
  const productBoundaryAtomNames = uniqueSorted(Array.from(map.productBoundary || [])
    .map((entry) => byProductIndex.get(entry?.commonProductAtomIndex)).filter(Boolean));
  const referenceBoundary = new Set(referenceBoundaryAtomNames);
  const productBoundary = new Set(productBoundaryAtomNames);
  const releasedBoundaryAtomNames = referenceBoundaryAtomNames
    .filter((name) => !productBoundary.has(name));
  const introducedBoundaryAtomNames = productBoundaryAtomNames
    .filter((name) => !referenceBoundary.has(name));
  const deletedAtomNames = uniqueSorted(Array.from(map.deletedReferenceAtoms || [])
    .map((entry) => entry?.referenceAtomName).filter(Boolean));
  const addedProductAtomIndices = uniqueSorted(Array.from(map.addedProductAtoms || [])
    .map((entry) => entry?.productAtomIndex).filter(Number.isInteger));
  const hasDeleted = deletedAtomNames.length > 0;
  const hasAdded = addedProductAtomIndices.length > 0;
  const attachmentChanged = releasedBoundaryAtomNames.length > 0
    || introducedBoundaryAtomNames.length > 0;
  const kind = hasDeleted && hasAdded && attachmentChanged ? 'attachment-rewire'
    : hasDeleted && hasAdded ? 'region-replacement'
      : hasAdded ? 'fragment-growth' : hasDeleted ? 'fragment-deletion' : 'identity';
  const exactAtomPairs = common.map((entry) => ({
    referenceAtomName:entry.referenceAtomName,
    productAtomIndex:entry.productAtomIndex,
    element:entry.element,
    match:'exact-element-and-conserved-bond-graph',
  }));
  return {
    schema:'molarium.pose-transfer-plan/v2',
    algorithm:{ id:'molarium-registered-graph-correspondence', version:'2' },
    editKind:kind,
    exactAtomPairs,
    releasedRegions:hasDeleted || hasAdded ? [{
      id:'registered-graph-edit', reason:kind,
      referenceAtomNames:deletedAtomNames,
      productAtomIndices:addedProductAtomIndices,
    }] : [],
    featureCorrespondences:[],
    ambiguity:{
      policy:'enumerate-then-rank-by-registered-context',
      candidateMaps:Number(map.ambiguity?.candidateMaps || 1),
      selection:map.ambiguity?.selection || 'registered deterministic map',
    },
    hardConstraintAtomNames:uniqueSorted(hardConstraintAtomNames),
    releasedReferenceAtomNames:deletedAtomNames,
    addedProductAtomIndices,
    referenceBoundaryAtomNames, productBoundaryAtomNames,
    releasedBoundaryAtomNames, introducedBoundaryAtomNames,
    elementAgnosticAtomMatching:false,
    coordinateRule:'hard-fix exact common atoms; release changed graph regions',
    featureRule:'transfer compatible interaction roles as restraints, not atom identity',
  };
}

export const classifyRegisteredGraphEdit = buildRegisteredPoseTransferPlan;
