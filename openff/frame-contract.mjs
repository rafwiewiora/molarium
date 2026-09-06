export function requestedSavedFrameCount(raw, steps) {
  const requested = Number(raw ?? 26);
  if (!Number.isInteger(steps) || steps < 0)
    throw new RangeError('Frame scheduling requires a nonnegative integer step count');
  if (!Number.isInteger(requested) || requested < (steps ? 2 : 1) || requested > 100001)
    throw new RangeError('savedFrameCount must be a finite integer between 2 and 100001 (1 is allowed for zero steps)');
  return Math.min(steps + 1, requested);
}

export function validateTrajectory({atomCount, replicaCount, frameCount, frameSteps,
  energies, trajectory, expectedSteps}) {
  for (const [name, value] of Object.entries({atomCount,replicaCount,frameCount}))
    if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  for (const [name, values, length] of [
    ['frameSteps',frameSteps,frameCount], ['energies',energies,frameCount * replicaCount],
    ['trajectory',trajectory,frameCount * replicaCount * atomCount * 3],
  ]) {
    if ((!Array.isArray(values) && !ArrayBuffer.isView(values)) || values.length !== length
        || !values.every(Number.isFinite))
      throw new RangeError(`${name} must contain exactly ${length} finite values`);
  }
  if (!Number.isInteger(expectedSteps) || expectedSteps < 0
      || frameSteps[0] !== 0 || frameSteps[frameCount - 1] !== expectedSteps
      || !frameSteps.every(Number.isInteger)
      || frameSteps.some((step, index) => index > 0 && step <= frameSteps[index - 1]))
    throw new RangeError('Trajectory must advance each replica through the exact requested steps');
}
