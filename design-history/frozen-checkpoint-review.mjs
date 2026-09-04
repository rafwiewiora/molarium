import { sha256Text } from './integrity.mjs';
import { verifyCampaign } from './ledger.mjs';
import { deserializeCampaign, serializeCampaign } from './live-campaign-store.mjs';
import { validateActionScript } from './replay.mjs';

export const FROZEN_CHECKPOINT_REVIEW_SCHEMA =
  'molarium.frozen-prediction-checkpoint-review/v1';

function text(value, label) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`${label} must not be empty`);
  return result;
}

function digest(value, label) {
  const result = text(value, label);
  if (!/^[a-f0-9]{64}$/.test(result))
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

async function checkpointMove(checkpoint, index) {
  if (checkpoint?.completeFrozenPrediction !== true)
    throw new Error(`Checkpoint ${index + 1} is not from a complete frozen prediction run`);
  if (checkpoint.frozenBeforeHoldoutAccess !== true)
    throw new Error(`Checkpoint ${index + 1} was not frozen before holdout access`);
  const checkpointSha256 = digest(checkpoint.checkpointSha256,
    `Checkpoint ${index + 1} checkpointSha256`);
  const serialized = String(checkpoint.serializedCampaign || '');
  if (!serialized.trim())
    throw new Error(`Checkpoint ${index + 1} serializedCampaign must not be empty`);
  const campaignSha256 = digest(checkpoint.campaignSha256,
    `Checkpoint ${index + 1} campaignSha256`);
  if (await sha256Text(serialized) !== campaignSha256)
    throw new Error(`Checkpoint ${index + 1} campaign bytes do not match campaignSha256`);
  const campaign = deserializeCampaign(serialized);
  if (serializeCampaign(campaign) !== serialized)
    throw new Error(`Checkpoint ${index + 1} campaign is not canonically serialized`);
  const verification = await verifyCampaign(campaign);
  if (!verification.valid)
    throw new Error(`Checkpoint ${index + 1} campaign is invalid: ${verification.reason}`);
  const branch = text(checkpoint.branch || 'main', `Checkpoint ${index + 1} branch`);
  const commitId = text(checkpoint.commitId, `Checkpoint ${index + 1} commitId`);
  const snapshotId = text(checkpoint.snapshotId, `Checkpoint ${index + 1} snapshotId`);
  if (campaign.branches?.[branch] !== commitId)
    throw new Error(`Checkpoint ${index + 1} branch head does not match commitId`);
  if (campaign.objects?.commits?.[commitId]?.snapshotId !== snapshotId)
    throw new Error(`Checkpoint ${index + 1} commit does not match snapshotId`);
  if (!campaign.objects?.snapshots?.[snapshotId])
    throw new Error(`Checkpoint ${index + 1} snapshot is unavailable`);
  const label = text(checkpoint.label || `Prediction checkpoint ${index + 1}`,
    `Checkpoint ${index + 1} label`);
  return { action:'campaign.import', args:{ serialized, preserveView:index > 0 },
    caption:`Review ${label}`,
    ...(index > 0 ? { expect:{ 'campaignImport.viewPreserved':true } } : {}),
    review:{ schema:FROZEN_CHECKPOINT_REVIEW_SCHEMA,
      sourceStatus:'complete-frozen-prediction', immutableSnapshot:true,
      promotable:false, calculationPolicy:'none', holdoutCoordinatesIncluded:false,
      checkpointSha256, campaignSha256, campaignId:campaign.campaignId,
      branch, commitId, snapshotId } };
}

/** Build a calculation-free review of exact, content-addressed full-system
 * checkpoints. Post-freeze evaluation is metadata and never changes a snapshot. */
export async function frozenCheckpointReviewScript({ label, checkpoints,
  postFreezeEvaluation } = {}) {
  if (!Array.isArray(checkpoints) || !checkpoints.length)
    throw new Error('At least one complete frozen prediction checkpoint is required');
  const actions = [];
  for (const [index, checkpoint] of checkpoints.entries())
    actions.push(await checkpointMove(checkpoint, index));
  const evaluation = { attached:true,
    summarySha256:digest(postFreezeEvaluation?.summarySha256,
      'postFreezeEvaluation.summarySha256'),
    accepted:postFreezeEvaluation?.accepted === true,
    continuityAccepted:postFreezeEvaluation?.continuityAccepted === true,
    failedStepIds:Array.from(postFreezeEvaluation?.failedStepIds || []).map(String) };
  const script = { schema:'molarium.chemist-action-script/v1',
    label:text(label || 'SOS1 prediction checkpoint review', 'Review label'),
    provenance:{ schema:FROZEN_CHECKPOINT_REVIEW_SCHEMA, reviewOnly:true,
      sourceStatus:'complete-frozen-prediction', sourceSnapshotsContentAddressed:true,
      promotable:false,
      nonPromotableReason:'Checkpoint review performs no scientific calculation.',
      calculationPolicy:'none', holdoutCoordinatesIncluded:false,
      publicChemistActions:['campaign.import'], postFreezeEvaluation:evaluation },
    actions };
  validateActionScript(script);
  return script;
}
