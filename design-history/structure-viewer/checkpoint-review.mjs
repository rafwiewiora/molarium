const SHA256 = /^[a-f0-9]{64}$/;

function requireSha256(value, label) {
  if (!SHA256.test(value || '')) throw new Error(`${label} must be a lowercase SHA-256 digest`);
}

export function validatePrecomputedCheckpointReview(story, {
  actionScript, provenance, assetManifest,
} = {}) {
  const review = story?.review;
  if (!review) return null;
  if (review.schema !== 'molarium.precomputed-checkpoint-review/v1')
    throw new Error('Unsupported precomputed checkpoint-review schema');
  if (review.calculationPolicy !== 'never-run')
    throw new Error('A precomputed checkpoint review must use calculationPolicy never-run');
  requireSha256(review.sourceAuditSha256, 'review.sourceAuditSha256');
  if (provenance?.sourceRun?.audit?.sha256 !== review.sourceAuditSha256
    || assetManifest?.boundary?.agentApiAuditSha256 !== review.sourceAuditSha256)
    throw new Error('Checkpoint review source-audit provenance does not agree');
  const provenanceScripts = Object.values(provenance?.scripts || {});
  const matchingProvenanceScripts = provenanceScripts.filter((script) =>
    script?.fileSha256 === review.actionScript?.sha256);
  if (matchingProvenanceScripts.length !== 1)
    throw new Error('Checkpoint review action-script provenance does not agree');
  if (!Array.isArray(actionScript?.actions) || !actionScript.actions.length)
    throw new Error('Checkpoint review requires its source Chemist Actions script');
  if (!Array.isArray(assetManifest?.assets) || !Array.isArray(assetManifest?.checkpoints))
    throw new Error('Checkpoint review requires its generated-asset manifest');

  const assets = new Map();
  for (const asset of assetManifest.assets) {
    const name = asset.path?.split('/').at(-1);
    if (!name || assets.has(name))
      throw new Error(`Checkpoint review asset manifest has duplicate or invalid path ${asset.path}`);
    assets.set(name, asset);
  }
  for (const [sceneId, scene] of Object.entries(story.scenes || {})) {
    for (const model of scene.models || []) {
      requireSha256(model.sha256, `scene ${sceneId} model ${model.path}`);
      const asset = assets.get(model.path);
      if (!asset || asset.sha256 !== model.sha256)
        throw new Error(`Scene ${sceneId} model ${model.path} is not pinned by the asset manifest`);
    }
  }

  for (const cue of story.cues || []) {
    if (Array.isArray(cue.sceneSequence))
      throw new Error(`Checkpoint cue ${cue.id} cannot interpolate generated scenes`);
    if (!story.scenes?.[cue.scene]) throw new Error(`Checkpoint cue ${cue.id} has no scene`);
    const checkpoint = cue.checkpoint;
    if (!checkpoint || !Number.isInteger(checkpoint.sourceActionSequence)
      || checkpoint.sourceActionSequence < 1)
      throw new Error(`Checkpoint cue ${cue.id} requires a source action sequence`);
    const auditedActions = actionScript.actions.filter((step) =>
      Number.isInteger(step.auditSequence));
    const matchingActions = auditedActions.length
      ? auditedActions.filter((step) => step.auditSequence === checkpoint.sourceActionSequence)
      : [actionScript.actions[checkpoint.sourceActionSequence - 1]].filter(Boolean);
    if (matchingActions.length !== 1)
      throw new Error(`Checkpoint cue ${cue.id} does not identify one source Chemist Action`);
    const action = matchingActions[0];
    if (!action || action.action !== checkpoint.sourceAction)
      throw new Error(`Checkpoint cue ${cue.id} does not match its source Chemist Action`);
    if (checkpoint.predictionSha256) {
      requireSha256(checkpoint.predictionSha256, `checkpoint cue ${cue.id} predictionSha256`);
      const frozen = assetManifest.checkpoints.find((entry) =>
        entry.stepId === checkpoint.stepId
        && entry.predictedStateId === checkpoint.stateId);
      if (!frozen || frozen.sha256 !== checkpoint.predictionSha256
        || frozen.freezeActionSequence !== checkpoint.sourceActionSequence)
        throw new Error(`Checkpoint cue ${cue.id} does not match a frozen prediction manifest entry`);
    }
  }
  return story;
}
