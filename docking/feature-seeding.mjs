import { applyCoreTransform, fittedCoreTransform } from './constraints.mjs';

const AXIAL_ANGLES_DEGREES = Object.freeze([0, 60, -60, 120, -120, 180]);

function finitePositions(value, atomCount) {
  const positions = value instanceof Float64Array ? new Float64Array(value)
    : Float64Array.from(value || []);
  if (positions.length !== atomCount * 3 || positions.some((coordinate) => !Number.isFinite(coordinate)))
    throw new Error(`Feature-guided coordinates require ${atomCount * 3} finite values`);
  return positions;
}

function adjacency(molecule) {
  const entries = molecule.atoms.map(() => []);
  molecule.bonds.forEach((bond) => {
    entries[bond.a]?.push(bond.b); entries[bond.b]?.push(bond.a);
  });
  return entries;
}

function point(positions, atomIndex) {
  return [positions[atomIndex * 3], positions[atomIndex * 3 + 1], positions[atomIndex * 3 + 2]];
}

function normalized(vector) {
  const length = Math.hypot(...vector);
  return length > 1e-10 ? vector.map((value) => value / length) : null;
}

function rotateVector(vector, axis, angle) {
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  const cross = [axis[1] * vector[2] - axis[2] * vector[1],
    axis[2] * vector[0] - axis[0] * vector[2],
    axis[0] * vector[1] - axis[1] * vector[0]];
  const projection = axis[0] * vector[0] + axis[1] * vector[1] + axis[2] * vector[2];
  return vector.map((value, index) => value * cosine + cross[index] * sine
    + axis[index] * projection * (1 - cosine));
}

function alignmentAxisAngle(from, to) {
  const first = normalized(from), second = normalized(to);
  if (!first || !second) return null;
  const cross = [first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0]];
  const crossLength = Math.hypot(...cross);
  const dot = Math.max(-1, Math.min(1,
    first[0] * second[0] + first[1] * second[1] + first[2] * second[2]));
  if (crossLength > 1e-10) return { axis:cross.map((value) => value / crossLength),
    angle:Math.atan2(crossLength, dot) };
  if (dot > 0) return { axis:[1, 0, 0], angle:0 };
  const candidate = Math.abs(first[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  const perpendicular = normalized([first[1] * candidate[2] - first[2] * candidate[1],
    first[2] * candidate[0] - first[0] * candidate[2],
    first[0] * candidate[1] - first[1] * candidate[0]]);
  return { axis:perpendicular, angle:Math.PI };
}

function rotateRegion(positions, atomIndices, origin, axis, angle) {
  const result = new Float64Array(positions);
  atomIndices.forEach((atomIndex) => {
    const current = point(positions, atomIndex);
    const rotated = rotateVector(current.map((value, index) => value - origin[index]), axis, angle);
    for (let dimension = 0; dimension < 3; dimension++)
      result[atomIndex * 3 + dimension] = origin[dimension] + rotated[dimension];
  });
  return result;
}

function connectedNonCoreRegions(molecule, core, entries) {
  const visited = new Set(), regions = [];
  molecule.atoms.forEach((_, root) => {
    if (core.has(root) || visited.has(root)) return;
    const atomIndices = [], anchors = new Set(), queue = [root];
    visited.add(root);
    while (queue.length) {
      const atomIndex = queue.shift(); atomIndices.push(atomIndex);
      entries[atomIndex].forEach((neighbor) => {
        if (core.has(neighbor)) { anchors.add(neighbor); return; }
        if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
      });
    }
    regions.push({ atomIndices:atomIndices.sort((a, b) => a - b),
      anchorAtomIndices:[...anchors].sort((a, b) => a - b) });
  });
  return regions;
}

function rigidTransformForAnchors(current, target, anchors) {
  const first = anchors[0], currentOrigin = point(current, first), targetOrigin = point(target, first);
  if (anchors.length === 1) return { origin:currentOrigin, targetOrigin,
    axis:[1, 0, 0], angle:0, method:'single-anchor-translation' };
  if (anchors.length >= 3) return { positions:applyCoreTransform(current,
    fittedCoreTransform(target, current, anchors.map((atomIndex) => [atomIndex, atomIndex]))),
  method:'local-scaffold-rigid-fit' };
  const second = anchors[1];
  const alignment = alignmentAxisAngle(point(current, second)
    .map((value, axis) => value - currentOrigin[axis]), point(target, second)
    .map((value, axis) => value - targetOrigin[axis]));
  return alignment ? { origin:currentOrigin, targetOrigin,
    axis:alignment.axis, angle:alignment.angle,
    method:anchors.length === 2 ? 'two-anchor-rigid-axis-fit'
      : 'multi-anchor-first-axis-fit' } : null;
}

// A free product embedding is globally fitted to the reference and its mapped
// atoms are then hard-snapped. New atoms must follow their attachment anchors;
// otherwise snapping the core can silently stretch boundary bonds by several
// angstroms. This operation is rigid within each connected non-core region.
export function attachNonCoreRegionsToSnappedCore({ molecule, alignedPositions,
  referencePositions, coreAtomPairs } = {}) {
  if (!molecule?.atoms?.length || !Array.isArray(molecule.bonds))
    throw new Error('Attached edit placement requires a complete molecular graph');
  const current = finitePositions(alignedPositions, molecule.atoms.length);
  const target = new Float64Array(current);
  const core = new Set();
  Array.from(coreAtomPairs || []).forEach(([referenceAtomIndex, productAtomIndex]) => {
    if (!Number.isInteger(referenceAtomIndex) || !Number.isInteger(productAtomIndex))
      throw new Error('Attached edit placement requires integer core atom pairs');
    core.add(productAtomIndex);
    for (let axis = 0; axis < 3; axis++)
      target[productAtomIndex * 3 + axis] = referencePositions[referenceAtomIndex * 3 + axis];
  });
  const entries = adjacency(molecule), placed = new Float64Array(current), audit = [];
  connectedNonCoreRegions(molecule, core, entries).forEach((region) => {
    if (!region.anchorAtomIndices.length) {
      audit.push({ ...region, method:'unattached-component-unchanged' }); return;
    }
    const fitAnchorIndices = [...new Set(region.anchorAtomIndices.flatMap((atomIndex) =>
      [atomIndex, ...entries[atomIndex].filter((neighbor) => core.has(neighbor))]))]
      .sort((a, b) => a - b);
    const transform = rigidTransformForAnchors(current, target, fitAnchorIndices);
    if (!transform) {
      audit.push({ ...region, method:'degenerate-anchor-fit-unchanged' }); return;
    }
    const rotated = transform.positions || rotateRegion(current, region.atomIndices,
      transform.origin, transform.axis, transform.angle);
    region.atomIndices.forEach((atomIndex) => {
      for (let axis = 0; axis < 3; axis++)
        placed[atomIndex * 3 + axis] = rotated[atomIndex * 3 + axis]
          + (transform.positions ? 0 : transform.targetOrigin[axis] - transform.origin[axis]);
    });
    audit.push({ atomIndices:region.atomIndices, anchorAtomIndices:region.anchorAtomIndices,
      fitAnchorIndices, method:transform.method });
  });
  core.forEach((atomIndex) => {
    for (let axis = 0; axis < 3; axis++) placed[atomIndex * 3 + axis] = target[atomIndex * 3 + axis];
  });
  return { positions:placed, regions:audit,
    method:'molarium-anchor-attached-core-snap/v1' };
}

function movableFeatureRegion(molecule, featureAtomIndex, core, entries) {
  if (core.has(featureAtomIndex)) return null;
  const visited = new Set([featureAtomIndex]), queue = [featureAtomIndex], anchors = new Set();
  while (queue.length) {
    const atomIndex = queue.shift();
    entries[atomIndex].forEach((neighbor) => {
      if (core.has(neighbor)) { anchors.add(neighbor); return; }
      if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
    });
  }
  return anchors.size === 1 ? { atomIndices:[...visited].sort((a, b) => a - b),
    anchorAtomIndex:[...anchors][0] } : null;
}

function targetVariants(definitions) {
  const variants = [];
  Array.from(definitions || []).forEach((definition) => {
    const entries = definition.alternatives?.length ? definition.alternatives : [definition];
    entries.forEach((entry) => {
      const referencePoint = entry.targetLigandFeatureReferencePoint;
      if (!referencePoint || ![referencePoint.x, referencePoint.y, referencePoint.z].every(Number.isFinite)) return;
      const feature = entry.receptorRole === 'donor' ? entry.acceptor : entry.donor;
      if (feature?.scope !== 'ligand' || !Number.isInteger(feature.atomIndex)) return;
      variants.push({ constraintId:definition.id, alternativeId:entry.id,
        featureAtomIndex:feature.atomIndex,
        target:[referencePoint.x, referencePoint.y, referencePoint.z] });
    });
  });
  return variants.sort((first, second) => first.featureAtomIndex - second.featureAtomIndex
    || first.constraintId.localeCompare(second.constraintId)
    || String(first.alternativeId).localeCompare(String(second.alternativeId)));
}

export function featureGuidedPoseSeeds({ molecule, initialPositions, coreAtomIndices,
  hydrogenBondConstraints = [], count = 16,
  axialAnglesDegrees = AXIAL_ANGLES_DEGREES } = {}) {
  if (!molecule?.atoms?.length || !Array.isArray(molecule.bonds))
    throw new Error('Feature-guided seeding requires a complete molecular graph');
  const requested = Math.max(1, Math.round(Number(count)));
  const positions = finitePositions(initialPositions, molecule.atoms.length);
  const core = new Set(Array.from(coreAtomIndices || [], Number));
  const entries = adjacency(molecule);
  const variants = targetVariants(hydrogenBondConstraints);
  const unique = [], seen = new Set();
  const add = (candidate, audit) => {
    const key = Array.from(candidate, (value) => Math.round(value * 1e6)).join(',');
    if (seen.has(key)) return;
    seen.add(key); unique.push({ positions:candidate, audit });
  };
  add(positions, { method:'unaltered-reference-propagation' });
  variants.forEach((variant) => {
    const region = movableFeatureRegion(molecule, variant.featureAtomIndex, core, entries);
    if (!region) return;
    const anchor = point(positions, region.anchorAtomIndex);
    const feature = point(positions, variant.featureAtomIndex);
    const alignment = alignmentAxisAngle(feature.map((value, index) => value - anchor[index]),
      variant.target.map((value, index) => value - anchor[index]));
    if (!alignment) return;
    const aligned = rotateRegion(positions, region.atomIndices, anchor,
      alignment.axis, alignment.angle);
    const targetAxis = normalized(variant.target.map((value, index) => value - anchor[index]));
    if (!targetAxis) return;
    axialAnglesDegrees.forEach((angleDegrees) => {
      const seeded = rotateRegion(aligned, region.atomIndices, anchor,
        targetAxis, Number(angleDegrees) * Math.PI / 180);
      add(seeded, { method:'captured-feature-axis-alignment',
        constraintId:variant.constraintId, alternativeId:variant.alternativeId,
        featureAtomIndex:variant.featureAtomIndex, anchorAtomIndex:region.anchorAtomIndex,
        movedAtomCount:region.atomIndices.length, axialAngleDegrees:Number(angleDegrees) });
    });
  });
  const seeds = Array.from({ length:requested }, (_, index) => unique[index % unique.length]);
  return { seeds, uniqueSeedCount:unique.length, requestedCount:requested,
    targetVariantCount:variants.length,
    method:'molarium-captured-feature-axis-seeding/v1',
    limitation:'single-anchor edit regions only; no bond lengths, bond angles, or fixed-core coordinates are changed' };
}

export const FEATURE_SEEDING_AXIAL_ANGLES_DEGREES = AXIAL_ANGLES_DEGREES;
