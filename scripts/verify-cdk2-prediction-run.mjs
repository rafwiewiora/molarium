import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function normalizedCheckpoint(checkpoint) {
  const copy = structuredClone(checkpoint);
  if (copy.ligand?.poseReference) copy.ligand.poseReference.capturedAt = '<capture-time>';
  if (copy.pocket?.poseReference) copy.pocket.poseReference.capturedAt = '<capture-time>';
  return copy;
}

export async function verifyCdk2PredictionRun({ runDir, replayDir = null }) {
  const manifestBytes = await readFile(join(runDir, 'prediction-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.campaignId, 'cdk2-hit-only');
  assert.equal(manifest.status, 'predictions-frozen-holdouts-unopened');
  assert.equal(manifest.protocol.initialCoordinateInput, 'PDB 1H1Q/2A6 only');
  assert.equal(manifest.protocol.sequentialPredictedReferences, true);
  const predictions = new Map();
  for (const frozen of manifest.checkpoints) {
    const bytes = await readFile(join(runDir, frozen.filename));
    assert.equal(digest(bytes), frozen.sha256, `${frozen.stepId}: frozen prediction hash changed`);
    const checkpoint = JSON.parse(bytes);
    assert.equal(checkpoint.frozenBeforeHoldoutAccess, true);
    assert.equal(checkpoint.parameterization.maximumCoordinateDisplacementAngstrom, 0);
    predictions.set(frozen.stepId, { frozen, checkpoint, bytes });
  }

  let auditBytes = null;
  try { auditBytes = await readFile(join(runDir, 'chemist-action-audit.json')); } catch (_) {}
  if (auditBytes && digest(auditBytes) === manifest.agentApi.auditSha256) {
    return { manifest, manifestBytes, predictions, auditBytes,
      audit:JSON.parse(auditBytes).records, auditProvenance:{ mode:'original-exact',
        expectedSha256:manifest.agentApi.auditSha256, actualSha256:digest(auditBytes) } };
  }

  assert(replayDir, 'original Agent API audit is unavailable and no provenance replay was supplied');
  const replayManifestBytes = await readFile(join(replayDir, 'prediction-manifest.json'));
  const replayManifest = JSON.parse(replayManifestBytes);
  const replayAuditBytes = await readFile(join(replayDir, 'chemist-action-audit.json'));
  assert.equal(digest(replayAuditBytes), replayManifest.agentApi.auditSha256,
    'provenance replay Agent API audit changed');
  assert.deepEqual(replayManifest.protocol, manifest.protocol, 'provenance replay protocol changed');
  assert.deepEqual(replayManifest.inputs, manifest.inputs, 'provenance replay source hashes changed');
  assert.equal(replayManifest.checkpoints.length, manifest.checkpoints.length);
  for (let index = 0; index < manifest.checkpoints.length; index++) {
    const original = manifest.checkpoints[index];
    const replay = replayManifest.checkpoints[index];
    assert.equal(replay.stepId, original.stepId);
    assert.equal(replay.predictedStateId, original.predictedStateId);
    assert.equal(replay.freezeActionSequence, original.freezeActionSequence);
    const replayBytes = await readFile(join(replayDir, replay.filename));
    assert.equal(digest(replayBytes), replay.sha256, `${replay.stepId}: replay checkpoint changed`);
    assert.deepEqual(normalizedCheckpoint(JSON.parse(replayBytes)),
      normalizedCheckpoint(predictions.get(original.stepId).checkpoint),
      `${replay.stepId}: replay differs beyond its capture timestamp`);
  }
  const audit = JSON.parse(replayAuditBytes).records;
  assert.equal(audit.length, manifest.agentApi.auditRecords);
  assert.deepEqual(audit.map((entry) => entry.sequence),
    Array.from({ length:audit.length }, (_, index) => index + 1));
  assert(audit.every((entry) => entry.status === 'completed'));
  for (const frozen of manifest.checkpoints) {
    const record = audit.find((entry) => entry.sequence === frozen.freezeActionSequence);
    assert(record?.action === 'session.inspect' && record?.args?.scope === 'pocket',
      `${frozen.stepId}: replay freeze action changed`);
  }
  return { manifest, manifestBytes, predictions, auditBytes:replayAuditBytes, audit,
    auditProvenance:{ mode:'semantic-replay',
      reason:'The original audit filename was overwritten by a movie smoke render; frozen checkpoints remain exact.',
      expectedOriginalSha256:manifest.agentApi.auditSha256,
      replaySha256:digest(replayAuditBytes), replayManifestSha256:digest(replayManifestBytes),
      checkpointDifference:'poseReference.capturedAt only' } };
}
