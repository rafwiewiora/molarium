// No GPU or reference-engine dependency: test the acceptance logic independently.
export function quantile(values, p) {
  if (!values.length || !values.every(Number.isFinite) || p < 0 || p > 1)
    throw new Error('Invalid quantile input');
  const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * p;
  const lo = Math.floor(index), hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}
export function summarize(values) {
  return { n: values.length, min: quantile(values, 0), median: quantile(values, 0.5),
    p05: quantile(values, 0.05), p95: quantile(values, 0.95), max: quantile(values, 1) };
}
export function compare(reference, actual, thresholds) {
  const a = reference.forces, b = actual.forces;
  if (!a?.length || a.length % 3 || a.length !== b?.length)
    throw new Error('Force arrays must contain matching, nonempty Cartesian triples');
  if (![reference.energy, actual.energy, ...a, ...b,
    ...Object.values(reference.components)].every(Number.isFinite))
    throw new Error('Non-finite energy or force; never omit a failed sample');
  const delta = a.map((v, i) => b[i] - v);
  const rms = v => Math.hypot(...v) / Math.sqrt(v.length);
  const atomRelative = [], atomAbsolute = [];
  for (let i = 0; i < a.length; i += 3) {
    const normA = Math.hypot(...a.slice(i, i + 3));
    const normB = Math.hypot(...b.slice(i, i + 3));
    const normDelta = Math.hypot(...delta.slice(i, i + 3));
    atomRelative.push(normA + normB === 0 ? 0 : 2 * normDelta / (normA + normB));
    atomAbsolute.push(normDelta);
  }
  const energyAbsolute = Math.abs(actual.energy - reference.energy);
  const componentScale = Object.values(reference.components).reduce((s, v) => s + Math.abs(v), 0);
  const forceRms = rms(delta), referenceRms = rms(a);
  const forceMaxAbsolute = Math.max(...delta.map(Math.abs));
  const energyLimit = thresholds.energyAbsoluteTolerance + thresholds.energyComponentScaledTolerance * componentScale;
  const forceRmsLimit = thresholds.forceRmsAbsoluteTolerance + thresholds.forceRelativeRmsTolerance * referenceRms;
  const forceMaxLimit = thresholds.forceMaxAbsoluteTolerance
    + thresholds.forceMaxReferenceScaledTolerance * Math.max(...a.map(Math.abs));
  return { passed: energyAbsolute <= energyLimit && forceRms <= forceRmsLimit && forceMaxAbsolute <= forceMaxLimit,
    energyAbsolute, componentScale, energyLimit, forceRms, referenceRms,
    forceRelativeRms: referenceRms === 0 ? (forceRms === 0 ? 0 : null) : forceRms / referenceRms,
    forceRmsLimit, forceMaxAbsolute, forceMaxLimit,
    symmetricRelativeAtomError: summarize(atomRelative), absoluteAtomError: summarize(atomAbsolute) };
}
