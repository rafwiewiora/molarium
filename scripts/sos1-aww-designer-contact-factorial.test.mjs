import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { receptorStateComparablePoseScore }
  from '../docking/receptor-state-comparable-score.mjs';

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
assert.match(source, /receptorStateComparablePoseScore/);
assert.match(source, /selectedComparablePoseScore/);
assert.match(source, /unnormalized receptor-ligand interaction plus weighted relative ligand strain/);
assert.doesNotMatch(source, /eligible\.sort\(\(a, b\) => a\.refinement\.selectedScoreKcalMol/);
assert.match(source, /--capture-review-coordinates/);
assert.match(source, /diagnosticPoseApplyArgs\(refinement\)/);
assert.match(source, /diagnosticReviewCaptureRecord/);
assert.match(source, /status:selected \? 'completed' : 'diagnostic-review-only'/);
assert.match(source, /if \(!captureReviewCoordinates\)\s+assert\(eligible\.length >= 1/);
assert(source.indexOf('const eligible = Object.values(prospectiveGates).every(Boolean)')
  < source.indexOf('const poseApplyArgs = captureReviewCoordinates'),
'diagnostic coordinate capture must occur only after eligibility is frozen');

const crossReceptorFixture = [{ id:'phe-native',
  physical:{ interactionKcalMol:2.3771642901472685,
    ligandStrainKcalMol:-6.7494358418232 } },
{ id:'phe-plus60', physical:{ interactionKcalMol:3.418926590090871,
  ligandStrainKcalMol:-6.7494358418232 } },
{ id:'phe-out', physical:{ interactionKcalMol:65.29064423748174,
  ligandStrainKcalMol:-7.874888407538187 } }];
const ranked = crossReceptorFixture.map((entry) => ({ ...entry,
  comparablePoseScore:receptorStateComparablePoseScore(entry.physical) }))
  .sort((first, second) => first.comparablePoseScore.energyKcalMol
    - second.comparablePoseScore.energyKcalMol || first.id.localeCompare(second.id));
assert.deepEqual(ranked.map((entry) => entry.id),
  ['phe-native', 'phe-plus60', 'phe-out'],
'factorial selection must compare unnormalized interactions across receptor states');

console.log('SOS1 AWW designer-contact factorial source tests passed');
