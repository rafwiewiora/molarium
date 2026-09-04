import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL(
  './sos1-aww-designer-contact-factorial.browser.mjs', import.meta.url), 'utf8');

for (const pheState of ['native','plus60','out'])
  assert.match(source, new RegExp(`id:'${pheState}'`));
for (const atomName of ['C12','C15','CX4','CX5'])
  assert.match(source, new RegExp(`'${atomName}'`));
assert.match(source, /REQUIRED_HARD_ATOM_NAMES\.every/);

assert.match(source, /requiredContactsSatisfied/);
assert.match(source, /requiredReleasedAtomsSatisfied/);
assert.match(source, /chemicalValidity/);
assert.match(source, /coverageComplete/);
assert.match(source, /coupledRotorCoverage/);
assert.match(source, /binaryEndpointSignatures/);
assert.match(source, /affected-existing-two-rotor-endpoint/);
assert.match(source, /affected-existing-two-rotor-endpoint-feature/);
assert.match(source, /endpointFeatureCoverage/);
assert.match(source, /donorHydrogensComposedWithHeavySeed/);
assert.match(source, /selectedSeedAudit\.donorHydrogenAlignments/);
assert.match(source, /At least one factorial branch must pass every prospective gate/);
assert.doesNotMatch(source, /Both factorial Phe branches must pass/);
assert.match(source, /hydrationUsedForPoseSelection:false/);
assert.match(source, /water is outside pose\.refine scoring/);
assert.doesNotMatch(source, /geometry\.translateAtoms/);
assert.match(source, /--branch phe-native\|phe-plus60\|phe-out/);
assert.match(source, /Unknown factorial branch/);
assert.match(source, /5OVH may be opened only after selection; this proxy does not open it/);
assert.doesNotMatch(source, /designRoute\.load[^\n]*5OVH/);

console.log('SOS1 AWW designer-contact factorial source tests passed');
