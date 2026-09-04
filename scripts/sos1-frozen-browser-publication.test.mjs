import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { commitMolecule, createCampaign, storeSnapshot } from
  '../design-history/ledger.mjs';
import { serializeCampaign } from '../design-history/live-campaign-store.mjs';
import { frozenCheckpointReviewScript } from
  '../design-history/frozen-checkpoint-review.mjs';
import { rewriteFrozenBrowserIntegration, SOS1_PREDICTION_DECLARATION,
  SOS1_PREDICTION_REPLAY, SOS1_PREDICTION_REVIEW } from
  './publish-sos1-frozen-browser-replays.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const checkpoints = [];
for (const index of [1,2]) {
  const occurredAt = `2026-01-0${index}T00:00:00.000Z`;
  const campaign = createCampaign({ campaignId:`frozen-browser-${index}`,
    title:`Prediction checkpoint ${index}`, createdAt:occurredAt,
    actors:[{ id:'agent.test', type:'agent', displayName:'Test agent' }] });
  const snapshotId = await storeSnapshot(campaign, { label:`checkpoint ${index}`,
    graph:{ atoms:[{ atomId:'A:1:CA', element:'C', formalCharge:0, record:'ATOM',
      atomName:'CA', residueName:'GLY', chain:'A', residueIndex:1 }], bonds:[] },
    coordinates:{ unit:'angstrom', atomIds:['A:1:CA'], positions:[[index,0,0]] } });
  const commitId = await commitMolecule(campaign, { snapshotId, parents:[], branch:'main',
    message:`Freeze prediction ${index}`, actorId:'agent.test', occurredAt,
    tags:['pre-holdout'] });
  const serializedCampaign = serializeCampaign(campaign);
  checkpoints.push({ completeFrozenPrediction:true, frozenBeforeHoldoutAccess:true,
    checkpointSha256:String(index).repeat(64), campaignSha256:sha256(serializedCampaign),
    serializedCampaign, branch:'main', commitId, snapshotId,
    label:`prediction checkpoint ${index}` });
}

const review = await frozenCheckpointReviewScript({ label:'SOS1 prediction checkpoint review',
  checkpoints, postFreezeEvaluation:{ summarySha256:'a'.repeat(64), accepted:false,
    continuityAccepted:false, failedStepIds:['finish-bay-293'] } });
assert.deepEqual(review.actions.map((step) => step.action),
  ['campaign.import','campaign.import']);
assert.deepEqual(review.actions.map((step) => step.args.preserveView), [false,true]);
assert.equal(review.actions[1].expect['campaignImport.viewPreserved'], true);
assert.equal(review.provenance.sourceStatus, 'complete-frozen-prediction');
assert.equal(review.provenance.postFreezeEvaluation.accepted, false);
assert.equal(review.provenance.promotable, false);
assert.equal(review.provenance.calculationPolicy, 'none');
assert(!JSON.stringify(review).includes('directCoordinates'));
const externalReview = await frozenCheckpointReviewScript({
  label:'External checkpoint review', checkpoints:[{
    ...checkpoints[0], serializedCampaign:undefined,
    campaignId:'frozen-browser-1',
    campaignPath:'./design-history/publications/sos1/checkpoints/scaffold-rewrite-campaign.json',
  }], postFreezeEvaluation:{ summarySha256:'a'.repeat(64) } });
assert.equal(externalReview.actions[0].args.serialized, undefined);
assert.equal(externalReview.actions[0].args.sourceSha256,
  checkpoints[0].campaignSha256);
assert.match(externalReview.actions[0].args.sourcePath,
  /^\.\/design-history\/publications\/sos1\/checkpoints\//);
await assert.rejects(() => frozenCheckpointReviewScript({ label:'bad', checkpoints:[{
  ...checkpoints[0], completeFrozenPrediction:false,
}], postFreezeEvaluation:{ summarySha256:'a'.repeat(64) } }),
/not from a complete frozen prediction run/);

const appSource = `const DESIGNER_STORY_LINKS = Object.freeze({
  'sos1-hit-to-bay293':Object.freeze({ title:'old', script:'./old.json', }),
  'sos1-hit-to-bay293-review':Object.freeze({ title:'old review', script:'./old-review.json', }),
});
`;
const rewritten = rewriteFrozenBrowserIntegration({ appSource,
  buildSource:"const files = [\n  'index.html',\n];\n",
  manifestSource:"const reviewedFiles = [\n  'index.html',\n];\n" },
{ replayBytes:Buffer.from('replay'), reviewBytes:Buffer.from('review') });
assert.match(rewritten.appSource, /title:'SOS1 prediction replay'/);
assert.match(rewritten.appSource, /title:'SOS1 prediction checkpoint review'/);
assert.match(rewritten.appSource,
  /'sos1-hit-to-bay293-review':[\s\S]*?presentation:'chemist-pocket'/);
assert(!/title:'SOS1 accepted|title:'[^']*success/i.test(rewritten.appSource));
for (const path of [SOS1_PREDICTION_REPLAY, SOS1_PREDICTION_REVIEW,
  SOS1_PREDICTION_DECLARATION]) {
  assert(rewritten.buildSource.includes(`'${path}'`));
  assert(rewritten.manifestSource.includes(`'${path}'`));
}
const publisherSource = await readFile(new URL(
  './publish-sos1-frozen-browser-replays.mjs', import.meta.url), 'utf8');
assert.match(publisherSource, /campaignPath:/);
assert.match(publisherSource, /campaignAssets/);
assert(!publisherSource.includes('serializedCampaign:fullSystem.serializedCampaign'));
assert.match(publisherSource, /verifyCompleteFrozenSos1Run/);
assert.match(publisherSource, /buildFrozenSos1ReplayScript/);
assert(!publisherSource.includes('verifyAcceptedSos1Run'));

console.log('SOS1 frozen browser publication: PASS');
