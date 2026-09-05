import assert from 'node:assert/strict';
import { acceptedResultsTex } from './build-sos1-results-tex.mjs';

const steps = [
  ['scaffold-rewrite', '5OVF'],
  ['fragment-merge', '5OVG'],
  ['open-phe890-pocket', '5OVH'],
  ['finish-bay-293', '5OVI'],
];
const accepted = {
  runId:'sos1-accepted-v9',
  manifestBytes:Buffer.from('prediction'),
  evaluationBytes:Buffer.from('evaluation'),
  evaluation:{ accepted:true, continuity:{ accepted:true }, results:steps.map(
    ([stepId, holdoutPdbId], index) => ({ stepId, holdoutPdbId, accepted:true,
      failedChecks:[], ligandRmsdAngstrom:index + 0.125,
      predictedPhe890ChiDegrees:[-170 + index, 70 + index],
      holdoutPhe890ChiDegrees:[-165 + index, 75 + index] })) },
};

const tex = acceptedResultsTex(accepted);
assert.match(tex, /\\SosAcceptedRunId/);
assert.match(tex, /sos1-accepted-v9/);
assert.match(tex, /\\SosAxhLigandRmsd\}\{3\.125\}/);
assert.match(tex, /\\ensuremath\{-167\.0\\,\/\\,-162\.0\}/);

assert.throws(() => acceptedResultsTex({ ...accepted,
  evaluation:{ ...accepted.evaluation, accepted:false } }), /accepted=true/);
assert.throws(() => acceptedResultsTex({ ...accepted,
  evaluation:{ ...accepted.evaluation, continuity:{ accepted:false } } }), /continuity/);

console.log('SOS1 accepted-results TeX tests passed');
