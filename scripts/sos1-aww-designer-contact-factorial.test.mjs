import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL(
  './sos1-aww-designer-contact-factorial.browser.mjs', import.meta.url), 'utf8');

for (const pheState of ['native','plus60','out'])
  assert.match(source, new RegExp(`id:'${pheState}'`));
for (const hydrationState of ['retained','displaced-sensitivity-proxy'])
  assert.match(source, new RegExp(`'${hydrationState}'`));
for (const atomName of ['C12','C15','CX4','CX5'])
  assert.match(source, new RegExp(`'${atomName}'`));
assert.match(source, /REQUIRED_HARD_ATOM_NAMES\.every/);

assert.match(source, /requiredContactsSatisfied/);
assert.match(source, /requiredReleasedAtomsSatisfied/);
assert.match(source, /chemicalValidity/);
assert.match(source, /coverageComplete/);
assert.match(source, /At least one factorial branch must pass every prospective gate/);
assert.doesNotMatch(source, /Both factorial Phe branches must pass/);
assert.match(source, /hydrationUsedForPoseSelection:false/);
assert.match(source, /hydrationState === 'retained'/);
assert.match(source, /5OVH may be opened only after selection; this proxy does not open it/);
assert.doesNotMatch(source, /designRoute\.load[^\n]*5OVH/);

console.log('SOS1 AWW designer-contact factorial source tests passed');
