import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { actionScriptFromAudit, actionScriptSha256,
  validateActionScript } from '../design-history/replay.mjs';

export const SOS1_ROUTE_ID = 'sos1-hit-only';
export const SOS1_STEP_IDS = Object.freeze([
  'scaffold-rewrite', 'fragment-merge', 'open-phe890-pocket', 'finish-bay-293',
]);
const HOLDOUT_IDS = Object.freeze(['5OVF', '5OVG', '5OVH', '5OVI']);

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  if (index >= 0) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    return value;
  }
  return argv.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1) || null;
}

export function requireExplicitRunDirectory(argv, { root = process.cwd() } = {}) {
  const value = argumentValue(argv, '--run');
  if (!value) throw new Error('--run is required; SOS1 publication assets never select a run implicitly');
  return resolve(root, value);
}

export function assertAcceptedCheckpointRelaxation(checkpoint, label = checkpoint?.stepId) {
  assert.equal(checkpoint?.relaxation?.accepted, true,
    `${label}: required checkpoint relaxation was not accepted`);
  if (checkpoint?.stepId === 'finish-bay-293') {
    const continuity = checkpoint.sidechainContinuity;
    assert.equal(continuity?.residue, 'PHE A890',
      `${label}: final Phe890 state was not independently remeasured`);
    assert.equal(continuity?.accepted, true,
      `${label}: Phe890 left the selected predecessor rotamer basin`);
    assert(Array.isArray(continuity.finalChiDegrees)
      && continuity.finalChiDegrees.length >= 1
      && continuity.finalChiDegrees.every(Number.isFinite),
    `${label}: final Phe890 chi measurement is incomplete`);
  }
  const requiredFeatures = Array.from(
    checkpoint?.staging?.poseTransferPlan?.featureCorrespondences || [])
    .filter((feature) => feature.required === true);
  if (!requiredFeatures.length) return;
  const retention = checkpoint.relaxation.registeredPoseRetention;
  assert.equal(retention?.accepted, true,
    `${label}: registered pose retention was not accepted after relaxation`);
  assert.equal(retention?.after?.active, true,
    `${label}: registered pose retention was inactive after relaxation`);
  assert.equal(retention?.after?.accepted, true,
    `${label}: post-relax registered pose feature exceeds tolerance`);
  assert(Number.isFinite(retention.after.hardAnchor?.rmsdAngstrom)
    && Number.isFinite(retention.after.hardAnchor?.maxDisplacementAngstrom)
    && retention.after.hardAnchor.rmsdAngstrom <= 1e-6
    && retention.after.hardAnchor.maxDisplacementAngstrom <= 1e-6,
  `${label}: registered hard anchor moved during coupled relaxation`);
  assert.equal(retention.after.features?.length, requiredFeatures.length,
    `${label}: post-relax registered feature count is not exact`);
  for (const required of requiredFeatures) {
    const matches = (retention.after.features || []).filter((feature) =>
      feature.id === required.id
      && feature.registeredIntentId === required.registeredIntentId);
    assert.equal(matches.length, 1,
      `${label}: required registered pose feature is missing or ambiguous after relaxation`);
    const measured = matches[0];
    for (const key of ['rmsdAngstrom','centroidDisplacementAngstrom',
      'planeNormalAngleDegrees'])
      assert(Number.isFinite(measured[key]), `${label}: ${required.id} lacks ${key}`);
    assert.equal(measured.toleranceAngstrom,
      required.restraint?.toleranceAngstrom,
    `${label}: ${required.id} post-relax tolerance changed`);
    assert(measured.rmsdAngstrom <= measured.toleranceAngstrom,
      `${label}: ${required.id} moved outside its registered tolerance`);
  }
}

function assertNoHoldoutCoordinatePayload(value, path = 'checkpoint') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoHoldoutCoordinatePayload(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const coordinatePayload = Object.hasOwn(value, 'coordinatesAngstrom')
    || Object.hasOwn(value, 'coordinates') || Object.hasOwn(value, 'pdbText')
    || Object.hasOwn(value, 'molBlock');
  const holdoutIdentity = value.coordinateClass === 'evaluation-only-holdout'
    || value.role === 'evaluation-only'
    || HOLDOUT_IDS.includes(String(value.pdbId || '').toUpperCase())
    || HOLDOUT_IDS.includes(String(value.holdoutPdbId || '').toUpperCase());
  if (coordinatePayload && holdoutIdentity)
    throw new Error(`${path} contains evaluation-only holdout coordinates`);
  for (const [key, entry] of Object.entries(value))
    assertNoHoldoutCoordinatePayload(entry, `${path}.${key}`);
}

function assertReplayContainsNoCoordinatesOrHoldouts(script) {
  const serialized = JSON.stringify(script);
  for (const pdbId of HOLDOUT_IDS)
    assert(!serialized.includes(pdbId), `Replay script contains holdout identifier ${pdbId}`);
  const forbiddenKeys = new Set(['coordinates', 'coordinatesAngstrom', 'directCoordinates',
    'pdbText', 'molBlock', 'internalCallback', 'privateRoute']);
  const visit = (value, path = 'script') => {
    if (Array.isArray(value)) return value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) throw new Error(`${path}.${key} embeds coordinates or a private shortcut`);
      visit(entry, `${path}.${key}`);
    }
  };
  visit(script);
}

/**
 * Verify the immutable pre-freeze evidence and the independent post-freeze
 * acceptance verdict before a run may feed any public replay or movie asset.
 */
export async function verifyAcceptedSos1Run(runDirectory) {
  const directory = resolve(runDirectory);
  const [manifestBytes, evaluationBytes, auditBytes] = await Promise.all([
    readFile(join(directory, 'prediction-manifest.json')),
    readFile(join(directory, 'holdout-evaluation-summary.json')),
    readFile(join(directory, 'chemist-action-audit.json')),
  ]);
  const manifest = JSON.parse(manifestBytes);
  const evaluation = JSON.parse(evaluationBytes);
  const audit = JSON.parse(auditBytes);
  assert.equal(manifest.schema, 'molarium.design-prediction-run/v1');
  assert.equal(manifest.routeId, SOS1_ROUTE_ID);
  assert.equal(manifest.status, 'predictions-frozen-holdouts-unopened');
  assert.equal(manifest.publicationEligible, true,
    'SOS1 run is explicitly non-promotable');
  assert.equal(manifest.protocol?.phe890Branching?.diagnosticOnly, false,
    'SOS1 run uses a diagnostic-only Phe890 selector');
  assert.equal(manifest.protocol?.phe890Branching?.diagnosticExactCoordinateSha256, null,
    'SOS1 run pins a diagnostic Phe890 coordinate');
  assert.equal(manifest.protocol?.initialCoordinateInput, 'PDB 5OVE/AXE only');
  assert.equal(manifest.protocol?.sequentialPredictedReferences, true);
  assert.equal(manifest.agentApi?.auditSha256, sha256(auditBytes),
    'Chemist Actions audit changed after prediction freeze');
  assert.equal(manifest.agentApi?.auditRecords, audit.records?.length,
    'Chemist Actions audit record count changed');
  assert.equal(evaluation.schema, 'molarium.design-prediction-holdout-evaluation-summary/v2');
  assert.equal(evaluation.routeId, SOS1_ROUTE_ID);
  assert.equal(evaluation.predictionManifestSha256, sha256(manifestBytes),
    'holdout evaluation does not belong to this prediction manifest');
  assert.equal(evaluation.holdoutsOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified, true);
  assert.equal(evaluation.accepted, true,
    'SOS1 run was not accepted by the independent holdout evaluation');
  assert.equal(evaluation.continuity?.accepted, true,
    'AWW-to-AXH continuity was not accepted');
  assert.deepEqual(evaluation.results?.map((entry) => entry.stepId), SOS1_STEP_IDS,
    'holdout evaluation is not the complete SOS1 route');
  assert(evaluation.results.every((entry) => entry.accepted === true
    && Array.isArray(entry.failedChecks) && entry.failedChecks.length === 0),
  'one or more SOS1 holdout evaluations failed');
  assert.deepEqual(manifest.checkpoints?.map((entry) => entry.stepId), SOS1_STEP_IDS,
    'prediction manifest is not the complete SOS1 route');

  const checkpoints = new Map();
  for (const entry of manifest.checkpoints) {
    assert(Number.isInteger(entry.freezeActionSequence) && entry.freezeActionSequence > 0,
      `${entry.stepId}: prediction manifest has no freeze action sequence`);
    const freezeRecord = audit.records?.find((record) =>
      record.sequence === entry.freezeActionSequence);
    assert(freezeRecord && freezeRecord.status === 'completed'
      && freezeRecord.action === 'session.inspect'
      && freezeRecord.args?.scope === 'pocket'
      && freezeRecord.args?.includeCoordinates === true,
    `${entry.stepId}: freeze action is not the completed coordinate-bearing pocket inspection`);
    const bytes = await readFile(join(directory, entry.filename));
    assert.equal(sha256(bytes), entry.sha256, `${entry.stepId}: frozen checkpoint changed`);
    const checkpoint = JSON.parse(bytes);
    assert.equal(checkpoint.stepId, entry.stepId);
    assert.equal(checkpoint.frozenBeforeHoldoutAccess, true);
    assertAcceptedCheckpointRelaxation(checkpoint, entry.stepId);
    assertNoHoldoutCoordinatePayload(checkpoint, `${entry.stepId} checkpoint`);
    checkpoints.set(entry.stepId, { entry, checkpoint, bytes });
  }
  const branchDecision = checkpoints.get('open-phe890-pocket')?.checkpoint?.rotamerDecision;
  assert.equal(branchDecision?.publicationEligible, true,
    'Phe890 branch decision is explicitly non-promotable');
  assert.equal(branchDecision?.diagnosticOnly, false,
    'diagnostic-only Phe890 branch cannot feed publication assets');
  assert.equal(branchDecision?.deterministicFinalReplayVerified, true,
    'Phe890 branch decision lacks deterministic final replay verification');
  return Object.freeze({ directory, runId:basename(directory), manifest, manifestBytes,
    evaluation, evaluationBytes, audit, auditBytes, checkpoints });
}

function selectedRouteRecord(record) {
  if (record?.status !== 'completed') return false;
  const requestId = String(record.requestId || '');
  if (record.action === 'designRoute.inspect') return false;
  if (record.action === 'session.inspect') return requestId.endsWith('-freeze-pocket');
  if (!requestId.startsWith('open-phe890-pocket-')) return true;
  if (/-branch-\d+(?:-|$)/.test(requestId)) return false;
  if (/-enumerate-phe890-(?:initial|branch-\d+)$/.test(requestId)) return false;
  return !requestId.endsWith('-locate-phe890');
}

function captionForRecord(record) {
  const id = String(record.requestId || '');
  const captions = [
    [/route-load-hit$/, 'Begin with the only allowed coordinates: the 5OVE/AXE hit'],
    [/route-enter-build$/, 'Enter Design to make the first prospective decision'],
    [/route-prepare-hit$/, 'Prepare the experimental hit complex locally'],
    [/route-capture-hit$/, 'Capture the hit pose and pocket as the first design reference'],
    [/scaffold-rewrite-stage$/, 'Rewrite the hit scaffold to make compound 17'],
    [/fragment-merge-stage$/, 'Merge the larger fragment idea to make compound 18'],
    [/open-phe890-pocket-stage$/, 'Grow compound 21 into the Phe890-in volume'],
    [/enumerate-phe890-final$/, 'Enumerate the complete Phe890 chi1/chi2 rotamer set'],
    [/apply-selected-phe890-branch$/, 'Choose the predicted Phe890-out branch'],
    [/accept-selected-receptor-branch$/, 'Use the selected open pocket as the receptor reference'],
    [/pose-selected-phe890-branch$/, 'Search ligand poses against the selected Phe890-out pocket'],
    [/apply-selected-phe890-pose$/, 'Apply the coupled ligand–pocket solution'],
    [/finish-bay-293-stage$/, 'Construct the final BAY-293 graph from compound 21'],
    [/-pose-refine$/, 'Search the registered ligand pose ensemble'],
    [/-pose-apply$/, 'Apply the highest-ranked feasible pose'],
    [/-parameterize(?:-without-motion)?$/, 'Parameterize the selected ligand–pocket state'],
    [/-complex-relax$/, 'Relax the ligand and pocket together'],
    [/-advance-build$/, 'Return to Design with the accepted prediction'],
    [/-capture-predicted-reference$/, 'Capture this prediction as the next design reference'],
  ];
  return captions.find(([pattern]) => pattern.test(id))?.[1]
    || id.replaceAll('-', ' ').replace(/^\w/, (value) => value.toUpperCase());
}

/** Build the calculation-bearing, selected-route replay from a verified run audit. */
export async function buildAcceptedSos1ReplayScript(verified) {
  const records = verified.audit.records || [];
  const selected = records.filter(selectedRouteRecord);
  const sequences = selected.map((record) => record.sequence);
  const captionsBySequence = Object.fromEntries(selected.map((record) =>
    [record.sequence, captionForRecord(record)]));
  const script = actionScriptFromAudit(verified.audit, {
    label:`SOS1 hit-to-BAY-293 accepted run ${verified.runId}`,
    includeReadOnly:true,
    includeSequences:sequences,
    captionsBySequence,
    includeAuditMetadata:true,
    stateHashGuards:'required',
    provenance:{ runId:verified.runId,
      predictionManifestSha256:sha256(verified.manifestBytes),
      evaluationSummarySha256:sha256(verified.evaluationBytes),
      sourceAuditSha256:sha256(verified.auditBytes),
      sourceAuditRecords:records.length,
      checkpoints:SOS1_STEP_IDS.map((stepId) => ({ stepId,
        sha256:verified.checkpoints.get(stepId).entry.sha256 })),
      accepted:true },
  });
  validateActionScript(script);
  assertReplayContainsNoCoordinatesOrHoldouts(script);
  assert.deepEqual(script.actions.filter((step) => step.action === 'designRoute.applyStep')
    .map((step) => step.args.stepId), SOS1_STEP_IDS);
  assert.equal(script.actions.filter((step) => step.action === 'pose.applySidechainRotamer').length,
    1, 'selected-route replay must apply exactly one Phe890 rotamer');
  assert(script.actions.every((step) => !step.action.startsWith('designerScript.')
    && step.action !== 'interface.presentDesignerStep'));
  assert.equal(script.sourceAudit?.stateHashGuards?.mode, 'required',
    'accepted publication replay must require molecular-state guards');
  return Object.freeze({ script, actionScriptSha256:await actionScriptSha256(script),
    sourceAuditSha256:sha256(verified.auditBytes), sourceAuditRecords:records.length,
    selectedAuditSequences:sequences });
}
