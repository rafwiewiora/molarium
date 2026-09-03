import { applyCoreTransform, fittedCoreTransform } from './constraints.mjs';

const AXIAL_ANGLES_DEGREES = Object.freeze([0, 60, -60, 120, -120, 180]);
const EDIT_REGION_ANGLES_DEGREES = Object.freeze([
  0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180,
]);

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

function singleAnchorEditRotor(molecule, region, core, entries, positions) {
  if (region.anchorAtomIndices.length !== 1) return null;
  const heavyAtomCount = region.atomIndices
    .filter((atomIndex) => molecule.atoms[atomIndex]?.element !== 'H').length;
  if (heavyAtomCount < 2) return null;
  const anchorAtomIndex = region.anchorAtomIndices[0];
  const regionAtoms = new Set(region.atomIndices);
  const boundaryAtomIndices = entries[anchorAtomIndex]
    .filter((atomIndex) => regionAtoms.has(atomIndex));
  const origin = point(positions, anchorAtomIndex);
  let axis, axisAtomIndex, attachmentMode;
  if (boundaryAtomIndices.length === 1) {
    axisAtomIndex = boundaryAtomIndices[0];
    axis = normalized(point(positions, axisAtomIndex)
      .map((value, index) => value - origin[index]));
    attachmentMode = 'single-boundary-bond';
  } else if (boundaryAtomIndices.length > 1) {
    // An MCS can preserve the ipso atom while replacing the ring grown around
    // it. The edit then has two boundary bonds to the same fixed atom, but its
    // real torsion axis is the external scaffold bond on the other side of
    // that atom. Rotating the whole connected edit region around that axis is
    // rigid and preserves both ring-closing bonds.
    const scaffoldNeighbors = entries[anchorAtomIndex]
      .filter((atomIndex) => core.has(atomIndex));
    if (scaffoldNeighbors.length !== 1) return null;
    axisAtomIndex = scaffoldNeighbors[0];
    axis = normalized(origin.map((value, index) =>
      value - point(positions, axisAtomIndex)[index]));
    attachmentMode = 'conserved-junction-ring-axis';
  }
  return axis ? { ...region, anchorAtomIndex, axisAtomIndex,
    boundaryAtomIndices, attachmentMode, origin, axis, heavyAtomCount } : null;
}

function componentWithoutBond(entries, root, first, second) {
  const visited = new Set([root]), queue = [root];
  while (queue.length) {
    const atomIndex = queue.shift();
    entries[atomIndex].forEach((neighbor) => {
      if ((atomIndex === first && neighbor === second)
        || (atomIndex === second && neighbor === first) || visited.has(neighbor)) return;
      visited.add(neighbor); queue.push(neighbor);
    });
  }
  return visited;
}

function amideLikeBond(molecule, entries, first, second) {
  const carbonylAttachedTo = (carbonIndex, heteroIndex) => {
    if (molecule.atoms[carbonIndex]?.element !== 'C'
      || !['N', 'O', 'S'].includes(molecule.atoms[heteroIndex]?.element)) return false;
    return entries[carbonIndex].some((neighbor) => neighbor !== heteroIndex
      && ['O', 'S'].includes(molecule.atoms[neighbor]?.element)
      && molecule.bonds.some((bond) => (bond.a === carbonIndex && bond.b === neighbor
        || bond.b === carbonIndex && bond.a === neighbor)
        && Number(bond.order || 1) >= 1.9));
  };
  return carbonylAttachedTo(first, second) || carbonylAttachedTo(second, first);
}

function affectedEnvironmentRotors(molecule, core, entries, positions,
  editedAtomIndices, affectedAtomIndices, environmentBondRadius = 2) {
  const edited = new Set(Array.from(editedAtomIndices || [], Number)
    .filter((index) => Number.isInteger(index) && index >= 0 && index < molecule.atoms.length));
  const affected = new Set([...edited, ...Array.from(affectedAtomIndices || [], Number)
    .filter((index) => Number.isInteger(index) && index >= 0 && index < molecule.atoms.length)]);
  if (!affected.size) return [];
  const distances = new Map([...affected].map((index) => [index, 0]));
  let frontier = [...affected];
  for (let depth = 1; depth <= environmentBondRadius; depth++) {
    const next = [];
    frontier.forEach((atomIndex) => entries[atomIndex].forEach((neighbor) => {
      if (distances.has(neighbor)) return;
      distances.set(neighbor, depth); next.push(neighbor);
    }));
    frontier = next;
  }
  const heavyCount = (indices) => [...indices].reduce((count, atomIndex) =>
    count + Number(molecule.atoms[atomIndex]?.element !== 'H'), 0);
  return molecule.bonds.flatMap((bond, bondIndex) => {
    const first = bond.a, second = bond.b;
    if (!core.has(first) || !core.has(second)
      || molecule.atoms[first]?.element === 'H' || molecule.atoms[second]?.element === 'H'
      || Number(bond.order || 1) !== 1 || bond.aromatic
      || amideLikeBond(molecule, entries, first, second)
      || Math.min(distances.get(first) ?? Infinity, distances.get(second) ?? Infinity)
        > environmentBondRadius) return [];
    const firstSide = componentWithoutBond(entries, first, first, second);
    if (firstSide.has(second)) return []; // Ring bonds are not torsional degrees of freedom.
    const secondSide = componentWithoutBond(entries, second, first, second);
    if (entries[first].filter((index) => molecule.atoms[index]?.element !== 'H').length < 2
      || entries[second].filter((index) => molecule.atoms[index]?.element !== 'H').length < 2)
      return [];
    const distanceToBond = (source) => {
      const visited = new Set([source]), queue = [[source, 0]];
      while (queue.length) {
        const [atomIndex, depth] = queue.shift();
        if (atomIndex === first || atomIndex === second) return depth;
        if (depth >= environmentBondRadius) continue;
        entries[atomIndex].forEach((neighbor) => {
          if (visited.has(neighbor)) return;
          visited.add(neighbor); queue.push([neighbor, depth + 1]);
        });
      }
      return Infinity;
    };
    const localEdited = new Set([...edited]
      .filter((index) => distanceToBond(index) <= environmentBondRadius));
    const localAffected = new Set([...affected]
      .filter((index) => distanceToBond(index) <= environmentBondRadius));
    const environmentScore = (indices) => [...indices].reduce((score, atomIndex) =>
      score + (localEdited.has(atomIndex) ? 2 : localAffected.has(atomIndex) ? 1 : 0), 0);
    const firstScore = environmentScore(firstSide), secondScore = environmentScore(secondSide);
    let movable = secondSide, movableEndpoint = second, fixedEndpoint = first;
    if (firstScore > secondScore || firstScore === secondScore
      && (heavyCount(firstSide) < heavyCount(secondSide)
        || heavyCount(firstSide) === heavyCount(secondSide) && first < second)) {
      movable = firstSide; movableEndpoint = first; fixedEndpoint = second;
    }
    const releasedCoreAtomIndices = [...movable]
      .filter((index) => core.has(index) && index !== first && index !== second)
      .sort((a, b) => a - b);
    if (!releasedCoreAtomIndices.length || heavyCount(movable) < 2) return [];
    const origin = point(positions, fixedEndpoint);
    const axis = normalized(point(positions, movableEndpoint)
      .map((value, index) => value - origin[index]));
    if (!axis) return [];
    return [{ bondIndex, fixedEndpointAtomIndex:fixedEndpoint,
      movableEndpointAtomIndex:movableEndpoint,
      atomIndices:[...movable].sort((a, b) => a - b),
      releasedCoreAtomIndices,
      affectedAtomIndices:[...localAffected].filter((index) => movable.has(index)).sort((a, b) => a - b),
      editedAtomIndices:[...localEdited].filter((index) => movable.has(index)).sort((a, b) => a - b),
      heavyAtomCount:heavyCount(movable), origin, axis,
      attachmentMode:'affected-existing-rotor' }];
  });
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
  editedAtomIndices = [], affectedAtomIndices = [], environmentBondRadius = 2,
  axialAnglesDegrees = AXIAL_ANGLES_DEGREES,
  editRegionAnglesDegrees = EDIT_REGION_ANGLES_DEGREES } = {}) {
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
  const targetedRegions = new Set(variants.flatMap((variant) => {
    const region = movableFeatureRegion(molecule, variant.featureAtomIndex, core, entries);
    return region ? [region.atomIndices.join(',')] : [];
  }));
  const untargetedRotors = connectedNonCoreRegions(molecule, core, entries)
    .filter((region) => !targetedRegions.has(region.atomIndices.join(',')))
    .map((region) => singleAnchorEditRotor(molecule, region, core, entries, positions))
    .filter(Boolean);
  const affectedRotors = affectedEnvironmentRotors(molecule, core, entries, positions,
    editedAtomIndices, affectedAtomIndices, environmentBondRadius);
  untargetedRotors.forEach((rotor) => {
    editRegionAnglesDegrees.forEach((angleDegrees) => {
      const seeded = rotateRegion(positions, rotor.atomIndices, rotor.origin,
        rotor.axis, Number(angleDegrees) * Math.PI / 180);
      add(seeded, { method:'untargeted-edit-region-torsion-scan',
        anchorAtomIndex:rotor.anchorAtomIndex,
        axisAtomIndex:rotor.axisAtomIndex,
        boundaryAtomIndices:rotor.boundaryAtomIndices,
        attachmentMode:rotor.attachmentMode,
        movedAtomCount:rotor.atomIndices.length,
        movedHeavyAtomCount:rotor.heavyAtomCount,
        axialAngleDegrees:Number(angleDegrees) });
    });
  });
  affectedRotors.forEach((rotor) => {
    editRegionAnglesDegrees.forEach((angleDegrees) => {
      const seeded = rotateRegion(positions, rotor.atomIndices, rotor.origin,
        rotor.axis, Number(angleDegrees) * Math.PI / 180);
      add(seeded, { method:'affected-existing-rotor-torsion-scan',
        bondIndex:rotor.bondIndex,
        fixedEndpointAtomIndex:rotor.fixedEndpointAtomIndex,
        movableEndpointAtomIndex:rotor.movableEndpointAtomIndex,
        attachmentMode:rotor.attachmentMode,
        movedAtomCount:rotor.atomIndices.length,
        movedHeavyAtomCount:rotor.heavyAtomCount,
        releasedCoreAtomIndices:rotor.releasedCoreAtomIndices,
        affectedAtomIndices:rotor.affectedAtomIndices,
        editedAtomIndices:rotor.editedAtomIndices,
        axialAngleDegrees:Number(angleDegrees) });
    });
  });
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
  const releasedCoreAtomIndices = [...new Set(affectedRotors
    .flatMap((rotor) => rotor.releasedCoreAtomIndices))].sort((a, b) => a - b);
  return { seeds, uniqueSeedCount:unique.length, requestedCount:requested,
    targetVariantCount:variants.length, untargetedRotorCount:untargetedRotors.length,
    affectedRotorCount:affectedRotors.length, releasedCoreAtomIndices,
    affectedRotors:affectedRotors.map((rotor) => ({
      bondIndex:rotor.bondIndex,
      fixedEndpointAtomIndex:rotor.fixedEndpointAtomIndex,
      movableEndpointAtomIndex:rotor.movableEndpointAtomIndex,
      releasedCoreAtomIndices:[...rotor.releasedCoreAtomIndices],
      affectedAtomIndices:[...rotor.affectedAtomIndices],
      editedAtomIndices:[...rotor.editedAtomIndices],
      attachmentMode:rotor.attachmentMode,
    })),
    editRegionAnglesDegrees:Array.from(editRegionAnglesDegrees, Number),
    method:'molarium-edit-region-axis-seeding/v4',
    limitation:'single-anchor edit regions and pre-existing non-ring single bonds within the declared edit environment are scanned; amide-like and genuinely rigid bonds remain fixed' };
}

export const FEATURE_SEEDING_AXIAL_ANGLES_DEGREES = AXIAL_ANGLES_DEGREES;
export const EDIT_REGION_SEEDING_ANGLES_DEGREES = EDIT_REGION_ANGLES_DEGREES;
