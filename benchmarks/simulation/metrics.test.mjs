import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compare, quantile } from './metrics.mjs';
const limits = JSON.parse(readFileSync(new URL('./protocol.json', import.meta.url))).accuracy;
const ref = { energy: 0, forces: [0, 0, 0], components: { bond: 0 } };
test('identical zero forces and zero energy pass without NaN', () => {
  const r = compare(ref, ref, limits);
  assert.equal(r.passed, true); assert.equal(r.symmetricRelativeAtomError.max, 0);
});
test('zero reference, nonzero measured force fails and reports symmetric error 2', () => {
  const r = compare(ref, { energy: 0, forces: [1, 0, 0] }, limits);
  assert.equal(r.passed, false); assert.equal(r.symmetricRelativeAtomError.max, 2);
  assert.equal(r.forceRelativeRms, null);
});
test('non-finite and missing forces cannot become passing rows', () => {
  for (const forces of [[], [NaN, 0, 0], [Infinity, 0, 0], [0, 0]])
    assert.throws(() => compare(ref, { energy: 0, forces }, limits));
});
test('maximum-force gate catches outlier diluted in RMS', () => {
  const a = { energy: 0, components: { bond: 0 }, forces: Array(30000).fill(0) };
  const b = { ...a, forces: [...a.forces] }; b.forces[0] = 0.1;
  const r = compare(a, b, limits);
  assert.ok(r.forceRms < r.forceRmsLimit); assert.equal(r.passed, false);
});
test('energy gate uses sum of absolute components, not cancelled total energy', () => {
  assert.equal(compare({ ...ref, components: { bond: 1000, coulomb: -1000 } },
    { ...ref, energy: 0.01 }, limits).passed, true);
});
test('quantiles interpolate and reject malformed input', () => {
  assert.equal(quantile([3, 1, 4, 2], 0.5), 2.5);
  assert.throws(() => quantile([], 0.5));
  assert.throws(() => quantile([1, 2], NaN));
});
test('finite input components cannot overflow into an infinite passing tolerance', () => {
  assert.throws(() => compare({...ref,components:{a:1e308,b:-1e308}},
    {...ref,energy:1e200},limits), /Non-finite comparison/);
  assert.throws(() => compare(ref,ref,{...limits,energyAbsoluteTolerance:Infinity}),
    /Invalid acceptance tolerance/);
});
