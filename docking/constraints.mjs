function finitePoint(point, label) {
  if (!point || !['x', 'y', 'z'].every((axis) => Number.isFinite(Number(point[axis]))))
    throw new TypeError(`${label} must contain finite x, y, and z coordinates`);
  return [Number(point.x), Number(point.y), Number(point.z)];
}

function distance(first, second) {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

function clamp(value, lower, upper) { return Math.max(lower, Math.min(upper, value)); }

function flatBottomDeviation(value, lower, upper = lower) {
  return value < lower ? lower - value : value > upper ? value - upper : 0;
}

export function hydrogenBondGeometry({ donor, hydrogen, acceptor }) {
  const d = finitePoint(donor, 'donor');
  const h = finitePoint(hydrogen, 'hydrogen');
  const a = finitePoint(acceptor, 'acceptor');
  const hd = [d[0] - h[0], d[1] - h[1], d[2] - h[2]];
  const ha = [a[0] - h[0], a[1] - h[1], a[2] - h[2]];
  const denominator = Math.hypot(...hd) * Math.hypot(...ha);
  const cosine = denominator ? clamp(hd.reduce((sum, value, axis) => sum + value * ha[axis], 0) / denominator, -1, 1) : 1;
  return {
    donorAcceptorDistanceAngstrom: distance(d, a),
    hydrogenAcceptorDistanceAngstrom: distance(h, a),
    dhaAngleDegrees: Math.acos(cosine) * 180 / Math.PI,
  };
}

export function evaluateHydrogenBondConstraint(geometryOrAtoms, settings) {
  const geometry = geometryOrAtoms.donor ? hydrogenBondGeometry(geometryOrAtoms) : geometryOrAtoms;
  const donorAcceptorRange = settings.donorAcceptorDistanceAngstrom;
  const hydrogenAcceptorRange = settings.hydrogenAcceptorDistanceAngstrom;
  const daViolation = flatBottomDeviation(geometry.donorAcceptorDistanceAngstrom,
    donorAcceptorRange[0], donorAcceptorRange[1]);
  const haViolation = flatBottomDeviation(geometry.hydrogenAcceptorDistanceAngstrom,
    hydrogenAcceptorRange[0], hydrogenAcceptorRange[1]);
  const angleViolationDegrees = Math.max(0, settings.minimumDhaAngleDegrees - geometry.dhaAngleDegrees);
  const normalizedAngleViolation = angleViolationDegrees / 30;
  const penaltyKcalMol = Number(settings.weightKcalMol)
    * (daViolation ** 2 + haViolation ** 2 + normalizedAngleViolation ** 2);
  return {
    ...geometry,
    satisfied: daViolation === 0 && haViolation === 0 && angleViolationDegrees === 0,
    violations: { donorAcceptorAngstrom:daViolation, hydrogenAcceptorAngstrom:haViolation,
      angleDegrees:angleViolationDegrees },
    penaltyKcalMol,
  };
}

// Hydrogen atoms are not part of the hard heavy-atom scaffold. If an explicit
// ligand donor H survives an edit, restore its captured coordinate instead of
// inventing a new D-H-A direction that could violate the donor's local geometry.
export function restoreCapturedLigandDonorHydrogens(positions, definitions = []) {
  if (!ArrayBuffer.isView(positions) && !Array.isArray(positions))
    throw new TypeError('Ligand coordinates are required');
  if (!positions.length || positions.length % 3)
    throw new Error('Ligand coordinates must contain complete atoms');
  const restoredPositions = new Float64Array(positions);
  const restored = [], skipped = [], usedHydrogens = new Set();
  Array.from(definitions || []).flatMap((definition) =>
    definition.alternatives?.length ? definition.alternatives : [definition])
    .forEach((definition, ordinal) => {
    const id = definition.alternativeId || definition.id || `hbond-${ordinal + 1}`;
    const donor = definition.donor, hydrogen = definition.hydrogen;
    if (definition.required === false || donor?.scope !== 'ligand'
      || hydrogen?.scope !== 'ligand') return;
    const hydrogenIndex = Number(hydrogen.atomIndex);
    if (usedHydrogens.has(hydrogenIndex)) {
      skipped.push({ id, hydrogenAtomIndex:hydrogenIndex, reason:'hydrogen-already-restored' });
      return;
    }
    if (!hydrogen.referencePoint) {
      skipped.push({ id, hydrogenAtomIndex:hydrogenIndex, reason:'captured-coordinate-unavailable' });
      return;
    }
    const referencePoint = finitePoint(hydrogen.referencePoint, 'captured ligand hydrogen');
    const before = coordinates(restoredPositions, hydrogenIndex);
    for (let axis = 0; axis < 3; axis++) restoredPositions[hydrogenIndex * 3 + axis] = referencePoint[axis];
    usedHydrogens.add(hydrogenIndex);
    restored.push({ id, donorAtomIndex:Number(donor.atomIndex), hydrogenAtomIndex:hydrogenIndex,
      displacementAngstrom:distance(before, referencePoint) });
    });
  return { positions:restoredPositions, restored, skipped };
}

function coordinates(positions, index) {
  if (!Number.isInteger(index) || index < 0 || index * 3 + 2 >= positions.length)
    throw new RangeError(`Atom index ${index} is outside the coordinate array`);
  return [Number(positions[index * 3]), Number(positions[index * 3 + 1]), Number(positions[index * 3 + 2])];
}

export function fittedCoreTransform(referencePositions, candidatePositions, atomPairs) {
  if (!Array.isArray(atomPairs) || atomPairs.length < 3)
    throw new Error('A core constraint requires at least three matched atoms');
  const referenceCenter = [0, 0, 0], candidateCenter = [0, 0, 0];
  const pairs = atomPairs.map(([referenceAtom, candidateAtom]) => ({
    reference:coordinates(referencePositions, referenceAtom),
    candidate:coordinates(candidatePositions, candidateAtom),
  }));
  for (const pair of pairs) for (let axis = 0; axis < 3; axis++) {
    referenceCenter[axis] += pair.reference[axis];
    candidateCenter[axis] += pair.candidate[axis];
  }
  for (let axis = 0; axis < 3; axis++) {
    referenceCenter[axis] /= pairs.length;
    candidateCenter[axis] /= pairs.length;
  }
  const covariance = Array.from({ length:3 }, () => [0, 0, 0]);
  let referenceNorm = 0, candidateNorm = 0;
  for (const pair of pairs) {
    const p = pair.reference.map((value, axis) => value - referenceCenter[axis]);
    const q = pair.candidate.map((value, axis) => value - candidateCenter[axis]);
    referenceNorm += p.reduce((sum, value) => sum + value ** 2, 0);
    candidateNorm += q.reduce((sum, value) => sum + value ** 2, 0);
    for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++)
      covariance[row][column] += p[row] * q[column];
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = covariance;
  const horn = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const shift = Math.max(...horn.map((row) => row.reduce((sum, value) => sum + Math.abs(value), 0)));
  let vector = [0.5, 0.5, 0.5, 0.5];
  for (let iteration = 0; iteration < 64 && shift > 0; iteration++) {
    const next = horn.map((row, index) => row.reduce((sum, value, column) =>
      sum + value * vector[column], shift * vector[index]));
    const norm = Math.hypot(...next) || 1;
    vector = next.map((value) => value / norm);
  }
  const maximumTrace = vector.reduce((sum, value, row) => sum + value * horn[row]
    .reduce((inner, matrixValue, column) => inner + matrixValue * vector[column], 0), 0);
  const [w, x, y, z] = vector;
  return {
    referenceCenter,
    candidateCenter,
    rotation:[
      [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ],
    fittedRmsdAngstrom:Math.sqrt(Math.max(0,
      (referenceNorm + candidateNorm - 2 * maximumTrace) / pairs.length)),
  };
}

export function applyCoreTransform(candidatePositions, transform) {
  const transformed = new Float64Array(candidatePositions.length);
  for (let atom = 0; atom < candidatePositions.length / 3; atom++) {
    const centered = [0, 1, 2].map((axis) =>
      candidatePositions[atom * 3 + axis] - transform.candidateCenter[axis]);
    for (let axis = 0; axis < 3; axis++) transformed[atom * 3 + axis] = transform.referenceCenter[axis]
      + transform.rotation[0][axis] * centered[0]
      + transform.rotation[1][axis] * centered[1]
      + transform.rotation[2][axis] * centered[2];
  }
  return transformed;
}

export function snapCorePositions(referencePositions, candidatePositions, atomPairs) {
  if (!Array.isArray(atomPairs) || atomPairs.length < 3)
    throw new Error('A hard core constraint requires at least three matched atoms');
  const snapped = new Float64Array(candidatePositions);
  const seen = new Set();
  for (const [referenceAtom, candidateAtom] of atomPairs) {
    if (seen.has(candidateAtom)) throw new Error(`Candidate core atom ${candidateAtom} is mapped more than once`);
    seen.add(candidateAtom);
    const reference = coordinates(referencePositions, referenceAtom);
    coordinates(candidatePositions, candidateAtom);
    for (let axis = 0; axis < 3; axis++) snapped[candidateAtom * 3 + axis] = reference[axis];
  }
  return snapped;
}

export function evaluateCoreConstraint(referencePositions, candidatePositions, atomPairs, settings) {
  let sumSquared = 0;
  for (const [referenceAtom, candidateAtom] of atomPairs) {
    const reference = coordinates(referencePositions, referenceAtom);
    const candidate = coordinates(candidatePositions, candidateAtom);
    sumSquared += reference.reduce((sum, value, axis) => sum + (value - candidate[axis]) ** 2, 0);
  }
  const rmsdAngstrom = Math.sqrt(sumSquared / atomPairs.length);
  const violationAngstrom = Math.max(0, rmsdAngstrom - Number(settings.toleranceAngstrom));
  return {
    rmsdAngstrom,
    toleranceAngstrom:Number(settings.toleranceAngstrom),
    violationAngstrom,
    satisfied:violationAngstrom === 0,
    penaltyKcalMol:Number(settings.weightKcalMolPerAngstrom2) * violationAngstrom ** 2,
  };
}

export function scoreConstrainedPose({ physicalEnergyKcalMol, core, hydrogenBonds = [] }) {
  if (!Number.isFinite(Number(physicalEnergyKcalMol))) throw new TypeError('A finite physical energy is required');
  const constraintPenaltyKcalMol = Number(core?.penaltyKcalMol || 0)
    + hydrogenBonds.reduce((sum, constraint) => sum + Number(constraint.penaltyKcalMol || 0), 0);
  const requiredHydrogenBondsSatisfied = hydrogenBonds
    .filter((constraint) => constraint.required !== false)
    .every((constraint) => constraint.satisfied);
  const feasible = (core?.satisfied ?? true) && requiredHydrogenBondsSatisfied;
  return {
    physicalEnergyKcalMol:Number(physicalEnergyKcalMol),
    constraintPenaltyKcalMol,
    totalScoreKcalMol:Number(physicalEnergyKcalMol) + constraintPenaltyKcalMol,
    feasible,
    coreSatisfied:core?.satisfied ?? true,
    requiredHydrogenBondsSatisfied,
  };
}

export function rankConstrainedPoses(poses) {
  return poses.map((pose, inputIndex) => ({ ...pose, inputIndex }))
    .sort((first, second) => Number(second.feasible) - Number(first.feasible)
      || first.totalScoreKcalMol - second.totalScoreKcalMol
      || first.inputIndex - second.inputIndex)
    .map((pose, rank) => ({ ...pose, rank:rank + 1 }));
}
