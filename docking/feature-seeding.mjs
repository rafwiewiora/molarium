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

function fragmentCartesianScore(referencePositions, candidatePositions, mappingVariants) {
  const scored = Array.from(mappingVariants || []).map((variant, variantIndex) => {
    const atomPairs = Array.from(variant.atomPairs || []);
    if (atomPairs.length < 3) return null;
    let sumSquared = 0;
    for (const [referenceAtomIndex, productAtomIndex] of atomPairs) {
      const reference = point(referencePositions, referenceAtomIndex);
      const candidate = point(candidatePositions, productAtomIndex);
      sumSquared += reference.reduce((sum, value, axis) =>
        sum + (value - candidate[axis]) ** 2, 0);
    }
    return { variantIndex, atomPairs, sumSquared,
      rmsdAngstrom:Math.sqrt(sumSquared / atomPairs.length) };
  }).filter(Boolean).sort((first, second) => first.sumSquared - second.sumSquared
    || first.variantIndex - second.variantIndex);
  if (!scored.length) throw new Error('A seed-only fragment needs at least one three-atom map');
  return scored[0];
}

function seedOnlyRotors(molecule, positions, hardCoreAtomIndices, featureAtomIndices) {
  const entries = adjacency(molecule), hard = new Set(hardCoreAtomIndices);
  const feature = new Set(featureAtomIndices);
  return molecule.bonds.flatMap((bond, bondIndex) => {
    const first = bond.a, second = bond.b;
    if (Number(bond.order || 1) !== 1 || bond.aromatic
      || molecule.atoms[first]?.element === 'H' || molecule.atoms[second]?.element === 'H'
      || amideLikeBond(molecule, entries, first, second)) return [];
    const firstSide = componentWithoutBond(entries, first, first, second);
    if (firstSide.has(second)) return []; // A ring bond cannot be used as a torsion.
    const secondSide = componentWithoutBond(entries, second, first, second);
    const firstHasHard = [...firstSide].some((index) => hard.has(index));
    const secondHasHard = [...secondSide].some((index) => hard.has(index));
    let movable, fixedEndpointAtomIndex, movableEndpointAtomIndex;
    if (firstHasHard !== secondHasHard) {
      movable = firstHasHard ? secondSide : firstSide;
      fixedEndpointAtomIndex = firstHasHard ? first : second;
      movableEndpointAtomIndex = firstHasHard ? second : first;
    } else if (!firstHasHard && !secondHasHard) {
      const firstFeatureCount = [...firstSide].filter((index) => feature.has(index)).length;
      const secondFeatureCount = [...secondSide].filter((index) => feature.has(index)).length;
      if (firstFeatureCount === secondFeatureCount) return [];
      movable = firstFeatureCount > secondFeatureCount ? firstSide : secondSide;
      fixedEndpointAtomIndex = firstFeatureCount > secondFeatureCount ? second : first;
      movableEndpointAtomIndex = firstFeatureCount > secondFeatureCount ? first : second;
    } else return [];
    if (![...movable].some((index) => feature.has(index))
      || [...movable].some((index) => hard.has(index))) return [];
    const origin = point(positions, fixedEndpointAtomIndex);
    const axis = normalized(point(positions, movableEndpointAtomIndex)
      .map((value, index) => value - origin[index]));
    return axis ? [{ bondIndex, fixedEndpointAtomIndex, movableEndpointAtomIndex,
      atomIndices:[...movable].sort((a, b) => a - b), origin, axis }] : [];
  }).sort((first, second) => first.bondIndex - second.bondIndex);
}

/**
 * Preserve a predecessor fragment as a chemically valid starting seed without
 * making it a coordinate restraint. Only non-ring single-bond torsions on the
 * non-hard side of the registered anchor may move. This keeps every bond
 * length and the hard-core transform unchanged, while giving candidate zero a
 * deterministic, predecessor-like frame that the later pose search may reject.
 */
export function placeSeedOnlyFragments({ molecule, initialPositions,
  referencePositions, hardCoreAtomPairs = [], features = [],
  anglesDegrees = EDIT_REGION_ANGLES_DEGREES, sweeps = 2 } = {}) {
  if (!molecule?.atoms?.length || !Array.isArray(molecule.bonds))
    throw new Error('Seed-only fragment placement requires a complete molecular graph');
  let positions = finitePositions(initialPositions, molecule.atoms.length);
  const hardCoreAtomIndices = Array.from(hardCoreAtomPairs || []).map((pair) => pair[1]);
  const audit = [];
  for (const feature of Array.from(features || [])) {
    const mappingVariants = Array.from(feature.mappingVariants || []);
    const featureAtomIndices = [...new Set(mappingVariants.flatMap((variant) =>
      Array.from(variant.atomPairs || []).map((pair) => pair[1])))];
    const before = fragmentCartesianScore(referencePositions, positions, mappingVariants);
    const rotors = seedOnlyRotors(molecule, positions, hardCoreAtomIndices, featureAtomIndices);
    let selected = before;
    for (let sweep = 0; sweep < Math.max(0, Math.round(Number(sweeps))); sweep++) {
      let improved = false;
      for (const rotorDefinition of rotors) {
        const origin = point(positions, rotorDefinition.fixedEndpointAtomIndex);
        const axis = normalized(point(positions, rotorDefinition.movableEndpointAtomIndex)
          .map((value, index) => value - origin[index]));
        if (!axis) continue;
        const candidates = Array.from(anglesDegrees || [], Number).map((angleDegrees) => {
          const candidate = Number(angleDegrees) === 0 ? positions
            : rotateRegion(positions, rotorDefinition.atomIndices, origin, axis,
              Number(angleDegrees) * Math.PI / 180);
          return { angleDegrees:Number(angleDegrees), candidate,
            score:fragmentCartesianScore(referencePositions, candidate, mappingVariants) };
        }).sort((first, second) => first.score.sumSquared - second.score.sumSquared
          || Math.abs(first.angleDegrees) - Math.abs(second.angleDegrees)
          || first.angleDegrees - second.angleDegrees);
        if (candidates[0].score.sumSquared + 1e-12 < selected.sumSquared) {
          positions = new Float64Array(candidates[0].candidate);
          selected = candidates[0].score;
          improved = true;
        }
      }
      if (!improved) break;
    }
    audit.push({ id:String(feature.id || 'seed-only-fragment'),
      treatment:'seed-only', candidateMaps:mappingVariants.length,
      atomCount:selected.atomPairs.length, rotorCount:rotors.length,
      initialRmsdAngstrom:before.rmsdAngstrom,
      seededRmsdAngstrom:selected.rmsdAngstrom,
      selectedVariantIndex:selected.variantIndex,
      method:'hard-core-invariant torsion seed/v1' });
  }
  return { positions, features:audit,
    method:'molarium-seed-only-fragment-placement/v1' };
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

function spatialFeatureMapVariants(definitions) {
  const variants = [];
  Array.from(definitions || []).forEach((definition, featureIndex) => {
    const maps = Array.from(definition.atomPairVariants || definition.mappingVariants || []);
    maps.forEach((variant, mappingVariantIndex) => {
      const atomPairs = Array.from(variant.atomPairs || variant || []).map((pair) =>
        Array.from(pair || [], Number));
      if (atomPairs.length < 3 || atomPairs.some((pair) => pair.length !== 2
        || !pair.every(Number.isInteger)))
        throw new Error(`Spatial feature ${definition.id || featureIndex} has an incomplete atom map`);
      variants.push({ featureId:String(definition.id || `spatial-feature-${featureIndex + 1}`),
        featureIndex, mappingVariantIndex, atomPairs });
    });
  });
  return variants.sort((first, second) => first.featureId.localeCompare(second.featureId)
    || first.mappingVariantIndex - second.mappingVariantIndex
    || first.featureIndex - second.featureIndex);
}

function priorityStratifiedSeeds({ candidates, initialCandidate, strata, requested }) {
  const required = strata.filter((stratum) => stratum.required);
  const selected = [], selectedSet = new Set();
  const select = (candidate) => {
    if (!candidate || selectedSet.has(candidate)) return false;
    selectedSet.add(candidate); selected.push(candidate); return true;
  };
  select(initialCandidate);
  const uncovered = new Set(required.map((stratum) => stratum.id));
  const markCovered = (candidate) => {
    candidate.coverageStratumIds.forEach((id) => uncovered.delete(id));
  };
  selected.forEach(markCovered);
  while (uncovered.size) {
    const next = candidates.map((candidate, candidateIndex) => ({ candidate, candidateIndex,
      gain:candidate.coverageStratumIds.reduce((count, id) =>
        count + Number(uncovered.has(id)), 0) }))
      .filter((entry) => entry.gain && !selectedSet.has(entry.candidate))
      .sort((first, second) => second.gain - first.gain
        || first.candidateIndex - second.candidateIndex)[0];
    if (!next) break;
    select(next.candidate); markCovered(next.candidate);
  }
  if (uncovered.size)
    throw new Error(`Feature-guided seeding could not cover required strata: ${[...uncovered].join(', ')}`);
  if (selected.length > requested)
    throw new Error(`Feature-guided seeding requires at least ${selected.length} search chains to cover every spatial-feature map and affected rotor; requested ${requested}`);

  // After one candidate from every required stratum, add further angles by
  // breadth-first round robin. This prevents a long angle list for the first
  // rotor from consuming a small 8/16-chain budget.
  const fillRoundRobin = (eligible) => {
    for (let round = 0; selected.length < requested; round++) {
      let available = false;
      for (const stratum of eligible) {
        const candidate = stratum.candidates[round];
        if (!candidate) continue;
        available = true; select(candidate);
        if (selected.length >= requested) break;
      }
      if (!available) break;
    }
  };
  fillRoundRobin([...required, ...strata.filter((stratum) => !stratum.required)]);
  candidates.forEach((candidate) => {
    if (selected.length < requested) select(candidate);
  });
  const expanded = Array.from({ length:requested }, (_, index) => selected[index % selected.length]);
  const selectedOrdinal = new Map(selected.map((candidate, index) => [candidate, index]));
  const evidence = strata.map((stratum) => ({
    id:stratum.id, kind:stratum.kind, required:stratum.required,
    candidateCount:stratum.candidates.length,
    ...(stratum.bestRmsdAngstrom == null ? {}
      : { bestRmsdAngstrom:stratum.bestRmsdAngstrom }),
    selectedSeedOrdinals:[...new Set(stratum.candidates
      .filter((candidate) => selectedOrdinal.has(candidate))
      .map((candidate) => selectedOrdinal.get(candidate)))],
  }));
  evidence.forEach((entry) => {
    entry.firstSelectedSeedOrdinal = entry.selectedSeedOrdinals.length
      ? Math.min(...entry.selectedSeedOrdinals) : null;
  });
  return {
    seeds:expanded.map((candidate, ordinal) => ({ positions:candidate.positions,
      audit:{ ...candidate.audit,
        coverageStratumIds:[...candidate.coverageStratumIds],
        selectionOrdinal:ordinal,
        uniqueSelectionOrdinal:selectedOrdinal.get(candidate) } })),
    coverage:{ policy:'required-strata-then-round-robin/v1',
      requestedCount:requested, generatedUniqueCandidateCount:candidates.length,
      selectedUniqueCandidateCount:selected.length,
      requiredStrataCount:required.length,
      coveredRequiredStrataCount:evidence.filter((entry) => entry.required
        && entry.selectedSeedOrdinals.length).length,
      allRequiredStrataCovered:evidence.filter((entry) => entry.required)
        .every((entry) => entry.selectedSeedOrdinals.length),
      strata:evidence },
  };
}

export function featureGuidedPoseSeeds({ molecule, initialPositions, coreAtomIndices,
  hydrogenBondConstraints = [], count = 16,
  spatialFeatureConstraints = [], referencePositions = null,
  editedAtomIndices = [], affectedAtomIndices = [], environmentBondRadius = 2,
  featureSeedingProtocol = 'v5',
  axialAnglesDegrees = AXIAL_ANGLES_DEGREES,
  editRegionAnglesDegrees = EDIT_REGION_ANGLES_DEGREES } = {}) {
  if (!molecule?.atoms?.length || !Array.isArray(molecule.bonds))
    throw new Error('Feature-guided seeding requires a complete molecular graph');
  if (!['v3', 'v4', 'v5'].includes(featureSeedingProtocol))
    throw new Error('featureSeedingProtocol must be v3, v4, or v5');
  const requested = Math.max(1, Math.round(Number(count)));
  const positions = finitePositions(initialPositions, molecule.atoms.length);
  const core = new Set(Array.from(coreAtomIndices || [], Number));
  const entries = adjacency(molecule);
  const variants = targetVariants(hydrogenBondConstraints);
  const spatialVariants = featureSeedingProtocol === 'v5'
    ? spatialFeatureMapVariants(spatialFeatureConstraints) : [];
  if (spatialVariants.length && !referencePositions)
    throw new Error('Spatial-feature seed coverage requires reference coordinates');
  const unique = [], seen = new Map(), strata = [];
  const stratum = (id, kind, required) => {
    const entry = { id, kind, required, candidates:[] };
    strata.push(entry); return entry;
  };
  const add = (candidate, audit, coverageStratum = null) => {
    const key = Array.from(candidate, (value) => Math.round(value * 1e6)).join(',');
    let entry = seen.get(key);
    if (!entry) {
      entry = { positions:candidate, audit, coverageStratumIds:[] };
      seen.set(key, entry); unique.push(entry);
    }
    if (coverageStratum) cover(entry, coverageStratum);
    return entry;
  };
  const cover = (entry, coverageStratum) => {
    if (!entry.coverageStratumIds.includes(coverageStratum.id))
      entry.coverageStratumIds.push(coverageStratum.id);
    if (!coverageStratum.candidates.includes(entry)) coverageStratum.candidates.push(entry);
  };
  const initialCandidate = add(positions, { method:'unaltered-reference-propagation' });
  const affectedRotors = ['v4', 'v5'].includes(featureSeedingProtocol)
    ? affectedEnvironmentRotors(molecule, core, entries, positions,
      editedAtomIndices, affectedAtomIndices, environmentBondRadius)
    : [];
  const releasedCoreAtomIndices = [...new Set(affectedRotors
    .flatMap((rotor) => rotor.releasedCoreAtomIndices))].sort((a, b) => a - b);
  const seedingCore = featureSeedingProtocol === 'v5'
    ? new Set([...core].filter((atomIndex) => !releasedCoreAtomIndices.includes(atomIndex)))
    : core;
  const targetedRegions = new Set(variants.flatMap((variant) => {
    const region = movableFeatureRegion(molecule, variant.featureAtomIndex, seedingCore, entries);
    return region ? [region.atomIndices.join(',')] : [];
  }).concat(spatialVariants.flatMap((variant) => variant.atomPairs.flatMap(([, productAtomIndex]) => {
    const region = movableFeatureRegion(molecule, productAtomIndex, seedingCore, entries);
    return region ? [region.atomIndices.join(',')] : [];
  }))));
  const untargetedRotors = connectedNonCoreRegions(molecule, seedingCore, entries)
    .filter((region) => !targetedRegions.has(region.atomIndices.join(',')))
    .map((region) => singleAnchorEditRotor(molecule, region, seedingCore, entries, positions))
    .filter(Boolean);
  const untargetedStrata = untargetedRotors.map((rotor, index) =>
    stratum(`untargeted-rotor:${rotor.anchorAtomIndex}:${rotor.axisAtomIndex}:${index}`,
      'untargeted-edit-rotor', false));
  untargetedRotors.forEach((rotor, rotorIndex) => {
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
        axialAngleDegrees:Number(angleDegrees) }, untargetedStrata[rotorIndex]);
    });
  });
  const affectedStrata = affectedRotors.map((rotor) =>
    stratum(`affected-rotor:bond-${rotor.bondIndex}`, 'affected-existing-rotor', true));
  affectedRotors.forEach((rotor, rotorIndex) => {
    editRegionAnglesDegrees.forEach((angleDegrees) => {
      const seeded = rotateRegion(positions, rotor.atomIndices, rotor.origin,
        rotor.axis, Number(angleDegrees) * Math.PI / 180);
      const candidate = add(seeded, { method:'affected-existing-rotor-torsion-scan',
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
      if (featureSeedingProtocol !== 'v5'
        || Number(angleDegrees) !== 0 && candidate !== initialCandidate)
        cover(candidate, affectedStrata[rotorIndex]);
    });
  });
  const targetStrata = variants.map((variant, index) => stratum(
    `captured-feature:${variant.constraintId}:${variant.alternativeId || 'primary'}:${index}`,
    'captured-feature-map', featureSeedingProtocol === 'v5'));
  variants.forEach((variant, variantIndex) => {
    const region = movableFeatureRegion(molecule, variant.featureAtomIndex, seedingCore, entries);
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
        movedAtomCount:region.atomIndices.length, axialAngleDegrees:Number(angleDegrees) },
      targetStrata[variantIndex]);
    });
  });
  const spatialStrata = spatialVariants.map((variant) => stratum(
    `spatial-feature:${variant.featureId}:feature-${variant.featureIndex}:map-${variant.mappingVariantIndex}`,
    'spatial-feature-map', true));
  spatialVariants.forEach((variant, variantIndex) => {
    if (variant.atomPairs.some(([referenceAtomIndex, productAtomIndex]) =>
      referenceAtomIndex < 0 || referenceAtomIndex * 3 + 2 >= referencePositions.length
      || productAtomIndex < 0 || productAtomIndex >= molecule.atoms.length))
      throw new Error(`Spatial feature ${variant.featureId} atom map is outside the available coordinates`);
    const placement = placeSeedOnlyFragments({ molecule, initialPositions:positions,
      referencePositions,
      hardCoreAtomPairs:[...seedingCore].sort((a, b) => a - b).map((index) => [index, index]),
      features:[{ id:variant.featureId,
        mappingVariants:[{ atomPairs:variant.atomPairs }] }],
      anglesDegrees:editRegionAnglesDegrees });
    add(placement.positions, { method:'spatial-feature-map-torsion-seed',
      featureId:variant.featureId, mappingVariantIndex:variant.mappingVariantIndex,
      placement:placement.features[0] });
    const ranked = unique.map((candidate, candidateIndex) => ({ candidate, candidateIndex,
      score:fragmentCartesianScore(referencePositions, candidate.positions,
        [{ atomPairs:variant.atomPairs }]) }))
      .sort((first, second) => first.score.sumSquared - second.score.sumSquared
        || first.candidateIndex - second.candidateIndex);
    spatialStrata[variantIndex].bestRmsdAngstrom = ranked[0].score.rmsdAngstrom;
    cover(ranked[0].candidate, spatialStrata[variantIndex]);
  });
  const stratified = featureSeedingProtocol === 'v5'
    ? priorityStratifiedSeeds({ candidates:unique, initialCandidate,
      strata, requested })
    : { seeds:Array.from({ length:requested }, (_, index) => unique[index % unique.length]),
      coverage:{ policy:'legacy-generated-order', requestedCount:requested,
        generatedUniqueCandidateCount:unique.length,
        selectedUniqueCandidateCount:Math.min(requested, unique.length),
        requiredStrataCount:0, coveredRequiredStrataCount:0,
        allRequiredStrataCovered:true, strata:[] } };
  return { seeds:stratified.seeds, uniqueSeedCount:unique.length, requestedCount:requested,
    targetVariantCount:variants.length, spatialFeatureMapCount:spatialVariants.length,
    untargetedRotorCount:untargetedRotors.length,
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
    coverage:stratified.coverage,
    method:`molarium-edit-region-axis-seeding/${featureSeedingProtocol}`,
    limitation:['v4', 'v5'].includes(featureSeedingProtocol)
      ? 'single-anchor edit regions and pre-existing non-ring single bonds within the declared edit environment are scanned; amide-like and genuinely rigid bonds remain fixed'
      : 'single-anchor edit regions are scanned; affected pre-existing rotors remain fixed' };
}

export const FEATURE_SEEDING_AXIAL_ANGLES_DEGREES = AXIAL_ANGLES_DEGREES;
export const EDIT_REGION_SEEDING_ANGLES_DEGREES = EDIT_REGION_ANGLES_DEGREES;
