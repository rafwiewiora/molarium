import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { exactCampaignHistoryPrefix } from
  '../design-history/frozen-checkpoint-review.mjs';
import { verifyCampaign } from '../design-history/ledger.mjs';
import { SOS1_CHECKPOINT_GRANULARITY } from
  './publish-sos1-frozen-browser-replays.mjs';

const scaffold = JSON.parse(await readFile(new URL(
  '../design-history/publications/sos1/checkpoints/scaffold-rewrite-campaign.json',
  import.meta.url)));
assert.equal((await verifyCampaign(scaffold)).valid, true);
const scaffoldHead = scaffold.objects.commits[scaffold.branches.main];
assert.equal(scaffoldHead.parents.length, 1);
const startingCommitId = scaffoldHead.parents[0];
const startingSnapshotId = scaffold.objects.commits[startingCommitId].snapshotId;
const startingSnapshot = scaffold.objects.snapshots[startingSnapshotId];
const prefix = await exactCampaignHistoryPrefix(scaffold, startingCommitId);
assert.equal(prefix.branches.main, startingCommitId);
assert.deepEqual(prefix.objects.snapshots[startingSnapshotId], startingSnapshot,
  'the starting-hit review state must be the exact recorded 5OVE/AXE snapshot');
assert.equal(Object.keys(prefix.objects.commits).length, 1);
assert.equal(Object.keys(prefix.objects.snapshots).length, 1);

const checkpointReview = JSON.parse(await readFile(new URL(
  '../design-history/examples/sos1-prediction-checkpoint-review.action-script.json',
  import.meta.url)));
const reviewGranularity = checkpointReview.provenance.coordinateGranularity;
const optionalIntermediateCheckpoints = [
  ['compound-21-graph-edit-before-phe890-rotamer',
    'Review compound 21 graph edit before Phe890 movement',
    'prospective-intermediate-checkpoint', true],
  ['phe890-rotamer-before-coupled-relaxation',
    'Review selected Phe890-out branch before ligand refinement',
    'prospective-intermediate-checkpoint', true],
];
const availableIntermediateCheckpoints = optionalIntermediateCheckpoints.filter(([stepId]) =>
  reviewGranularity.independentlyCommittedStates.includes(stepId));
const expectedReviewCheckpoints = [
  ['starting-hit', 'Review the exact prepared 5OVE/AXE starting hit',
    'registered-starting-hit', false],
  ['scaffold-rewrite', 'Review scaffold-rewrite prediction checkpoint',
    'complete-frozen-prediction', true],
  ['fragment-merge', 'Review fragment-merge prediction checkpoint',
    'complete-frozen-prediction', true],
  ...availableIntermediateCheckpoints,
  ['open-phe890-pocket', 'Review open-phe890-pocket prediction checkpoint',
    'complete-frozen-prediction', true],
  ['finish-bay-293', 'Review finish-bay-293 prediction checkpoint',
    'complete-frozen-prediction', true],
];
assert.equal(checkpointReview.actions.length, expectedReviewCheckpoints.length);
for (const [index, [stepId, caption, sourceStatus, preserveView]]
  of expectedReviewCheckpoints.entries()) {
  const move = checkpointReview.actions[index];
  assert.equal(move.action, 'campaign.import');
  assert.equal(move.caption, caption);
  assert.equal(move.args.preserveView, preserveView);
  assert.equal(move.review.sourceStatus, sourceStatus);
  assert.equal(move.review.calculationPolicy, 'none');
  assert.equal(move.review.holdoutCoordinatesIncluded, false);
  assert.match(move.args.sourcePath,
    new RegExp(`/${stepId === 'starting-hit' ? 'starting-hit' : stepId}-campaign\\.json$`));
}
assert.equal(checkpointReview.actions[0].review.registeredStartingHit, true);
assert.equal(checkpointReview.actions[0].review.exactHistoryPrefix, true);
for (const unavailable of reviewGranularity.unavailableIndependentStates)
  assert.equal(checkpointReview.actions.some((move) => move.caption.includes(unavailable)), false,
    `${unavailable} must not be presented as an independently recorded coordinate checkpoint`);

const audit = JSON.parse(await readFile(new URL(
  '../design-history/publications/sos1/source-runs/sos1-a013-a018-complete-frozen/chemist-action-audit.json',
  import.meta.url)));
const selectedGraphEdit = audit.records.find((record) =>
  record.requestId === 'open-phe890-pocket-stage' && record.status === 'completed');
const selectedRotamer = audit.records.find((record) =>
  record.requestId === 'open-phe890-pocket-apply-selected-phe890-branch'
  && record.status === 'completed');
const openPocketCommit = audit.records.find((record) =>
  record.requestId === 'open-phe890-pocket-commit-full-system'
  && record.status === 'completed');
assert.equal(selectedGraphEdit?.action, 'designRoute.applyStep');
assert.equal(selectedRotamer?.action, 'pose.applySidechainRotamer');
assert.equal(openPocketCommit?.action, 'campaign.commitCurrent');
assert(selectedGraphEdit.sequence < selectedRotamer.sequence
  && selectedRotamer.sequence < openPocketCommit.sequence);
const commitsBetweenGraphAndOpenPocket = audit.records.filter((record) =>
  record.status === 'completed' && record.action === 'campaign.commitCurrent'
  && record.sequence >= selectedGraphEdit.sequence
  && record.sequence < openPocketCommit.sequence);
assert.deepEqual(commitsBetweenGraphAndOpenPocket, [],
  'A new intermediate full-system commit now exists; replace the disclosed provenance gap with that exact checkpoint');
assert.equal(SOS1_CHECKPOINT_GRANULARITY.syntheticCoordinatesUsed, false);
assert.deepEqual(SOS1_CHECKPOINT_GRANULARITY.unavailableIndependentStates, [
  'compound-21-graph-edit-before-phe890-rotamer',
  'phe890-rotamer-before-coupled-relaxation',
]);

console.log('SOS1 checkpoint granularity: exact starting-hit prefix; explicit uncommitted compound-21/Phe890 intermediates PASS');
