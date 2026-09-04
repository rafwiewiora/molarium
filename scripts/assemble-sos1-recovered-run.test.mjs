import assert from 'node:assert/strict';
import { combineRecoveryAudits, SOS1_RECOVERED_RUN_SCHEMA } from
  './assemble-sos1-recovered-run.mjs';

const original = { schema:'molarium.chemist-actions/v1', records:Array.from(
  { length:251 }, (_, index) => ({ sequence:index + 1, requestId:`original-${index + 1}`,
    action:'view.setMode', args:{ mode:'design' }, status:'completed' })) };
const recovery = { schema:'molarium.chemist-actions/v1', records:[
  { sequence:1, requestId:'recovery-import', action:'campaign.import', args:{},
    status:'completed' },
  { sequence:2, requestId:'recovery-freeze', action:'session.inspect',
    args:{ scope:'pocket', includeCoordinates:true }, status:'completed' },
] };
const joined = combineRecoveryAudits(original, recovery);
assert.equal(joined.records.length, 253);
assert.deepEqual(joined.records.slice(0, 251), original.records,
  'original public replay records must be unchanged');
assert.equal(joined.replaySelection.maximumSequence, 251);
assert.equal(joined.records[251].sequence, 252);
assert.deepEqual(joined.records[251].retryProvenance, {
  schema:SOS1_RECOVERED_RUN_SCHEMA, attemptId:'a014', originalSequence:1,
  publicationReplay:false,
});
assert.throws(() => combineRecoveryAudits({ ...original,
  records:original.records.slice(0, 250) }, recovery), /exactly 251 records/);
assert.throws(() => combineRecoveryAudits(original, { ...recovery,
  records:[{ ...recovery.records[0], sequence:2 }] }), /not contiguous/);
console.log('SOS1 recovered-run assembler: PASS');
