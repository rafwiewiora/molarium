import { sha256Text } from './integrity.mjs';
import { verifyCampaign } from './ledger.mjs';
import { deserializeCampaign, serializeCampaign } from './live-campaign-store.mjs';
import { validateActionScript } from './replay.mjs';

export const ACCEPTED_CHECKPOINT_REVIEW_SCHEMA =
  'molarium.accepted-checkpoint-review/v1';

function stableText(value, label) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`${label} must not be empty`);
  return result;
}

function sha256(value, label) {
  const result = stableText(value, label);
  if (!/^[a-f0-9]{64}$/.test(result))
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

async function acceptedCheckpointMove(checkpoint, index) {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint))
    throw new Error(`Checkpoint ${index + 1} must be an object`);
  if (checkpoint.accepted !== true)
    throw new Error(`Checkpoint ${index + 1} is not an accepted scientific result`);
  if (checkpoint.frozenBeforeHoldoutAccess !== true)
    throw new Error(`Checkpoint ${index + 1} was not frozen before holdout access`);
  const checkpointSha256 = sha256(checkpoint.checkpointSha256,
    `Checkpoint ${index + 1} checkpointSha256`);
  const serialized = String(checkpoint.serializedCampaign || '');
  if (!serialized.trim())
    throw new Error(`Checkpoint ${index + 1} serializedCampaign must not be empty`);
  const campaignSha256 = sha256(checkpoint.campaignSha256,
    `Checkpoint ${index + 1} campaignSha256`);
  if (await sha256Text(serialized) !== campaignSha256)
    throw new Error(`Checkpoint ${index + 1} campaign bytes do not match campaignSha256`);
  const campaign = deserializeCampaign(serialized);
  if (serializeCampaign(campaign) !== serialized)
    throw new Error(`Checkpoint ${index + 1} campaign is not canonically serialized`);
  const verification = await verifyCampaign(campaign);
  if (!verification.valid)
    throw new Error(`Checkpoint ${index + 1} campaign is invalid: ${verification.reason}`);
  const branch = stableText(checkpoint.branch || 'main',
    `Checkpoint ${index + 1} branch`);
  const commitId = stableText(checkpoint.commitId,
    `Checkpoint ${index + 1} commitId`);
  const snapshotId = stableText(checkpoint.snapshotId,
    `Checkpoint ${index + 1} snapshotId`);
  if (campaign.branches?.[branch] !== commitId)
    throw new Error(`Checkpoint ${index + 1} branch head does not match commitId`);
  if (campaign.objects?.commits?.[commitId]?.snapshotId !== snapshotId)
    throw new Error(`Checkpoint ${index + 1} commit does not match snapshotId`);
  if (!campaign.objects?.snapshots?.[snapshotId])
    throw new Error(`Checkpoint ${index + 1} snapshot is unavailable`);
  const label = stableText(checkpoint.label || `Accepted checkpoint ${index + 1}`,
    `Checkpoint ${index + 1} label`);
  return {
    action:'campaign.import',
    args:{ serialized, preserveView:index > 0 },
    caption:`Review ${label}`,
    ...(index > 0 ? { expect:{ 'campaignImport.viewPreserved':true } } : {}),
    review:{
      schema:ACCEPTED_CHECKPOINT_REVIEW_SCHEMA,
      sourceStatus:'accepted',
      immutableSnapshot:true,
      promotable:false,
      calculationPolicy:'none',
      holdoutCoordinatesIncluded:false,
      checkpointSha256,
      campaignSha256,
      campaignId:campaign.campaignId,
      branch,
      commitId,
      snapshotId,
    },
  };
}

/**
 * Build a visible, calculation-free review of already accepted checkpoints.
 *
 * Every molecular state enters the application through the public
 * `campaign.import` Chemist Action.  The returned script is deliberately
 * non-promotable: it reviews accepted, content-addressed source snapshots but
 * does not perform or repeat the scientific calculation that produced them.
 */
export async function acceptedCheckpointReviewScript({ label, checkpoints } = {}) {
  if (!Array.isArray(checkpoints) || !checkpoints.length)
    throw new Error('At least one accepted checkpoint is required');
  const actions = [];
  for (const [index, checkpoint] of checkpoints.entries())
    actions.push(await acceptedCheckpointMove(checkpoint, index));
  const script = {
    schema:'molarium.chemist-action-script/v1',
    label:stableText(label || 'Accepted checkpoint review', 'Review label'),
    provenance:{
      schema:ACCEPTED_CHECKPOINT_REVIEW_SCHEMA,
      reviewOnly:true,
      sourceStatus:'accepted',
      sourceSnapshotsContentAddressed:true,
      promotable:false,
      nonPromotableReason:'A calculation-free review cannot create or promote a scientific result.',
      calculationPolicy:'none',
      holdoutCoordinatesIncluded:false,
      publicChemistActions:['campaign.import'],
    },
    actions,
  };
  validateActionScript(script);
  return script;
}
