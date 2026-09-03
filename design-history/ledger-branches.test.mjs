import assert from 'node:assert/strict';
import { cloneRecord, sha256Object } from './integrity.mjs';
import { createCampaign, storeSnapshot, commitMolecule, createBranch, mergeBranch,
  finalizeCampaign, verifyCampaign } from './ledger.mjs';

const ACTOR = { id:'chemist.branch-test', type:'human', displayName:'Branch Tester' };
const TIME = '2026-09-02T12:00:00.000Z';

function campaign() {
  return createCampaign({ campaignId:'branch-test', title:'Branch primitive test',
    createdAt:TIME, actors:[ACTOR] });
}

async function rehashEvents(value) {
  let previousEntrySha256 = null;
  for (let index = 0; index < value.events.length; index++) {
    const event = value.events[index];
    const identity = cloneRecord({ schema:event.schema, occurredAt:event.occurredAt,
      recordedAt:event.recordedAt, kind:event.kind, actorId:event.actorId, branch:event.branch,
      parentEventIds:event.parentEventIds, subjectIds:event.subjectIds,
      sourceIds:event.sourceIds, payload:event.payload });
    event.eventId = `event:${await sha256Object(identity)}`;
    event.index = index;
    event.previousEntrySha256 = previousEntrySha256;
    const { entrySha256:ignored, ...body } = event;
    event.entrySha256 = await sha256Object(body);
    previousEntrySha256 = event.entrySha256;
  }
}

const value = campaign();
const baseSnapshot = await storeSnapshot(value, { label:'base', canonicalSmiles:'CC' });
const baseCommit = await commitMolecule(value, { snapshotId:baseSnapshot,
  message:'base', actorId:ACTOR.id, occurredAt:TIME });

const created = await createBranch(value, { branch:'series.fluoro', fromCommitId:baseCommit,
  actorId:ACTOR.id, occurredAt:'2026-09-02T12:01:00.000Z' });
assert.equal(created.kind, 'branch.created');
assert.equal(created.branch, 'series.fluoro');
assert.deepEqual(created.payload, { branch:'series.fluoro', fromCommitId:baseCommit });
assert.equal(value.branches['series.fluoro'], baseCommit);

await assert.rejects(() => createBranch(value, { branch:'series.fluoro',
  fromCommitId:baseCommit, actorId:ACTOR.id, occurredAt:TIME }), /already exists/);
await assert.rejects(() => createBranch(value, { branch:'not stable',
  fromCommitId:baseCommit, actorId:ACTOR.id, occurredAt:TIME }), /stable identifier/);
await assert.rejects(() => createBranch(value, { branch:'series.unknown-start',
  fromCommitId:'commit:missing', actorId:ACTOR.id, occurredAt:TIME }), /Unknown branch start/);

const featureSnapshot = await storeSnapshot(value, { label:'fluoro', canonicalSmiles:'CCF' });
const featureCommit = await commitMolecule(value, { snapshotId:featureSnapshot,
  parents:[baseCommit], branch:'series.fluoro', message:'fluoro branch', actorId:ACTOR.id,
  occurredAt:'2026-09-02T12:02:00.000Z' });
const mainSnapshot = await storeSnapshot(value, { label:'main update', canonicalSmiles:'CCC' });
const mainCommit = await commitMolecule(value, { snapshotId:mainSnapshot, parents:[baseCommit],
  branch:'main', message:'main branch', actorId:ACTOR.id,
  occurredAt:'2026-09-02T12:03:00.000Z' });
const mergeSnapshot = await storeSnapshot(value, { label:'merged design', canonicalSmiles:'CCCF' });
const mergeCommit = await mergeBranch(value, { sourceBranch:'series.fluoro',
  targetBranch:'main', snapshotId:mergeSnapshot, actorId:ACTOR.id,
  occurredAt:'2026-09-02T12:04:00.000Z', message:'merge fluoro design',
  tags:['selected'], hypothesisIds:['hypothesis:fluorination'], evidenceIds:['evidence:assay'] });

assert.equal(value.branches.main, mergeCommit);
assert.deepEqual(value.objects.commits[mergeCommit].parents, [mainCommit, featureCommit]);
assert.equal(value.objects.commits[mergeCommit].snapshotId, mergeSnapshot);
assert.equal(value.objects.commits[mergeCommit].branch, 'main');
assert.deepEqual(value.events.slice(-2).map((event) => event.kind),
  ['molecule.committed', 'branch.merged']);
assert.deepEqual(value.events.at(-1).payload, {
  sourceBranch:'series.fluoro', targetBranch:'main', sourceCommitId:featureCommit,
  targetCommitId:mainCommit, mergeCommitId:mergeCommit, snapshotId:mergeSnapshot,
  actionScriptId:null, message:'merge fluoro design',
  hypothesisIds:['hypothesis:fluorination'], evidenceIds:['evidence:assay'], tags:['selected'],
});
assert.equal((await verifyCampaign(value)).valid, true);

await assert.rejects(() => mergeBranch(value, { sourceBranch:'main', targetBranch:'main',
  snapshotId:mergeSnapshot, actorId:ACTOR.id, occurredAt:TIME }), /must be distinct/);
await assert.rejects(() => mergeBranch(value, { sourceBranch:'series.missing', targetBranch:'main',
  snapshotId:mergeSnapshot, actorId:ACTOR.id, occurredAt:TIME }), /Unknown source branch/);
await assert.rejects(() => mergeBranch(value, { sourceBranch:'series.fluoro',
  targetBranch:'series.missing', snapshotId:mergeSnapshot, actorId:ACTOR.id,
  occurredAt:TIME }), /Unknown target branch/);
await assert.rejects(() => mergeBranch(value, { sourceBranch:'series.fluoro', targetBranch:'main',
  actorId:ACTOR.id, occurredAt:TIME }), /explicit snapshotId/);

const emptyBranch = await createBranch(value, { branch:'series.empty', actorId:ACTOR.id,
  occurredAt:'2026-09-02T12:05:00.000Z' });
assert.equal(emptyBranch.payload.fromCommitId, null);
assert.equal(value.branches['series.empty'], null);
await assert.rejects(() => mergeBranch(value, { sourceBranch:'series.empty', targetBranch:'main',
  snapshotId:mergeSnapshot, actorId:ACTOR.id, occurredAt:TIME }), /has no head/);

const badCreation = cloneRecord(value);
const creationEvent = badCreation.events.find((event) => event.kind === 'branch.created');
creationEvent.payload.fromCommitId = 'commit:missing';
await rehashEvents(badCreation);
assert.match((await verifyCampaign(badCreation)).reason, /branch creation commit missing/);

const badMerge = cloneRecord(value);
badMerge.events.find((event) => event.kind === 'branch.merged').payload.sourceBranch = 'series.missing';
await rehashEvents(badMerge);
assert.match((await verifyCampaign(badMerge)).reason, /branch merge reference mismatch/);

const redirectedHead = cloneRecord(value);
redirectedHead.branches.main = featureCommit;
assert.deepEqual(await verifyCampaign(redirectedHead), {
  valid:false, reason:'branch heads do not match the event chain',
});

await finalizeCampaign(value, { finalizedAt:'2026-09-02T12:06:00.000Z', actorId:ACTOR.id });
assert.equal((await verifyCampaign(value)).valid, true);
await assert.rejects(() => createBranch(value, { branch:'series.late', actorId:ACTOR.id,
  occurredAt:TIME }), /immutable/);
await assert.rejects(() => mergeBranch(value, { sourceBranch:'series.fluoro', targetBranch:'main',
  snapshotId:mergeSnapshot, actorId:ACTOR.id, occurredAt:TIME }), /immutable/);

console.log(`design-history branch tests passed: ${Object.keys(value.branches).length} branches, multiple-parent merge verified`);
