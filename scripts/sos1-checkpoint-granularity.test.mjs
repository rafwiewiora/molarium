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
