import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { actionScriptFromAudit, actionScriptSha256,
  validateActionScript } from '../design-history/replay.mjs';
import { verifyCampaign } from '../design-history/ledger.mjs';
import { deserializeCampaign, serializeCampaign } from
  '../design-history/live-campaign-store.mjs';

export const SOS1_ROUTE_ID = 'sos1-hit-only';
export const SOS1_STEP_IDS = Object.freeze([
  'scaffold-rewrite', 'fragment-merge', 'open-phe890-pocket', 'finish-bay-293',
]);
export const SOS1_INTERMEDIATE_CHECKPOINT_IDS = Object.freeze([
  'compound-21-graph-edit-before-phe890-rotamer',
  'phe890-rotamer-before-coupled-relaxation',
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
  const graph = checkpoint?.staging?.productHeavyGraph;
  assert(graph && graph.atomCount === graph.atoms?.length
    && graph.bondCount === graph.bonds?.length && graph.bondCount > 0,
  `${label}: exact staged product graph evidence is incomplete`);
  const safeguard = checkpoint.relaxation.valenceSafeguard;
  assert(safeguard?.schema === 'molarium.ligand-valence-safeguard/v1'
    && safeguard.accepted === true && safeguard.complete === true
    && safeguard.checkedHeavyBonds === graph.bondCount
    && safeguard.expectedHeavyBonds === graph.bondCount
    && safeguard.bondMeasurements?.length === graph.bondCount
    && safeguard.bondMeasurements.every((bond) => bond.accepted === true)
    && safeguard.violations?.length === 0,
  `${label}: complete accepted heavy-bond safeguard evidence is missing`);
  const ligandAtoms = (checkpoint?.ligand?.atoms || []).filter((atom) => atom.element !== 'H');
  const ligandById = new Map((checkpoint?.ligand?.atoms || []).map((atom) => [atom.atomId, atom]));
  const actualAtoms = ligandAtoms.map((atom) => ({ atomName:atom.atomName,
    element:atom.element, formalCharge:atom.formalCharge,
    aromatic:Boolean(atom.aromatic) }))
    .sort((first, second) => first.atomName.localeCompare(second.atomName));
  const actualBonds = (checkpoint?.ligand?.bonds || []).flatMap((bond) => {
    const first = ligandById.get(bond.atomIds?.[0]), second = ligandById.get(bond.atomIds?.[1]);
    if (!first || !second || first.element === 'H' || second.element === 'H') return [];
    return [{ atomNames:[first.atomName, second.atomName].sort(),
      order:Number(bond.order || 1), aromatic:Boolean(bond.aromatic) }];
  }).sort((first, second) => first.atomNames.join('\0').localeCompare(
    second.atomNames.join('\0')));
  assert.equal(ligandAtoms.length, graph.atomCount,
    `${label}: inspected ligand heavy-atom count differs from staged product`);
  assert.deepEqual(actualAtoms, graph.atoms,
    `${label}: inspected ligand atom graph differs from staged product`);
  assert.deepEqual(actualBonds, graph.bonds,
    `${label}: inspected ligand bond graph differs from staged product`);
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
  assert.equal(retention?.before?.active, true,
    `${label}: registered pose retention was inactive before relaxation`);
  assert.equal(retention?.before?.accepted, true,
    `${label}: registered pose feature exceeded tolerance before relaxation`);
  assert.equal(retention?.after?.active, true,
    `${label}: registered pose retention was inactive after relaxation`);
  assert.equal(retention?.after?.accepted, true,
    `${label}: post-relax registered pose feature exceeds tolerance`);
  for (const [phase, evidence] of [['before', retention.before],
    ['after', retention.after]]) {
    assert(Number.isFinite(evidence.hardAnchor?.rmsdAngstrom)
      && Number.isFinite(evidence.hardAnchor?.maxDisplacementAngstrom)
      && Array.isArray(evidence.fixedCoordinatesAngstrom?.atomIds)
      && Array.isArray(evidence.fixedCoordinatesAngstrom?.positions),
    `${label}: registered hard-anchor evidence is incomplete ${phase} coupled relaxation`);
  }
  assert.deepEqual(retention.before.fixedAtomIds, retention.after.fixedAtomIds,
    `${label}: registered retained atom identities changed during relaxation`);
  assert(retention.fixedAtomMotion?.accepted === true
    && Number.isFinite(retention.fixedAtomMotion.rmsdAngstrom)
    && Number.isFinite(retention.fixedAtomMotion.maximumDisplacementAngstrom)
    && Number.isFinite(retention.fixedAtomMotion.maximumFloat32RoundTripResidualAngstrom)
    && retention.fixedAtomMotion.maximumFloat32RoundTripResidualAngstrom
      <= retention.fixedAtomMotion.toleranceAngstrom,
  `${label}: registered fixed atoms moved during coupled relaxation`);
  assert.equal(new Set(retention.before.fixedAtomIds || []).size,
    retention.before.fixedAtomIds?.length,
  `${label}: pre-relax retained atom identities are duplicated`);
  assert.equal(retention.after.features?.length, requiredFeatures.length,
    `${label}: post-relax registered feature count is not exact`);
  assert.equal(retention.before.features?.length, requiredFeatures.length,
    `${label}: pre-relax registered feature count is not exact`);
  for (const required of requiredFeatures) {
    assert(Array.isArray(required.mappingVariants) && required.mappingVariants.length,
      `${label}: ${required.id} registered symmetry maps are unavailable`);
    const pairCount = required.mappingVariants[0]?.referenceAtomNames?.length;
    assert(Number.isInteger(pairCount) && pairCount >= 3,
      `${label}: ${required.id} registered feature atom coverage is incomplete`);
    const measuredByPhase = [retention.before, retention.after].map((evidence) => {
      const matches = (evidence.features || []).filter((feature) =>
        feature.id === required.id
        && feature.registeredIntentId === required.registeredIntentId);
      assert.equal(matches.length, 1,
        `${label}: required registered pose feature is missing or ambiguous`);
      const measured = matches[0];
      for (const key of ['rmsdAngstrom','centroidDisplacementAngstrom',
        'planeNormalAngleDegrees'])
        assert(Number.isFinite(measured[key]), `${label}: ${required.id} lacks ${key}`);
      assert.equal(measured.toleranceAngstrom,
        required.restraint?.toleranceAngstrom,
      `${label}: ${required.id} registered tolerance changed`);
      assert.equal(measured.symmetryVariantCount, required.mappingVariants.length,
        `${label}: ${required.id} symmetry coverage changed`);
      assert.equal(measured.productAtomIds?.length, pairCount,
        `${label}: ${required.id} retained atom coverage changed`);
      assert.equal(new Set(measured.productAtomIds || []).size, pairCount,
        `${label}: ${required.id} retained atom identities are duplicated`);
      assert(measured.accepted === true
        && measured.rmsdAngstrom <= measured.toleranceAngstrom,
      `${label}: ${required.id} moved outside its registered tolerance`);
      return measured;
    });
    assert.deepEqual(measuredByPhase[0].productAtomIds, measuredByPhase[1].productAtomIds,
      `${label}: ${required.id} retained atom identities changed during relaxation`);
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

async function verifiedFullSystemCampaign(directory, campaignRecord, label) {
  assert(campaignRecord && campaignRecord.schema === 'molarium.full-system-checkpoint/v1',
    `${label}: exact full-system campaign record is missing`);
  if (SOS1_INTERMEDIATE_CHECKPOINT_IDS.includes(campaignRecord.stageId))
    assert.equal(campaignRecord.frozenBeforeHoldoutAccess, true,
      `${label}: intermediate campaign was not frozen before holdout access`);
  assert.equal(basename(campaignRecord.filename), campaignRecord.filename,
    `${label}: full-system campaign filename is not local to the run`);
  const campaignBytes = await readFile(join(directory, campaignRecord.filename));
  assert.equal(campaignBytes.length, campaignRecord.bytes,
    `${label}: full-system campaign byte count changed`);
  assert.equal(sha256(campaignBytes), campaignRecord.sha256,
    `${label}: full-system campaign changed`);
  const serializedCampaign = campaignBytes.toString('utf8');
  const campaign = deserializeCampaign(serializedCampaign);
  assert.equal(serializeCampaign(campaign), serializedCampaign,
    `${label}: full-system campaign is not canonically serialized`);
  const campaignVerification = await verifyCampaign(campaign);
  assert.equal(campaignVerification.valid, true,
    `${label}: full-system campaign is invalid: ${campaignVerification.reason}`);
  assert.equal(campaign.campaignId, campaignRecord.campaignId,
    `${label}: full-system campaign ID changed`);
  assert.equal(campaign.branches?.[campaignRecord.branch], campaignRecord.commitId,
    `${label}: full-system campaign branch head changed`);
  assert.equal(campaign.objects?.commits?.[campaignRecord.commitId]?.snapshotId,
    campaignRecord.snapshotId,
    `${label}: full-system campaign commit does not select its frozen snapshot`);
  assert(campaign.objects?.snapshots?.[campaignRecord.snapshotId],
    `${label}: full-system campaign snapshot is missing`);
  assertNoHoldoutCoordinatePayload(campaign, `${label} full-system campaign`);
  return { record:campaignRecord, campaign, campaignBytes, serializedCampaign };
}

/**
 * Verify the immutable pre-freeze evidence and the independent post-freeze
 * acceptance verdict before a run may feed any public replay or movie asset.
 */
export async function verifyCompleteFrozenSos1Run(runDirectory) {
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
  const retry = manifest.retryProvenance;
  if (retry != null) {
    assert.equal(retry.schema, 'molarium.sos1-recovered-run-assembly/v1');
    assert.equal(audit.retryProvenance?.schema, retry.schema,
      'recovery provenance differs between manifest and audit');
    assert.deepEqual(audit.retryProvenance, retry,
      'recovery provenance differs between manifest and audit');
    assert.equal(audit.replaySelection?.maximumSequence, 251,
      'recovered replay boundary must select the original 251-action attempt');
    assert.equal(audit.replaySelection?.sourceAttemptId, retry.original?.attemptId);
    assert.equal(audit.replaySelection?.excludedRecoveryAttemptId,
      retry.recovery?.attemptId);
    for (const field of ['failedRunSha256','auditSha256'])
      assert(/^[a-f0-9]{64}$/.test(retry.original?.[field] || ''),
        `recovery provenance original.${field} is invalid`);
    for (const field of ['resultSha256','auditSha256','campaignSha256'])
      assert(/^[a-f0-9]{64}$/.test(retry.recovery?.[field] || ''),
        `recovery provenance recovery.${field} is invalid`);
    assert(audit.records.slice(251).length > 0
      && audit.records.slice(251).every((record) =>
        record.retryProvenance?.publicationReplay === false
        && record.retryProvenance?.attemptId === retry.recovery.attemptId),
    'one or more recovery actions can leak into the executable publication replay');
    const expectedRecoveryActions = [
      ['captureActionSequence','pose.captureReference'],
      ['stageActionSequence','designRoute.applyStep'],
      ['freezeActionSequence','session.inspect'],
      ['commitActionSequence','campaign.commitCurrent'],
      ['exportActionSequence','campaign.export'],
    ];
    for (const [field, action] of expectedRecoveryActions) {
      const sequence = retry.finalStepAudit?.[field];
      const record = audit.records.find((entry) => entry.sequence === sequence);
      assert(record?.status === 'completed' && record.action === action
        && record.retryProvenance?.publicationReplay === false,
      `recovery provenance ${field} does not identify its completed recovery action`);
    }
  }
  assert.equal(evaluation.schema, 'molarium.design-prediction-holdout-evaluation-summary/v2');
  assert.equal(evaluation.routeId, SOS1_ROUTE_ID);
  assert.equal(evaluation.predictionManifestSha256, sha256(manifestBytes),
    'holdout evaluation does not belong to this prediction manifest');
  assert.equal(evaluation.holdoutsOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified, true);
  assert.deepEqual(evaluation.results?.map((entry) => entry.stepId), SOS1_STEP_IDS,
    'holdout evaluation is not the complete SOS1 route');
  assert(evaluation.results.every((entry) => typeof entry.accepted === 'boolean'
    && Array.isArray(entry.failedChecks)),
  'one or more SOS1 holdout evaluation records are incomplete');
  assert.deepEqual(manifest.checkpoints?.map((entry) => entry.stepId), SOS1_STEP_IDS,
    'prediction manifest is not the complete SOS1 route');
  const intermediateCheckpointIds = manifest.intermediateFullSystemCheckpoints || [];
  assert(Array.isArray(intermediateCheckpointIds),
    'intermediateFullSystemCheckpoints must be an ordered array');
  if (intermediateCheckpointIds.length)
    assert.deepEqual(intermediateCheckpointIds, SOS1_INTERMEDIATE_CHECKPOINT_IDS,
      'production intermediate full-system checkpoint contract changed');

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
    if (entry.stepId === 'finish-bay-293' && manifest.retryProvenance)
      assert.equal(entry.freezeActionSequence,
        manifest.retryProvenance.finalStepAudit.freezeActionSequence,
      'final checkpoint freeze does not point to the recovery audit evidence');
    const bytes = await readFile(join(directory, entry.filename));
    assert.equal(sha256(bytes), entry.sha256, `${entry.stepId}: frozen checkpoint changed`);
    const checkpoint = JSON.parse(bytes);
    assert.equal(checkpoint.stepId, entry.stepId);
    assert.equal(checkpoint.frozenBeforeHoldoutAccess, true);
    assertAcceptedCheckpointRelaxation(checkpoint, entry.stepId);
    assertNoHoldoutCoordinatePayload(checkpoint, `${entry.stepId} checkpoint`);
    const campaignRecord = checkpoint.fullSystemCampaign;
    assert.deepEqual(entry.fullSystemCampaign, campaignRecord,
      `${entry.stepId}: manifest and checkpoint full-system campaign records differ`);
    const fullSystemCampaign = await verifiedFullSystemCampaign(directory,
      campaignRecord, entry.stepId);
    const intermediateRecords = checkpoint.intermediateFullSystemCampaigns || [];
    assert.deepEqual(entry.intermediateFullSystemCampaigns || [], intermediateRecords,
      `${entry.stepId}: manifest and checkpoint intermediate campaigns differ`);
    if (entry.stepId === 'open-phe890-pocket' && intermediateCheckpointIds.length)
      assert.deepEqual(intermediateRecords.map((record) => record.stageId),
        intermediateCheckpointIds,
      `${entry.stepId}: exact intermediate campaign order changed`);
    else assert.equal(intermediateRecords.length, 0,
      `${entry.stepId}: undeclared intermediate full-system campaigns are present`);
    const intermediateFullSystemCampaigns = [];
    for (const record of intermediateRecords) {
      assert.equal(record.frozenBeforeHoldoutAccess, true,
        `${record.stageId}: intermediate campaign was not frozen prospectively`);
      intermediateFullSystemCampaigns.push(await verifiedFullSystemCampaign(directory,
        record, record.stageId));
    }
    checkpoints.set(entry.stepId, { entry, checkpoint, bytes,
      fullSystemCampaign, intermediateFullSystemCampaigns });
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

/** Apply the independent post-freeze acceptance gate without changing the
 * complete-frozen-run verifier used by explicitly prediction-only publishing. */
export async function verifyAcceptedSos1Run(runDirectory) {
  const verified = await verifyCompleteFrozenSos1Run(runDirectory);
  assert.equal(verified.evaluation.accepted, true,
    'SOS1 run was not accepted by the independent holdout evaluation');
  assert.equal(verified.evaluation.continuity?.accepted, true,
    'AWW-to-AXH continuity was not accepted');
  assert(verified.evaluation.results.every((entry) => entry.accepted === true
    && entry.failedChecks.length === 0),
  'one or more SOS1 holdout evaluations failed');
  return verified;
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

function publicationReplayRecords(audit) {
  const maximum = audit.replaySelection?.maximumSequence;
  const candidates = Number.isInteger(maximum)
    ? audit.records.filter((record) => record.sequence <= maximum) : audit.records;
  assert(candidates.every((record) => record.retryProvenance?.publicationReplay !== false),
    'executable replay selection includes a non-replay recovery action');
  const selected = candidates.filter(selectedRouteRecord);
  let presentedMode = null;
  return selected.filter((record) => {
    if (record.action !== 'view.setMode') return true;
    const mode = String(record.args?.mode || '');
    if (mode === presentedMode) return false;
    presentedMode = mode;
    return true;
  });
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
  const selected = publicationReplayRecords(verified.audit);
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

/** Build a calculation-bearing, cross-platform recomputation without implying
 * that the separately attached post-freeze holdout evaluation passed.  Exact
 * coordinate hashes belong to the separate checkpoint-review route: here the
 * registered route guards graph/identity and discrete scientific expectations
 * guard feasibility, feature coverage, valence and pose retention. */
export async function buildFrozenSos1ReplayScript(verified) {
  const records = verified.audit.records || [];
  const selected = publicationReplayRecords(verified.audit);
  const sequences = selected.map((record) => record.sequence);
  const captionsBySequence = Object.fromEntries(selected.map((record) =>
    [record.sequence, captionForRecord(record)]));
  const script = actionScriptFromAudit(verified.audit, {
    label:`SOS1 hit-to-BAY-293 prediction replay ${verified.runId}`,
    includeReadOnly:true,
    includeSequences:sequences,
    captionsBySequence,
    includeAuditMetadata:true,
    stateHashGuards:'off',
    executionContract:'portable-scientific',
    provenance:{ runId:verified.runId,
      publicationClass:'complete-frozen-prediction',
      predictionManifestSha256:sha256(verified.manifestBytes),
      sourceAuditSha256:sha256(verified.auditBytes),
      sourceAuditRecords:records.length,
      checkpoints:SOS1_STEP_IDS.map((stepId) => ({ stepId,
        sha256:verified.checkpoints.get(stepId).entry.sha256 })),
      postFreezeEvaluation:{ attached:true,
        summarySha256:sha256(verified.evaluationBytes),
        accepted:verified.evaluation.accepted === true,
        continuityAccepted:verified.evaluation.continuity?.accepted === true,
        failedStepIds:verified.evaluation.results
          .filter((entry) => entry.accepted !== true).map((entry) => entry.stepId) } },
  });
  validateActionScript(script);
  assertReplayContainsNoCoordinatesOrHoldouts(script);
  assert.deepEqual(script.actions.filter((step) => step.action === 'designRoute.applyStep')
    .map((step) => step.args.stepId), SOS1_STEP_IDS);
  assert.equal(script.actions.filter((step) => step.action === 'pose.applySidechainRotamer').length,
    1, 'prediction replay must apply exactly one Phe890 rotamer');
  assert(script.actions.every((step) => !step.action.startsWith('designerScript.')
    && step.action !== 'interface.presentDesignerStep'));
  assert.equal(script.sourceAudit?.stateHashGuards?.mode, 'off',
    'cross-platform prediction recomputation must not require exact coordinate hashes');
  assert.equal(script.sourceAudit?.executionContract?.mode, 'portable-scientific',
    'prediction replay must guard discrete scientific outcomes');
  assert(script.sourceAudit.executionContract.portableScientificGuardCount > 0,
    'prediction replay must contain portable scientific result guards');
  return Object.freeze({ script, actionScriptSha256:await actionScriptSha256(script),
    sourceAuditSha256:sha256(verified.auditBytes), sourceAuditRecords:records.length,
    selectedAuditSequences:sequences });
}
