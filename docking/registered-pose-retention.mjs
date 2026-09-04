function pointFromPositions(positions, index) {
  return [Number(positions[index * 3]), Number(positions[index * 3 + 1]),
    Number(positions[index * 3 + 2])];
}

function distance(first, second) {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

function centroid(points) {
  return points.reduce((sum, point) => point.map((value, axis) => sum[axis] + value),
    [0, 0, 0]).map((value) => value / points.length);
}

function subtract(first, second) {
  return first.map((value, axis) => value - second[axis]);
}

function cross(first, second) {
  return [first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0]];
}

function unit(value) {
  const norm = Math.hypot(...value);
  return norm > 1e-12 ? value.map((entry) => entry / norm) : null;
}

// Use the largest-area point triplet. This is deterministic and avoids making
// a ring-plane metric depend on atom order or on a numerically unstable tiny
// triangle. Plane-normal sign is intentionally ignored.
function planeNormal(points) {
  let best = null, bestArea = -1;
  for (let first = 0; first < points.length - 2; first++) {
    for (let second = first + 1; second < points.length - 1; second++) {
      for (let third = second + 1; third < points.length; third++) {
        const candidate = cross(subtract(points[second], points[first]),
          subtract(points[third], points[first]));
        const area = Math.hypot(...candidate);
        if (area > bestArea) { best = candidate; bestArea = area; }
      }
    }
  }
  return unit(best || [0, 0, 0]);
}

function variantMetrics(referencePoints, productPoints) {
  const displacements = referencePoints.map((point, index) =>
    distance(point, productPoints[index]));
  const referenceNormal = planeNormal(referencePoints);
  const productNormal = planeNormal(productPoints);
  const normalDot = referenceNormal && productNormal
    ? Math.min(1, Math.max(-1, Math.abs(referenceNormal.reduce((sum, value, axis) =>
      sum + value * productNormal[axis], 0)))) : null;
  return {
    rmsdAngstrom:Math.sqrt(displacements.reduce((sum, value) => sum + value * value, 0)
      / displacements.length),
    maxDisplacementAngstrom:Math.max(...displacements),
    centroidDisplacementAngstrom:distance(centroid(referencePoints), centroid(productPoints)),
    planeNormalAngleDegrees:normalDot == null ? null : Math.acos(normalDot) * 180 / Math.PI,
  };
}

function completeFeature(feature) {
  return feature?.treatment === 'soft-restraint' && feature?.required === true
    && feature?.restraint?.required === true;
}

/**
 * Build and evaluate the registered coordinate-retention islands used by a
 * coupled relaxation. Every target comes from the immediately preceding
 * captured prediction; this module has no route/PDB/holdout-specific inputs.
 */
export function registeredPoseRetentionPlan({ molecule, referenceLigand,
  spatialFeatures = [], releasedReferenceAtomIds = [] } = {}) {
  const requiredFeatures = spatialFeatures.filter(completeFeature);
  if (!molecule?.atoms?.length || !referenceLigand?.atomIds?.length
    || referenceLigand.positions?.length !== referenceLigand.atomIds.length * 3) {
    if (requiredFeatures.length)
      throw new Error('Required registered pose-retention context is unavailable');
    return Object.freeze({ active:false, accepted:true, fixedAtomIndices:[],
      fixedAtomIds:[], hardAnchorAtomIds:[], features:[] });
  }
  const currentById = new Map();
  molecule.atoms.forEach((atom, index) => {
    const id = atom.designAtomId;
    if (!id) return;
    if (currentById.has(id)) throw new Error(`Pose-retention atom ID is duplicated: ${id}`);
    currentById.set(id, index);
  });
  const referenceById = new Map(referenceLigand.atomIds.map((id, index) => [id, index]));
  const released = new Set(releasedReferenceAtomIds);
  const hardAnchorAtomIds = referenceLigand.atomIds.filter((id) => {
    const index = currentById.get(id);
    return Number.isInteger(index) && !released.has(id)
      && molecule.atoms[index]?.element !== 'H';
  });
  const hardAnchorMetrics = hardAnchorAtomIds.length >= 3 ? variantMetrics(
    hardAnchorAtomIds.map((id) => pointFromPositions(
      referenceLigand.positions, referenceById.get(id))),
    hardAnchorAtomIds.map((id) => {
      const atom = molecule.atoms[currentById.get(id)]; return [atom.x, atom.y, atom.z];
    })) : null;
  const fixedIds = new Set(hardAnchorAtomIds);
  const features = requiredFeatures.map((feature) => {
    if (feature.source !== 'registered-designer-intent'
      || typeof feature.registeredIntentId !== 'string' || !feature.registeredIntentId)
      throw new Error(`Required spatial feature ${feature.id} lacks registered intent provenance`);
    const variants = Array.from(feature.mappingVariants || []).map((variant, variantIndex) => {
      const referenceIds = Array.from(variant.referenceAtomIds || []);
      const productIds = Array.from(variant.productAtomIds || []);
      if (referenceIds.length < 3 || referenceIds.length !== productIds.length
        || new Set(referenceIds).size !== referenceIds.length
        || new Set(productIds).size !== productIds.length)
        throw new Error(`Required spatial feature ${feature.id} variant ${variantIndex + 1} is incomplete`);
      const referenceIndices = referenceIds.map((id) => referenceById.get(id));
      const productIndices = productIds.map((id) => currentById.get(id));
      if (referenceIndices.some((index) => !Number.isInteger(index))
        || productIndices.some((index) => !Number.isInteger(index)))
        throw new Error(`Required spatial feature ${feature.id} atom identity is unavailable`);
      const metrics = variantMetrics(referenceIndices.map((index) =>
        pointFromPositions(referenceLigand.positions, index)), productIndices.map((index) => {
        const atom = molecule.atoms[index]; return [atom.x, atom.y, atom.z];
      }));
      return { variantIndex, referenceAtomIds:referenceIds, productAtomIds:productIds,
        ...metrics };
    });
    const productSets = variants.map((variant) => [...variant.productAtomIds].sort().join('\0'));
    if (new Set(productSets).size !== 1)
      throw new Error(`Required spatial feature ${feature.id} variants do not describe one product fragment`);
    variants[0].productAtomIds.forEach((id) => fixedIds.add(id));
    variants.sort((first, second) => first.rmsdAngstrom - second.rmsdAngstrom
      || first.variantIndex - second.variantIndex);
    const selected = variants[0];
    const toleranceAngstrom = Number(feature.restraint.toleranceAngstrom);
    return { id:feature.id, kind:feature.kind, required:true,
      source:feature.source, registeredIntentId:feature.registeredIntentId,
      toleranceAngstrom, selectedVariantIndex:selected.variantIndex,
      symmetryVariantCount:variants.length,
      productAtomIds:[...selected.productAtomIds].sort(),
      rmsdAngstrom:selected.rmsdAngstrom,
      maxDisplacementAngstrom:selected.maxDisplacementAngstrom,
      centroidDisplacementAngstrom:selected.centroidDisplacementAngstrom,
      planeNormalAngleDegrees:selected.planeNormalAngleDegrees,
      accepted:selected.rmsdAngstrom <= toleranceAngstrom };
  });
  const fixedAtomIds = [...fixedIds].sort();
  const fixedAtomIndices = fixedAtomIds.map((id) => currentById.get(id));
  if (fixedAtomIndices.some((index) => !Number.isInteger(index)))
    throw new Error('A registered pose-retention atom is absent from the current molecule');
  return Object.freeze({
    schema:'molarium.registered-pose-retention/v1', active:true,
    method:'hold registered predecessor-coordinate islands during coupled relaxation',
    accepted:features.every((feature) => feature.accepted),
    fixedAtomIndices, fixedAtomIds, hardAnchorAtomIds:[...hardAnchorAtomIds].sort(),
    hardAnchor:hardAnchorMetrics ? { atomCount:hardAnchorAtomIds.length,
      ...hardAnchorMetrics } : null,
    features,
  });
}
