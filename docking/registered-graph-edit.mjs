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

function spatialFeatureCorrespondences(map, byProductIndex) {
  return Array.from(map.spatialFeatureCorrespondences || []).map((feature, index) => {
    if (!feature || feature.kind !== 'conserved-fragment-rmsd'
      || !['seed-only', 'soft-restraint'].includes(feature.treatment))
      throw new Error(`Registered spatial feature ${index + 1} has an unsupported kind or treatment`);
    if (feature.treatment === 'seed-only'
      && (feature.transferMode !== 'seed-only' || feature.required !== false
        || feature.restraint != null))
      throw new Error(`Registered spatial feature ${index + 1} seed-only transfer must be non-required`);
    if (feature.treatment === 'soft-restraint'
      && (feature.transferMode !== 'score-only'
        || typeof feature.required !== 'boolean'
        || feature.restraint?.required !== feature.required))
      throw new Error(`Registered spatial feature ${index + 1} soft-restraint flags disagree`);
    if (feature.treatment === 'soft-restraint' && feature.required
      && (feature.source !== 'registered-designer-intent'
        || typeof feature.registeredIntentId !== 'string'
        || !feature.registeredIntentId))
      throw new Error(`Registered spatial feature ${index + 1} required restraint lacks registered designer intent`);
    const variants = Array.from(feature.mappingVariants || []);
    if (!feature.id || variants.length < 1)
      throw new Error(`Registered spatial feature ${index + 1} requires an id and mapping variants`);
    const normalized = variants.map((variant, variantIndex) => {
      const referenceAtomNames = Array.from(variant.referenceAtomNames || []);
      const productAtomIndices = Array.from(variant.productAtomIndices || []);
      if (referenceAtomNames.length < 3
        || referenceAtomNames.length !== productAtomIndices.length
        || new Set(referenceAtomNames).size !== referenceAtomNames.length
        || new Set(productAtomIndices).size !== productAtomIndices.length
        || referenceAtomNames.some((name) => typeof name !== 'string' || !name)
        || productAtomIndices.some((atomIndex) => !Number.isInteger(atomIndex)))
        throw new Error(`Registered spatial feature ${feature.id} variant ${variantIndex + 1} is invalid`);
      if (referenceAtomNames.some((name) => [...byProductIndex.values()].includes(name))
        || productAtomIndices.some((atomIndex) => byProductIndex.has(atomIndex)))
        throw new Error(`Registered spatial feature ${feature.id} overlaps the hard atom map`);
      return { referenceAtomNames, productAtomIndices };
    });
    const normalizedFeature = { id:feature.id, kind:feature.kind,
      transferMode:feature.transferMode, treatment:feature.treatment,
      required:Boolean(feature.required),
      source:feature.source || 'registered graph correspondence',
      registeredIntentId:feature.registeredIntentId || null,
      mappingVariants:normalized };
    if (feature.treatment === 'soft-restraint') normalizedFeature.restraint = {
      metric:'graph-symmetry-minimized Cartesian RMSD',
        toleranceAngstrom:Number(feature.restraint?.toleranceAngstrom ?? 1),
        weightKcalMolPerAngstrom2:Number(
          feature.restraint?.weightKcalMolPerAngstrom2 ?? 20),
        required:Boolean(feature.required) };
    return normalizedFeature;
  });
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
  const mappedAtomPairs = [];
  for (const entry of common) {
    if (!Number.isInteger(entry?.productAtomIndex)
      || typeof entry.referenceAtomName !== 'string' || !entry.referenceAtomName
      || typeof entry.element !== 'string' || !entry.element)
      throw new Error('Registered common atoms need product index, reference name, and element');
    if (byProductIndex.has(entry.productAtomIndex))
      throw new Error(`Registered pose map repeats product atom ${entry.productAtomIndex}`);
    byProductIndex.set(entry.productAtomIndex, entry.referenceAtomName);
    mappedAtomPairs.push({
      referenceAtomName:entry.referenceAtomName,
      productAtomIndex:entry.productAtomIndex,
      element:entry.element,
      match:'exact-element-and-conserved-bond-graph',
    });
  }
  if (new Set(mappedAtomPairs.map((entry) => entry.referenceAtomName)).size
    !== mappedAtomPairs.length)
    throw new Error('Registered pose map repeats a reference atom name');

  const protectedNames = map.protectedReferenceAnchor?.referenceAtomNames == null
    ? mappedAtomPairs.map((entry) => entry.referenceAtomName)
    : Array.from(map.protectedReferenceAnchor.referenceAtomNames);
  const protectedNameSet = new Set(protectedNames);
  if (protectedNameSet.size !== protectedNames.length
    || protectedNames.length < 3
    || protectedNames.some((name) => !mappedAtomPairs.some((entry) =>
      entry.referenceAtomName === name)))
    throw new Error('Registered protected anchor must contain at least three unique mapped atoms');
  const exactAtomPairs = mappedAtomPairs.filter((entry) =>
    protectedNameSet.has(entry.referenceAtomName));
  const releasedMappedAtomPairs = mappedAtomPairs.filter((entry) =>
    !protectedNameSet.has(entry.referenceAtomName));
  const declaredReleased = Array.from(map.releasedMappedAtoms || [])
    .map((entry) => entry?.referenceAtomName);
  if (declaredReleased.length !== releasedMappedAtomPairs.length
    || releasedMappedAtomPairs.some((entry) =>
      !declaredReleased.includes(entry.referenceAtomName)))
    throw new Error('Registered released mapped atoms must complement the protected anchor');
  const hardConstraintAtomNames = exactAtomPairs.map((entry) => entry.referenceAtomName);

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
  const releasedMappedAtomNames = uniqueSorted(releasedMappedAtomPairs
    .map((entry) => entry.referenceAtomName));
  const releasedMappedProductAtomIndices = uniqueSorted(releasedMappedAtomPairs
    .map((entry) => entry.productAtomIndex));
  const releasedReferenceAtomNames = uniqueSorted([
    ...deletedAtomNames, ...releasedMappedAtomNames,
  ]);
  const releasedRegions = [];
  if (hasDeleted || hasAdded) releasedRegions.push({
    id:'registered-graph-edit', reason:kind,
    referenceAtomNames:deletedAtomNames,
    productAtomIndices:addedProductAtomIndices,
  });
  for (const migration of Array.from(map.mappedRingAttachmentMigrations || [])) {
    releasedRegions.push({
      id:migration.id,
      reason:migration.reason,
      referenceAtomNames:Array.from(migration.releasedReferenceAtomNames || []),
      productAtomIndices:Array.from(migration.releasedProductAtomIndices || []),
      retainedJunctionReferenceAtomNames:Array.from(
        migration.retainedJunctionReferenceAtomNames || []),
    });
  }
  return {
    schema:'molarium.pose-transfer-plan/v2',
    algorithm:{ id:'molarium-registered-graph-correspondence', version:'2' },
    editKind:kind,
    mappedAtomPairs,
    exactAtomPairs,
    releasedMappedAtomPairs,
    releasedRegions,
    featureCorrespondences:spatialFeatureCorrespondences(map, byProductIndex),
    ambiguity:{
      policy:'enumerate-then-rank-by-registered-context',
      candidateMaps:Number(map.ambiguity?.candidateMaps || 1),
      selection:map.ambiguity?.selection || 'registered deterministic map',
    },
    hardConstraintAtomNames:uniqueSorted(hardConstraintAtomNames),
    deletedReferenceAtomNames:deletedAtomNames,
    releasedMappedAtomNames,
    releasedMappedProductAtomIndices,
    releasedReferenceAtomNames,
    addedProductAtomIndices,
    referenceBoundaryAtomNames, productBoundaryAtomNames,
    releasedBoundaryAtomNames, introducedBoundaryAtomNames,
    elementAgnosticAtomMatching:false,
    coordinateRule:'hard-fix protected common atoms; release attachment-migrated ring atoms and changed graph regions',
    featureRule:'propose separately conserved graph regions as non-required seeds by default; honor explicitly registered designer-intent retention as symmetry-aware soft restraints',
  };
}

export const classifyRegisteredGraphEdit = buildRegisteredPoseTransferPlan;
