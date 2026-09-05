const EPSILON = 1e-10;

function finitePoint(point, label) {
  const values = ['x','y','z'].map((axis) => Number(point?.[axis]));
  if (values.some((value) => !Number.isFinite(value)))
    throw new Error(`${label} must have finite x, y, and z coordinates`);
  return { x:values[0], y:values[1], z:values[2] };
}

function subtract(first, second) {
  return { x:first.x - second.x, y:first.y - second.y, z:first.z - second.z };
}

function dot(first, second) {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function cross(first, second) {
  return { x:first.y * second.z - first.z * second.y,
    y:first.z * second.x - first.x * second.z,
    z:first.x * second.y - first.y * second.x };
}

function scale(vector, factor) {
  return { x:vector.x * factor, y:vector.y * factor, z:vector.z * factor };
}

function length(vector) { return Math.hypot(vector.x, vector.y, vector.z); }

function signedDegrees(radians) {
  let degrees = radians * 180 / Math.PI;
  while (degrees > 180) degrees -= 360;
  while (degrees <= -180) degrees += 360;
  return degrees;
}

function selectRotation(candidates, solution) {
  const signed = candidates.map(signedDegrees);
  if (solution === 'nearest')
    return signed.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)[0];
  if (solution === 'positive')
    return signed.map((value) => value < 0 ? value + 360 : value)
      .sort((a, b) => a - b)[0];
  return signed.map((value) => value > 0 ? value - 360 : value)
    .sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)[0];
}

/**
 * Solve one directed-bond rotation using only coordinates in the current scene.
 * The ordered axis points from the preserved side to the moving branch.  Where
 * two rotations reach the requested distance, `solution` makes the choice
 * explicit and reproducible under the right-hand rule around that axis.
 */
export function solveDirectedBranchContact({ axisStart, axisEnd, ligandFeature,
  receptorTarget, targetDistanceAngstrom, solution = 'nearest' } = {}) {
  const start = finitePoint(axisStart, 'axisStart');
  const end = finitePoint(axisEnd, 'axisEnd');
  const feature = finitePoint(ligandFeature, 'ligandFeature');
  const target = finitePoint(receptorTarget, 'receptorTarget');
  const requestedDistance = Number(targetDistanceAngstrom);
  if (!Number.isFinite(requestedDistance) || requestedDistance <= 0
    || requestedDistance > 10)
    throw new Error('targetDistanceAngstrom must be greater than 0 and at most 10');
  if (!['nearest','positive','negative'].includes(solution))
    throw new Error('solution must be nearest, positive, or negative');

  const axisVector = subtract(end, start);
  const axisLength = length(axisVector);
  if (axisLength < EPSILON) throw new Error('The directed rotation axis has zero length');
  const axis = scale(axisVector, 1 / axisLength);
  const featureRelative = subtract(feature, start);
  const targetRelative = subtract(target, start);
  const featureParallel = dot(featureRelative, axis);
  const targetParallel = dot(targetRelative, axis);
  const featureRadial = subtract(featureRelative, scale(axis, featureParallel));
  const targetRadial = subtract(targetRelative, scale(axis, targetParallel));
  const featureRadius = length(featureRadial);
  const targetRadius = length(targetRadial);
  if (featureRadius < EPSILON)
    throw new Error('ligandFeature lies on the rotation axis and cannot define branch direction');
  if (targetRadius < EPSILON)
    throw new Error('receptorTarget lies on the rotation axis and cannot define a unique branch direction');

  const alignment = Math.atan2(dot(axis, cross(featureRadial, targetRadial)),
    dot(featureRadial, targetRadial));
  const parallelDelta = featureParallel - targetParallel;
  const constant = parallelDelta * parallelDelta
    + featureRadius * featureRadius + targetRadius * targetRadius;
  const coupling = 2 * featureRadius * targetRadius;
  const minimumDistance = Math.sqrt(Math.max(0, constant - coupling));
  const maximumDistance = Math.sqrt(Math.max(0, constant + coupling));
  const cosine = Math.max(-1, Math.min(1,
    (constant - requestedDistance * requestedDistance) / coupling));
  const offset = Math.acos(cosine);
  const rotationDegrees = selectRotation([alignment + offset, alignment - offset], solution);
  const appliedRadians = rotationDegrees * Math.PI / 180;
  const achievedDistance = Math.sqrt(Math.max(0, constant
    - coupling * Math.cos(appliedRadians - alignment)));
  const currentDistance = length(subtract(feature, target));

  return Object.freeze({
    schema:'molarium.directed-branch-contact-solution/v1',
    coordinateOrigin:'current-visible-molecule',
    externalReferenceCoordinatesUsed:false,
    solution, rightHandAxisOrder:'axisStart-to-axisEnd',
    targetDistanceAngstrom:requestedDistance,
    currentDistanceAngstrom:currentDistance,
    achievedDistanceAngstrom:achievedDistance,
    attainableDistanceRangeAngstrom:[minimumDistance, maximumDistance],
    targetReachable:requestedDistance >= minimumDistance - 1e-9
      && requestedDistance <= maximumDistance + 1e-9,
    appliedRotationDegrees:rotationDegrees,
  });
}

const VDW_RADII_ANGSTROM = Object.freeze({
  C:1.70, N:1.55, O:1.52, S:1.80, P:1.80, F:1.47,
  CL:1.75, BR:1.85, I:1.98,
});
const SEVERE_CLASH_RADIUS_FRACTION = 0.62;
const DEFAULT_DIRECTIONAL_SEARCH = Object.freeze({
  coarseStepDegrees:10, localStepDegrees:1, localSpanDegrees:10,
  idealDonorAcceptorDistanceAngstrom:2.9,
  idealHydrogenAcceptorDistanceAngstrom:1.9,
  maximumDonorAcceptorDistanceAngstrom:3.5,
  maximumHydrogenAcceptorDistanceAngstrom:2.6,
  minimumDhaAngleDegrees:150,
  minimumCarbonylAcceptorAngleDegrees:120,
  idealCarbonylAcceptorAngleDegrees:150,
});

function add(first, second) {
  return { x:first.x + second.x, y:first.y + second.y, z:first.z + second.z };
}

function distance(first, second) { return length(subtract(first, second)); }

function angleDegrees(first, center, last) {
  const from = subtract(first, center), to = subtract(last, center);
  const denominator = length(from) * length(to);
  if (denominator < EPSILON) throw new Error('Directional-contact angle is undefined');
  return Math.acos(Math.max(-1, Math.min(1, dot(from, to) / denominator))) * 180 / Math.PI;
}

function rotatePoint(point, origin, axisPoint, degrees) {
  const vector = subtract(point, origin), axisVector = subtract(axisPoint, origin);
  const axisLength = length(axisVector);
  if (axisLength < EPSILON) throw new Error('The directed rotation axis has zero length');
  const axis = scale(axisVector, 1 / axisLength), radians = degrees * Math.PI / 180;
  return add(origin, add(scale(vector, Math.cos(radians)), add(
    scale(cross(axis, vector), Math.sin(radians)),
    scale(axis, dot(axis, vector) * (1 - Math.cos(radians))))));
}

function normalizeSignedDegrees(value) {
  let result = Number(value);
  while (result > 180) result -= 360;
  while (result <= -180) result += 360;
  return Object.is(result, -0) ? 0 : result;
}

function atomPoint(atom, label) { return finitePoint(atom, label); }

function normalizedIndex(value, atomCount, label) {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index >= atomCount)
    throw new Error(`${label} must be an in-range atom index`);
  return index;
}

function residueLocator(atom) {
  return { residueName:String(atom?.residueName || ''), chain:String(atom?.chain || ''),
    residueIndex:Number(atom?.residueIndex), insertionCode:String(atom?.insertionCode || '') };
}

function residueLocatorKey(locator) {
  return `${locator.residueName}|${locator.chain}|${locator.residueIndex}|${locator.insertionCode || ''}`;
}

function normalizeAllowedResponseResidues(values) {
  if (!Array.isArray(values) || !values.length || values.length > 16)
    throw new Error('allowedResponseResidues must contain 1–16 portable residue locators');
  const result = values.map((value, ordinal) => {
    const residueName = String(value?.residueName || '').trim().toUpperCase();
    const chain = String(value?.chain || '').trim();
    const residueIndex = Number(value?.residueIndex);
    const insertionCode = String(value?.insertionCode || '').trim();
    if (!residueName || !chain || !Number.isInteger(residueIndex) || insertionCode.length > 4)
      throw new Error(`allowedResponseResidues[${ordinal}] is not a portable residue locator`);
    return { residueName, chain, residueIndex, insertionCode };
  });
  const unique = new Map(result.map((locator) => [residueLocatorKey(locator), locator]));
  if (unique.size !== result.length)
    throw new Error('allowedResponseResidues must not contain duplicates');
  return [...unique.values()].sort((first, second) =>
    residueLocatorKey(first).localeCompare(residueLocatorKey(second)));
}

function moleculeAdjacency(molecule) {
  const adjacency = molecule.atoms.map(() => []);
  molecule.bonds.forEach((bond, bondIndex) => {
    const first = normalizedIndex(bond.a, molecule.atoms.length, `bond ${bondIndex} first atom`);
    const second = normalizedIndex(bond.b, molecule.atoms.length, `bond ${bondIndex} second atom`);
    adjacency[first].push(second); adjacency[second].push(first);
  });
  adjacency.forEach((entries) => entries.sort((a, b) => a - b));
  return adjacency;
}

function directedBranch(adjacency, fixed, moving) {
  const seen = new Set([moving]), queue = [moving];
  while (queue.length) {
    const atom = queue.shift();
    for (const neighbor of adjacency[atom]) {
      if ((atom === fixed && neighbor === moving) || (atom === moving && neighbor === fixed)) continue;
      if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
    }
  }
  return { atomIndices:[...seen].sort((a, b) => a - b), cyclic:seen.has(fixed) };
}

function validateDirectedAxis(molecule, adjacency, ligand, pair, label) {
  if (!Array.isArray(pair) || pair.length !== 2 || pair[0] === pair[1])
    throw new Error(`${label} must contain two distinct ordered atom indices`);
  const fixed = normalizedIndex(pair[0], molecule.atoms.length, `${label}[0]`);
  const moving = normalizedIndex(pair[1], molecule.atoms.length, `${label}[1]`);
  if (!ligand.has(fixed) || !ligand.has(moving))
    throw new Error(`${label} must identify a bond within the selected ligand`);
  const bond = molecule.bonds.find((entry) =>
    entry.a === fixed && entry.b === moving || entry.a === moving && entry.b === fixed);
  if (!bond || Number(bond.order ?? 1) !== 1 || bond.aromatic)
    throw new Error(`${label} must identify a non-aromatic single bond`);
  const branch = directedBranch(adjacency, fixed, moving);
  if (branch.cyclic) throw new Error(`${label} is cyclic and cannot define a moving branch`);
  if (!branch.atomIndices.every((index) => ligand.has(index)))
    throw new Error(`${label} moving branch must remain within the selected ligand`);
  return { fixed, moving, atomIndices:branch.atomIndices };
}

function copyCoordinates(molecule) {
  return molecule.atoms.map((atom, index) => atomPoint(atom, `atom ${index}`));
}

function rotateCoordinates(coordinates, axis, degrees) {
  const origin = coordinates[axis.fixed], axisPoint = coordinates[axis.moving];
  axis.atomIndices.forEach((index) => {
    coordinates[index] = rotatePoint(coordinates[index], origin, axisPoint, degrees);
  });
}

function hydrogenBondGeometry(coordinates, donor, hydrogen, acceptor, carbonyl) {
  return {
    donorAcceptorDistanceAngstrom:distance(coordinates[donor], coordinates[acceptor]),
    hydrogenAcceptorDistanceAngstrom:distance(coordinates[hydrogen], coordinates[acceptor]),
    dhaAngleDegrees:angleDegrees(coordinates[donor], coordinates[hydrogen], coordinates[acceptor]),
    carbonylAcceptorAngleDegrees:angleDegrees(coordinates[carbonyl], coordinates[acceptor],
      coordinates[donor]),
  };
}

function contactScore(geometry, settings) {
  return Math.abs(geometry.hydrogenAcceptorDistanceAngstrom
      - settings.idealHydrogenAcceptorDistanceAngstrom)
    + 0.5 * Math.abs(geometry.donorAcceptorDistanceAngstrom
      - settings.idealDonorAcceptorDistanceAngstrom)
    + Math.max(0, settings.minimumDhaAngleDegrees - geometry.dhaAngleDegrees) / 30
    + Math.abs(settings.idealCarbonylAcceptorAngleDegrees
      - geometry.carbonylAcceptorAngleDegrees) / 30;
}

function geometryPasses(geometry, settings) {
  return geometry.donorAcceptorDistanceAngstrom <= settings.maximumDonorAcceptorDistanceAngstrom
    && geometry.hydrogenAcceptorDistanceAngstrom
      <= settings.maximumHydrogenAcceptorDistanceAngstrom
    && geometry.dhaAngleDegrees >= settings.minimumDhaAngleDegrees
    && geometry.carbonylAcceptorAngleDegrees
      >= settings.minimumCarbonylAcceptorAngleDegrees;
}

function severeContacts(molecule, coordinates, ligandAtomIndices,
  allowedResponseResidues, radiusFraction) {
  const ligand = new Set(ligandAtomIndices), allowed = new Set(allowedResponseResidues
    .map(residueLocatorKey));
  const ligandHeavy = ligandAtomIndices.filter((index) => molecule.atoms[index].element !== 'H');
  const receptorHeavy = molecule.atoms.flatMap((atom, index) =>
    !ligand.has(index) && atom.element !== 'H' ? [{ atom, index }] : []);
  const cellSize = 2.5, cells = new Map();
  const cellKey = (point) => `${Math.floor(point.x / cellSize)},${Math.floor(point.y / cellSize)},${Math.floor(point.z / cellSize)}`;
  receptorHeavy.forEach((entry) => {
    const key = cellKey(coordinates[entry.index]);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(entry);
  });
  const pairs = [];
  ligandHeavy.forEach((ligandIndex) => {
    const point = coordinates[ligandIndex];
    const x = Math.floor(point.x / cellSize), y = Math.floor(point.y / cellSize);
    const z = Math.floor(point.z / cellSize);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1)
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const { atom, index } of cells.get(`${x + dx},${y + dy},${z + dz}`) || []) {
          const actualDistance = distance(point, coordinates[index]);
          const threshold = radiusFraction * ((VDW_RADII_ANGSTROM[molecule.atoms[ligandIndex]
            .element] || 1.7) + (VDW_RADII_ANGSTROM[atom.element] || 1.7));
          if (actualDistance >= threshold) continue;
          const locator = residueLocator(atom), responseAllowed = allowed.has(residueLocatorKey(locator));
          pairs.push({ ligandAtomIndex:ligandIndex, receptorAtomIndex:index, locator,
            distanceAngstrom:actualDistance, thresholdAngstrom:threshold,
            overlapAngstrom:threshold - actualDistance, responseAllowed });
        }
      }
  });
  pairs.sort((first, second) => second.overlapAngstrom - first.overlapAngstrom
    || first.ligandAtomIndex - second.ligandAtomIndex
    || first.receptorAtomIndex - second.receptorAtomIndex);
  const groups = new Map();
  pairs.forEach((pair) => {
    const key = residueLocatorKey(pair.locator);
    if (!groups.has(key)) groups.set(key, { residue:pair.locator,
      responseAllowed:pair.responseAllowed, contactCount:0, maximumOverlapAngstrom:0,
      atomPairs:[] });
    const group = groups.get(key);
    group.contactCount += 1;
    group.maximumOverlapAngstrom = Math.max(group.maximumOverlapAngstrom,
      pair.overlapAngstrom);
    group.atomPairs.push({
      ligandAtomId:molecule.atoms[pair.ligandAtomIndex].designAtomId || null,
      ligandAtomName:molecule.atoms[pair.ligandAtomIndex].atomName || null,
      receptorAtomId:molecule.atoms[pair.receptorAtomIndex].designAtomId || null,
      receptorAtomName:molecule.atoms[pair.receptorAtomIndex].atomName || null,
      distanceAngstrom:pair.distanceAngstrom, thresholdAngstrom:pair.thresholdAngstrom,
      overlapAngstrom:pair.overlapAngstrom,
    });
  });
  const contactsByResidue = [...groups.values()].sort((first, second) =>
    residueLocatorKey(first.residue).localeCompare(residueLocatorKey(second.residue)));
  return { totalContactCount:pairs.length,
    outsideAllowedResponseContactCount:pairs.filter((pair) => !pair.responseAllowed).length,
    maximumOverlapAngstrom:pairs[0]?.overlapAngstrom || 0, contactsByResidue };
}

function candidateOrder(first, second) {
  return first.contactScore - second.contactScore
    || first.targetPointErrorAngstrom - second.targetPointErrorAngstrom
    || first.contacts.totalContactCount - second.contacts.totalContactCount
    || first.contacts.maximumOverlapAngstrom - second.contacts.maximumOverlapAngstrom
    || first.coupledMovementDegrees - second.coupledMovementDegrees
    || first.coupledRotationDegrees[0] - second.coupledRotationDegrees[0]
    || first.coupledRotationDegrees[1] - second.coupledRotationDegrees[1]
    || first.hydrogenRotationDegrees - second.hydrogenRotationDegrees;
}

function searchAngleValues(stepDegrees) {
  return Array.from({ length:Math.round(360 / stepDegrees) }, (_, ordinal) =>
    -180 + ordinal * stepDegrees);
}

/**
 * Apply one fixed chemist-directed primary branch rotation, then search two
 * declared downstream ligand rotors and the explicit donor-H torsion using
 * only the current molecule.  Receptor contacts may remain only in portable
 * residues explicitly designated for a subsequent receptor-only response.
 */
export function searchBestDirectionalBranchContact({ molecule, ligandAtomIndices,
  primaryAxisAtomIndices, coupledAxisAtomIndices, designerPrimaryRotationDegrees,
  donorAtomIndex, hydrogenAtomIndex, acceptorAtomIndex, carbonylAtomIndex,
  allowedResponseResidues, settings:requestedSettings = {} } = {}) {
  if (!molecule?.atoms?.length || !Array.isArray(molecule.bonds))
    throw new Error('best-directional contact search requires a complete molecule');
  const ligand = new Set(Array.from(ligandAtomIndices || [], Number));
  if (!ligand.size || [...ligand].some((index) => !Number.isInteger(index)
    || index < 0 || index >= molecule.atoms.length))
    throw new Error('ligandAtomIndices must contain in-range ligand atoms');
  const settings = { ...DEFAULT_DIRECTIONAL_SEARCH, ...requestedSettings };
  if (settings.coarseStepDegrees !== 10 || settings.localStepDegrees !== 1
    || settings.localSpanDegrees !== 10)
    throw new Error('best-directional search grid is fixed at deterministic 10°/1° strata');
  const primaryRotation = Number(designerPrimaryRotationDegrees);
  if (!Number.isFinite(primaryRotation) || Math.abs(primaryRotation) > 360)
    throw new Error('designerPrimaryRotationDegrees must be finite and within ±360');
  if (!Array.isArray(coupledAxisAtomIndices) || coupledAxisAtomIndices.length !== 2)
    throw new Error('coupledAxisAtomIndices must contain exactly two ordered ligand bonds');
  const allowed = normalizeAllowedResponseResidues(allowedResponseResidues);
  const adjacency = moleculeAdjacency(molecule);
  const primary = validateDirectedAxis(molecule, adjacency, ligand,
    primaryAxisAtomIndices, 'primaryAxisAtomIndices');
  const coupled = coupledAxisAtomIndices.map((pair, ordinal) =>
    validateDirectedAxis(molecule, adjacency, ligand, pair,
      `coupledAxisAtomIndices[${ordinal}]`));
  if (!coupled.every((axis) => primary.atomIndices.includes(axis.fixed)
    && primary.atomIndices.includes(axis.moving)))
    throw new Error('Every coupled axis must lie in the primary moving branch');
  const donor = normalizedIndex(donorAtomIndex, molecule.atoms.length, 'donorAtomIndex');
  const hydrogen = normalizedIndex(hydrogenAtomIndex, molecule.atoms.length, 'hydrogenAtomIndex');
  const acceptor = normalizedIndex(acceptorAtomIndex, molecule.atoms.length, 'acceptorAtomIndex');
  const carbonyl = normalizedIndex(carbonylAtomIndex, molecule.atoms.length, 'carbonylAtomIndex');
  if (!ligand.has(donor) || !ligand.has(hydrogen) || ligand.has(acceptor) || ligand.has(carbonyl))
    throw new Error('best-directional contact must use a ligand donor/H and receptor carbonyl acceptor');
  if (molecule.atoms[hydrogen].element !== 'H')
    throw new Error('hydrogenAtomIndex must identify the explicit ligand donor hydrogen');
  if (molecule.atoms[donor].element !== 'O' || molecule.atoms[acceptor].element !== 'O'
    || molecule.atoms[carbonyl].element !== 'C')
    throw new Error('best-directional mode currently requires an O-H donor and carbonyl oxygen acceptor');
  const donorNeighbors = adjacency[donor];
  if (!donorNeighbors.includes(hydrogen))
    throw new Error('The recorded ligand hydrogen is not bonded to its donor');
  const donorAnchorCandidates = donorNeighbors.filter((index) =>
    index !== hydrogen && molecule.atoms[index].element !== 'H');
  if (donorAnchorCandidates.length !== 1)
    throw new Error('The ligand donor must have one unambiguous heavy-atom torsion anchor');
  if (!adjacency[acceptor].includes(carbonyl))
    throw new Error('The inferred carbonyl carbon is not bonded to the receptor acceptor');
  const hydrogenAxis = validateDirectedAxis(molecule, adjacency, ligand,
    [donorAnchorCandidates[0], donor], 'donorHydrogenAxis');
  if (!hydrogenAxis.atomIndices.includes(hydrogen))
    throw new Error('The explicit donor hydrogen is outside the donor torsion branch');
  if (!primary.atomIndices.includes(donor) || !primary.atomIndices.includes(hydrogen))
    throw new Error('The recorded ligand donor must lie in the primary moving branch');

  const initialCoordinates = copyCoordinates(molecule);
  const primaryCoordinates = initialCoordinates.map((point) => ({ ...point }));
  rotateCoordinates(primaryCoordinates, primary, primaryRotation);
  const targetDirection = scale(subtract(initialCoordinates[acceptor],
    initialCoordinates[carbonyl]), 1 / distance(initialCoordinates[acceptor],
    initialCoordinates[carbonyl]));
  const targetPoint = add(initialCoordinates[acceptor], scale(targetDirection,
    settings.idealDonorAcceptorDistanceAngstrom));

  const counts = { evaluatedHeavyRotorCells:0, evaluatedHydrogenSolutions:0,
    directionalGatePassed:0, outsideAllowedResponseGatePassed:0 };
  const evaluate = (firstDegrees, secondDegrees) => {
    counts.evaluatedHeavyRotorCells += 1;
    const base = primaryCoordinates.map((point) => ({ ...point }));
    rotateCoordinates(base, coupled[0], firstDegrees);
    rotateCoordinates(base, coupled[1], secondDegrees);
    const hydrogenSolutions = ['positive','negative'].map((solution) =>
      solveDirectedBranchContact({ axisStart:base[hydrogenAxis.fixed],
        axisEnd:base[hydrogenAxis.moving], ligandFeature:base[hydrogen],
        receptorTarget:base[acceptor],
        targetDistanceAngstrom:settings.idealHydrogenAcceptorDistanceAngstrom,
        solution }));
    const unique = new Map(hydrogenSolutions.map((solution) =>
      [normalizeSignedDegrees(solution.appliedRotationDegrees).toFixed(9), solution]));
    return [...unique.values()].flatMap((solution) => {
      counts.evaluatedHydrogenSolutions += 1;
      const coordinates = base.map((point) => ({ ...point }));
      rotateCoordinates(coordinates, hydrogenAxis, solution.appliedRotationDegrees);
      const geometry = hydrogenBondGeometry(coordinates, donor, hydrogen, acceptor, carbonyl);
      if (!geometryPasses(geometry, settings)) return [];
      counts.directionalGatePassed += 1;
      const contacts = severeContacts(molecule, coordinates, [...ligand], allowed,
        SEVERE_CLASH_RADIUS_FRACTION);
      if (contacts.outsideAllowedResponseContactCount) return [];
      counts.outsideAllowedResponseGatePassed += 1;
      const coupledRotationDegrees = [normalizeSignedDegrees(firstDegrees),
        normalizeSignedDegrees(secondDegrees)];
      const hydrogenRotationDegrees = normalizeSignedDegrees(solution.appliedRotationDegrees);
      return [{ coupledRotationDegrees, hydrogenRotationDegrees, geometry, contacts,
        contactScore:contactScore(geometry, settings),
        targetPointErrorAngstrom:distance(coordinates[donor], targetPoint),
        coupledMovementDegrees:coupledRotationDegrees.reduce((sum, value) =>
          sum + Math.abs(value), 0) + Math.abs(hydrogenRotationDegrees),
        coordinates }];
    });
  };
  const coarseCountsBefore = { ...counts }, coarseCandidates = [];
  for (const firstDegrees of searchAngleValues(settings.coarseStepDegrees))
    for (const secondDegrees of searchAngleValues(settings.coarseStepDegrees))
      coarseCandidates.push(...evaluate(firstDegrees, secondDegrees));
  coarseCandidates.sort(candidateOrder);
  const coarseCounts = Object.fromEntries(Object.keys(counts).map((key) =>
    [key, counts[key] - coarseCountsBefore[key]]));
  if (!coarseCandidates.length) {
    const error = new Error('No best-directional candidate satisfies the contact and outside-response clash gates');
    error.searchAudit = { coarse:coarseCounts, local:null };
    throw error;
  }
  const center = coarseCandidates[0].coupledRotationDegrees, localCountsBefore = { ...counts };
  const localCandidates = [];
  for (let firstDegrees = center[0] - settings.localSpanDegrees;
    firstDegrees <= center[0] + settings.localSpanDegrees; firstDegrees += settings.localStepDegrees)
    for (let secondDegrees = center[1] - settings.localSpanDegrees;
      secondDegrees <= center[1] + settings.localSpanDegrees; secondDegrees += settings.localStepDegrees)
      localCandidates.push(...evaluate(firstDegrees, secondDegrees));
  localCandidates.sort(candidateOrder);
  const localCounts = Object.fromEntries(Object.keys(counts).map((key) =>
    [key, counts[key] - localCountsBefore[key]]));
  const selected = localCandidates[0] || coarseCandidates[0];
  const selectedCoordinates = primary.atomIndices.map((atomIndex) => ({ atomIndex,
    coordinatesAngstrom:[selected.coordinates[atomIndex].x,
      selected.coordinates[atomIndex].y, selected.coordinates[atomIndex].z] }));
  return Object.freeze({
    schema:'molarium.best-directional-branch-contact/v1',
    coordinateOrigin:'current-visible-molecule', externalReferenceCoordinatesUsed:false,
    allowedResponseResidues:Object.freeze(allowed.map((locator) => Object.freeze({ ...locator }))),
    selected:Object.freeze({
      designerPrimaryRotationDegrees:primaryRotation,
      coupledRotationDegrees:Object.freeze([...selected.coupledRotationDegrees]),
      donorHydrogenRotationDegrees:selected.hydrogenRotationDegrees,
      contactGeometry:Object.freeze({ ...selected.geometry }),
      contactScore:selected.contactScore,
      targetPointErrorAngstrom:selected.targetPointErrorAngstrom,
      contacts:Object.freeze(structuredClone(selected.contacts)),
      coupledMovementDegrees:selected.coupledMovementDegrees,
    }),
    searchAudit:Object.freeze({
      algorithm:'fixed-primary-two-coupled-rotors-plus-donor-h/v1',
      coarse:Object.freeze({ stepDegrees:settings.coarseStepDegrees,
        heavyRotorCellCount:searchAngleValues(settings.coarseStepDegrees).length ** 2,
        permittedCandidateCount:coarseCandidates.length, ...coarseCounts }),
      local:Object.freeze({ stepDegrees:settings.localStepDegrees,
        spanDegrees:settings.localSpanDegrees, centerDegrees:Object.freeze([...center]),
        heavyRotorCellCount:(settings.localSpanDegrees * 2 / settings.localStepDegrees + 1) ** 2,
        permittedCandidateCount:localCandidates.length, ...localCounts }),
      gates:Object.freeze({
        maximumDonorAcceptorDistanceAngstrom:settings.maximumDonorAcceptorDistanceAngstrom,
        maximumHydrogenAcceptorDistanceAngstrom:settings.maximumHydrogenAcceptorDistanceAngstrom,
        minimumDhaAngleDegrees:settings.minimumDhaAngleDegrees,
        minimumCarbonylAcceptorAngleDegrees:settings.minimumCarbonylAcceptorAngleDegrees,
        severeClashRadiusFraction:SEVERE_CLASH_RADIUS_FRACTION,
        outsideAllowedResponseContactCount:0,
      }),
      ranking:Object.freeze(['contactScore','targetPointErrorAngstrom',
        'totalAllowedResponseContactCount','maximumOverlapAngstrom',
        'coupledMovementDegrees','signed-rotation-lexical']),
    }),
    movingAtomIndices:Object.freeze([...primary.atomIndices]),
    selectedCoordinates:Object.freeze(selectedCoordinates.map((entry) => Object.freeze(entry))),
  });
}
