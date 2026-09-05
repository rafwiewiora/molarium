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
