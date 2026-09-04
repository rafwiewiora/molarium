import { sha256Text } from './integrity.mjs';
import { verifyCampaign } from './ledger.mjs';
import { deserializeCampaign, serializeCampaign } from './live-campaign-store.mjs';
import { validateActionScript } from './replay.mjs';

export const FROZEN_CHECKPOINT_REVIEW_SCHEMA =
  'molarium.frozen-prediction-checkpoint-review/v1';

/** Return a verified, canonical prefix of an existing campaign ending at an
 * already-recorded commit. Snapshot, commit, action-script, and event bytes
 * are copied verbatim; no molecular state is reconstructed. */
export async function exactCampaignHistoryPrefix(campaign, commitId) {
  const sourceVerification = await verifyCampaign(campaign);
  if (!sourceVerification.valid)
    throw new Error(`Cannot prefix an invalid campaign: ${sourceVerification.reason}`);
  const targetCommitId = text(commitId, 'History-prefix commitId');
  if (!campaign.objects?.commits?.[targetCommitId])
    throw new Error(`History-prefix commit is unavailable: ${targetCommitId}`);
  const targetEventIndex = campaign.events.findIndex((event) =>
    event.kind === 'molecule.committed' && event.payload?.commitId === targetCommitId);
  if (targetEventIndex < 0)
    throw new Error(`History-prefix commit has no chained event: ${targetCommitId}`);

  const prefix = structuredClone(campaign);
  prefix.events = prefix.events.slice(0, targetEventIndex + 1);
  const retainedCommitIds = new Set(prefix.events.flatMap((event) =>
    event.kind === 'molecule.committed' ? [event.payload.commitId] : []));
  prefix.objects.commits = Object.fromEntries(Object.entries(prefix.objects.commits)
    .filter(([id]) => retainedCommitIds.has(id)));
  for (const [id, commit] of Object.entries(prefix.objects.commits))
    if (commit.parents.some((parent) => !retainedCommitIds.has(parent)))
      throw new Error(`History-prefix commit ${id} depends on a later or missing parent`);
  const retainedSnapshotIds = new Set(Object.values(prefix.objects.commits)
    .map((commit) => commit.snapshotId));
  const retainedActionScriptIds = new Set(Object.values(prefix.objects.commits)
    .flatMap((commit) => commit.actionScriptId ? [commit.actionScriptId] : []));
  prefix.objects.snapshots = Object.fromEntries(Object.entries(prefix.objects.snapshots)
    .filter(([id]) => retainedSnapshotIds.has(id)));
  prefix.objects.actionScripts = Object.fromEntries(Object.entries(prefix.objects.actionScripts)
    .filter(([id]) => retainedActionScriptIds.has(id)));

  const branches = { main:null };
  for (const event of prefix.events) {
    if (event.kind === 'branch.created')
      branches[event.payload.branch] = event.payload.fromCommitId;
    if (event.kind === 'molecule.committed') {
      const commit = prefix.objects.commits[event.payload.commitId];
      if (!Object.hasOwn(branches, commit.branch))
        branches[commit.branch] = commit.parents[0] || null;
      branches[commit.branch] = event.payload.commitId;
    }
  }
  prefix.branches = branches;
  prefix.finalizedAt = null;
  prefix.campaignSha256 = null;
  const prefixVerification = await verifyCampaign(prefix);
  if (!prefixVerification.valid)
    throw new Error(`Campaign history prefix is invalid: ${prefixVerification.reason}`);
  if (prefix.branches[prefix.objects.commits[targetCommitId].branch] !== targetCommitId)
    throw new Error('History-prefix target is not the resulting branch head');
  return prefix;
}

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
  const startingHit = checkpoint?.registeredStartingHit === true;
  const prospectiveIntermediate = checkpoint?.prospectiveIntermediate === true;
  if ([startingHit, prospectiveIntermediate,
    checkpoint?.completeFrozenPrediction === true].filter(Boolean).length !== 1)
    throw new Error(`Checkpoint ${index + 1} is not from a complete frozen prediction run`);
  if (startingHit && checkpoint?.exactHistoryPrefix !== true)
    throw new Error(`Checkpoint ${index + 1} starting hit is not an exact campaign history prefix`);
  if (checkpoint.frozenBeforeHoldoutAccess !== true)
    throw new Error(`Checkpoint ${index + 1} was not frozen before holdout access`);
  const checkpointSha256 = digest(checkpoint.checkpointSha256,
    `Checkpoint ${index + 1} checkpointSha256`);
  const serialized = String(checkpoint.serializedCampaign || '');
  const campaignPath = String(checkpoint.campaignPath || '');
  if (Boolean(serialized.trim()) === Boolean(campaignPath.trim()))
    throw new Error(`Checkpoint ${index + 1} requires exactly one serializedCampaign or campaignPath`);
  const campaignSha256 = digest(checkpoint.campaignSha256,
    `Checkpoint ${index + 1} campaignSha256`);
  if (serialized && await sha256Text(serialized) !== campaignSha256)
    throw new Error(`Checkpoint ${index + 1} campaign bytes do not match campaignSha256`);
  if (!serialized) {
    if (campaignPath.includes('..') || campaignPath.includes('\\')
      || campaignPath.startsWith('/') || campaignPath.includes('?') || campaignPath.includes('#'))
      throw new Error(`Checkpoint ${index + 1} campaignPath is not a safe relative asset path`);
    return { action:'campaign.import', args:{ sourcePath:campaignPath,
      sourceSha256:campaignSha256, preserveView:index > 0 },
      caption:`Review ${text(checkpoint.label || `Prediction checkpoint ${index + 1}`,
        `Checkpoint ${index + 1} label`)}`,
      ...(index > 0 ? { expect:{ 'campaignImport.viewPreserved':true } } : {}),
      review:{ schema:FROZEN_CHECKPOINT_REVIEW_SCHEMA,
        sourceStatus:startingHit ? 'registered-starting-hit' : prospectiveIntermediate
          ? 'prospective-intermediate-checkpoint' : 'complete-frozen-prediction',
        immutableSnapshot:true, ...(startingHit ? { registeredStartingHit:true,
          exactHistoryPrefix:true } : {}), ...(prospectiveIntermediate
          ? { prospectiveIntermediate:true } : {}),
        promotable:false, calculationPolicy:'none', holdoutCoordinatesIncluded:false,
        checkpointSha256, campaignSha256,
        campaignId:text(checkpoint.campaignId, `Checkpoint ${index + 1} campaignId`),
        branch:text(checkpoint.branch, `Checkpoint ${index + 1} branch`),
        commitId:text(checkpoint.commitId, `Checkpoint ${index + 1} commitId`),
        snapshotId:text(checkpoint.snapshotId, `Checkpoint ${index + 1} snapshotId`) } };
  }
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
      sourceStatus:startingHit ? 'registered-starting-hit' : prospectiveIntermediate
        ? 'prospective-intermediate-checkpoint' : 'complete-frozen-prediction',
      immutableSnapshot:true, ...(startingHit ? { registeredStartingHit:true,
        exactHistoryPrefix:true } : {}), ...(prospectiveIntermediate
        ? { prospectiveIntermediate:true } : {}),
      promotable:false, calculationPolicy:'none', holdoutCoordinatesIncluded:false,
      checkpointSha256, campaignSha256, campaignId:campaign.campaignId,
      branch, commitId, snapshotId } };
}

/** Build a calculation-free review of exact, content-addressed full-system
 * checkpoints. Post-freeze evaluation is metadata and never changes a snapshot. */
export async function frozenCheckpointReviewScript({ label, checkpoints,
  postFreezeEvaluation, coordinateGranularity = null } = {}) {
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
      ...(coordinateGranularity ? { coordinateGranularity:
        structuredClone(coordinateGranularity) } : {}),
      publicChemistActions:['campaign.import'], postFreezeEvaluation:evaluation },
    actions };
  validateActionScript(script);
  return script;
}
