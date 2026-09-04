import assert from 'node:assert/strict';
import { compareReceptorStatePoses, receptorStateComparablePoseScore }
  from './receptor-state-comparable-score.mjs';

// Regression values from the SOS1 AWW Phe890 factorial.  The Phe-out starting
// reference clashes badly, so subtracting its branch-local reference makes its
// within-branch improvement look spuriously better than the native receptor.
const branches = [{
  id:'phe-native',
  referenceSubtractedScoreKcalMol:-553.3434742361494,
  physical:{
    interactionKcalMol:2.3771642901472685,
    interactionReferenceKcalMol:548.9712026844734,
    relativeInteractionKcalMol:-546.5940383943262,
    ligandStrainKcalMol:-6.7494358418232,
  },
}, {
  id:'phe-plus60',
  referenceSubtractedScoreKcalMol:-552.7281023669934,
  physical:{
    interactionKcalMol:3.418926590090871,
    interactionReferenceKcalMol:549.3975931152611,
    relativeInteractionKcalMol:-545.9786665251702,
    ligandStrainKcalMol:-6.7494358418232,
  },
}, {
  id:'phe-out',
  referenceSubtractedScoreKcalMol:-17647.365043146023,
  physical:{
    interactionKcalMol:65.29064423748174,
    interactionReferenceKcalMol:17704.780798975964,
    relativeInteractionKcalMol:-17639.490154738483,
    ligandStrainKcalMol:-7.874888407538187,
  },
}];

assert.equal([...branches].sort((a, b) => a.referenceSubtractedScoreKcalMol
  - b.referenceSubtractedScoreKcalMol)[0].id, 'phe-out',
'fixture must reproduce the invalid branch-local ordering');

const ranked = [...branches].sort(compareReceptorStatePoses);
assert.deepEqual(ranked.map((entry) => entry.id),
  ['phe-native', 'phe-plus60', 'phe-out']);
assert.ok(Math.abs(receptorStateComparablePoseScore(branches[0].physical).energyKcalMol
  - (-4.372271551675931)) < 1e-12);
assert.ok(Math.abs(receptorStateComparablePoseScore(branches[2].physical).energyKcalMol
  - 57.41575582994355) < 1e-12);

assert.equal(receptorStateComparablePoseScore({
  absoluteInteractionKcalMol:4,
  ligandStrainKcalMol:3,
  ligandStrainWeight:2,
  weightedLigandStrainKcalMol:6,
}).energyKcalMol, 10);
assert.throws(() => receptorStateComparablePoseScore({
  relativeInteractionKcalMol:-1000,
  ligandStrainKcalMol:0,
}), /Unnormalized receptor-ligand interaction must be finite/,
'a reference-subtracted total alone must never be accepted for cross-state ranking');

console.log('Cross-receptor-state pose scoring: PASS');
