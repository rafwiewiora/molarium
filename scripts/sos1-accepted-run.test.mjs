import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MOLECULAR_STATE_HASH_SCHEMA } from '../molecular-state-hash.mjs';
import { commitMolecule, createCampaign, storeSnapshot } from '../design-history/ledger.mjs';
import { serializeCampaign } from '../design-history/live-campaign-store.mjs';
import { assertAcceptedCheckpointRelaxation, buildAcceptedSos1ReplayScript,
  buildFrozenSos1ReplayScript, requireExplicitRunDirectory, sha256,
  verifyAcceptedSos1Run, verifyCompleteFrozenSos1Run } from './sos1-accepted-run.mjs';
import { buildFrozenBrowserPublicationRecords } from
  './publish-sos1-frozen-browser-replays.mjs';

assert.throws(() => requireExplicitRunDirectory([]), /--run is required/);

const productHeavyGraph = { atomCount:2, bondCount:1,
  atoms:[
    { atomName:'C1', element:'C', formalCharge:0, aromatic:false },
    { atomName:'N1', element:'N', formalCharge:0, aromatic:false },
  ], bonds:[{ atomNames:['C1','N1'], order:1, aromatic:false }] };
const valenceSafeguard = { schema:'molarium.ligand-valence-safeguard/v1',
  accepted:true, complete:true, checkedHeavyBonds:1, expectedHeavyBonds:1,
  bondMeasurements:[{ atomNames:['C1','N1'], accepted:true }], violations:[] };
const inspectedLigand = { atoms:[
  { atomId:'a1', atomName:'C1', element:'C', formalCharge:0, aromatic:false,
    coordinatesAngstrom:[0,0,0] },
  { atomId:'a2', atomName:'N1', element:'N', formalCharge:0, aromatic:false,
    coordinatesAngstrom:[1.4,0,0] },
], bonds:[{ atomIds:['a1','a2'], order:1, aromatic:false }] };

const retainedCheckpoint = {
  stepId:'finish-bay-293',
  sidechainContinuity:{ residue:'PHE A890', accepted:true,
    finalChiDegrees:[-170, 95] },
  staging:{ productHeavyGraph, poseTransferPlan:{ featureCorrespondences:[{
    id:'terminal', registeredIntentId:'retain-terminal', required:true,
    restraint:{ toleranceAngstrom:1.5 },
    mappingVariants:[
      { referenceAtomNames:['R1','R2','R3'], productAtomIndices:[0,1,2] },
      { referenceAtomNames:['R1','R2','R3'], productAtomIndices:[2,1,0] },
    ],
  }] } },
  ligand:inspectedLigand,
  relaxation:{ accepted:true, valenceSafeguard,
    registeredPoseRetention:{ accepted:true,
    fixedAtomMotion:{ accepted:true, toleranceAngstrom:1e-6,
      atomIds:['hard-1','p-1','p-2','p-3'], atomCount:4,
      rmsdAngstrom:2e-7, maximumDisplacementAngstrom:4e-7,
      maximumFloat32RoundTripResidualAngstrom:2e-7 },
    before:{ active:true, accepted:true, fixedAtomIds:['hard-1','p-1','p-2','p-3'],
      fixedCoordinatesAngstrom:{ atomIds:['hard-1','p-1','p-2','p-3'],
        positions:[[0.1,0,0],[1,0,0],[2,0,0],[3,0,0]] },
      hardAnchor:{ rmsdAngstrom:0.1, maxDisplacementAngstrom:0.1 },
      features:[{ id:'terminal', registeredIntentId:'retain-terminal', accepted:true,
        productAtomIds:['p-1','p-2','p-3'], symmetryVariantCount:2,
        rmsdAngstrom:0.2, centroidDisplacementAngstrom:0.1,
        planeNormalAngleDegrees:2, toleranceAngstrom:1.5 }] },
    after:{ active:true, accepted:true, fixedAtomIds:['hard-1','p-1','p-2','p-3'],
      fixedCoordinatesAngstrom:{ atomIds:['hard-1','p-1','p-2','p-3'],
        positions:[[0.1,0,0],[1,0,0],[2,0,0],[3,0,0]] },
      hardAnchor:{ rmsdAngstrom:0.1, maxDisplacementAngstrom:0.1 },
      features:[{ id:'terminal', registeredIntentId:'retain-terminal', accepted:true,
        productAtomIds:['p-1','p-2','p-3'], symmetryVariantCount:2,
        rmsdAngstrom:0.2, centroidDisplacementAngstrom:0.1,
        planeNormalAngleDegrees:2, toleranceAngstrom:1.5 }] },
  } },
};
assert.doesNotThrow(() => assertAcceptedCheckpointRelaxation(retainedCheckpoint));
const missingValenceEvidence = structuredClone(retainedCheckpoint);
delete missingValenceEvidence.relaxation.valenceSafeguard;
assert.throws(() => assertAcceptedCheckpointRelaxation(missingValenceEvidence),
  /heavy-bond safeguard evidence is missing/);
const wrongProductGraph = structuredClone(retainedCheckpoint);
wrongProductGraph.ligand.bonds[0].order = 2;
assert.throws(() => assertAcceptedCheckpointRelaxation(wrongProductGraph),
  /bond graph differs from staged product/);
const ambiguousRetention = structuredClone(retainedCheckpoint);
ambiguousRetention.relaxation.registeredPoseRetention.after.features.push(
  structuredClone(ambiguousRetention.relaxation.registeredPoseRetention.after.features[0]));
assert.throws(() => assertAcceptedCheckpointRelaxation(ambiguousRetention),
  /feature count is not exact/);
const inactiveRetention = structuredClone(retainedCheckpoint);
inactiveRetention.relaxation.registeredPoseRetention.after.active = false;
assert.throws(() => assertAcceptedCheckpointRelaxation(inactiveRetention),
  /was inactive/);
const missingBeforeRetention = structuredClone(retainedCheckpoint);
delete missingBeforeRetention.relaxation.registeredPoseRetention.before;
assert.throws(() => assertAcceptedCheckpointRelaxation(missingBeforeRetention),
  /inactive before relaxation/);
const changedRetainedAtoms = structuredClone(retainedCheckpoint);
changedRetainedAtoms.relaxation.registeredPoseRetention.after.features[0]
  .productAtomIds[2] = 'p-4';
assert.throws(() => assertAcceptedCheckpointRelaxation(changedRetainedAtoms),
  /atom identities changed/);
const movedFixedAtom = structuredClone(retainedCheckpoint);
movedFixedAtom.relaxation.registeredPoseRetention.fixedAtomMotion.accepted = false;
movedFixedAtom.relaxation.registeredPoseRetention.fixedAtomMotion
  .maximumDisplacementAngstrom = 0.001;
assert.throws(() => assertAcceptedCheckpointRelaxation(movedFixedAtom),
  /fixed atoms moved/);
const lostSymmetryCoverage = structuredClone(retainedCheckpoint);
lostSymmetryCoverage.relaxation.registeredPoseRetention.before.features[0]
  .symmetryVariantCount = 1;
assert.throws(() => assertAcceptedCheckpointRelaxation(lostSymmetryCoverage),
  /symmetry coverage changed/);

const scratch = await mkdtemp(join(tmpdir(), 'molarium-accepted-sos1-'));
const steps = ['scaffold-rewrite', 'fragment-merge', 'open-phe890-pocket', 'finish-bay-293'];
try {
  const records = [];
  const guardedResult = (requestId, action) => {
    const digest = (role) => sha256(Buffer.from(`${requestId}:${role}`));
    const common = { stateHashSchema:MOLECULAR_STATE_HASH_SCHEMA,
      inputStateSha256:digest('input') };
    if (action === 'pose.refine') return { refinement:{ ...common,
      selectedStateSha256:digest('selected') } };
    if (action === 'pose.apply') return { appliedPose:{ ...common,
      selectedStateSha256:digest('selected'), outputStateSha256:digest('output') } };
    if (action === 'optimization.run') return { optimization:{ ...common,
      accepted:true, outputStateSha256:digest('output') } };
    return undefined;
  };
  const push = (requestId, action, args = {}) => {
    const record = { sequence:records.length + 1, schema:'molarium.chemist-actions/v1', requestId,
      action, args, status:'completed' };
    const result = guardedResult(requestId, action);
    if (result) record.result = result;
    records.push(record);
    return record;
  };
  push('route-load-hit', 'designRoute.load', { routeId:'sos1-hit-only' });
  push('route-enter-build', 'view.setMode', { mode:'build' });
  push('route-prepare-hit', 'protein.prepare', { pH:7.4, histidine:'auto',
    repairMissingHeavy:true, ligandPolicy:'ccd', waterPolicy:'retain', gapPolicy:'cap' });
  push('route-capture-hit', 'pose.captureReference', { mode:'propagate' });
  const freezeSequences = new Map();
  for (const stepId of steps) {
    push(`${stepId}-stage`, 'designRoute.applyStep', { stepId });
    if (stepId === 'open-phe890-pocket') {
      push(`${stepId}-enumerate-phe890-initial`, 'pose.enumerateSidechainRotamers',
        { receptorAtomId:'receptor:PHE:890:CG', maximumCandidates:32 });
      push(`${stepId}-apply-phe890-branch-1`, 'pose.applySidechainRotamer',
        { coordinateSha256:'discarded' });
      push(`${stepId}-undo-branch-1-rotamer`, 'history.undo', {});
      push(`${stepId}-enumerate-phe890-final`, 'pose.enumerateSidechainRotamers',
        { receptorAtomId:'receptor:PHE:890:CG', maximumCandidates:32 });
      push(`${stepId}-apply-selected-phe890-branch`, 'pose.applySidechainRotamer',
        { coordinateSha256:'selected' });
      push(`${stepId}-accept-selected-receptor-branch`, 'pose.updateReceptorReference', {});
      push(`${stepId}-pose-selected-phe890-branch`, 'pose.refine',
        { searchChains:8, execution:'serial', featureSeedingProtocol:'v5' });
      push(`${stepId}-apply-selected-phe890-pose`, 'pose.apply', { index:0 });
    } else {
      push(`${stepId}-pose-refine`, 'pose.refine',
        { searchChains:8, execution:'serial', featureSeedingProtocol:'v5' });
      push(`${stepId}-pose-apply`, 'pose.apply', { index:0 });
    }
    push(`${stepId}-parameterize-without-motion`, 'protein.parameterize', {});
    push(`${stepId}-complex-relax`, 'optimization.run', { method:'induced-fit-webgpu' });
    push(`${stepId}-freeze-ligand`, 'session.inspect',
      { scope:'ligand', includeCoordinates:true, maximumAtoms:256 });
    freezeSequences.set(stepId, push(`${stepId}-freeze-pocket`, 'session.inspect',
      { scope:'pocket', includeCoordinates:true, maximumAtoms:500 }).sequence);
  }
  const audit = { schema:'molarium.chemist-actions/v1', routeId:'sos1-hit-only', records };
  const auditBytes = Buffer.from(`${JSON.stringify(audit)}\n`);
  await writeFile(join(scratch, 'chemist-action-audit.json'), auditBytes);
  const checkpoints = [];
  for (const [index, stepId] of steps.entries()) {
    const occurredAt = `2026-01-0${index + 1}T00:00:00.000Z`;
    const campaign = createCampaign({ campaignId:`accepted-run-${stepId}`,
      title:`Full system ${stepId}`, createdAt:occurredAt,
      actors:[{ id:'agent.test', type:'agent', displayName:'Test agent' }] });
    let parentCommitId = null;
    if (stepId === 'scaffold-rewrite') {
      const startingSnapshotId = await storeSnapshot(campaign, { label:'5OVE · registered hit',
        graph:{ atoms:[
          { atomId:'hit:c1', element:'C', formalCharge:0, record:'HETATM', atomName:'C1',
            residueName:'AXE', chain:'A', residueIndex:1104 },
          { atomId:'receptor:PHE:890:CG', element:'C', formalCharge:0, record:'ATOM',
            atomName:'CG', residueName:'PHE', chain:'A', residueIndex:890 },
        ], bonds:[] }, coordinates:{ unit:'angstrom',
          atomIds:['hit:c1','receptor:PHE:890:CG'], positions:[[0,0,0],[0,1,0]] } });
      parentCommitId = await commitMolecule(campaign, { snapshotId:startingSnapshotId,
        parents:[], branch:'main', message:'Capture the prepared 5OVE/AXE coordinate boundary',
        actorId:'agent.test', occurredAt, tags:[] });
    }
    const snapshotId = await storeSnapshot(campaign, { label:stepId, graph:{ atoms:[
      { atomId:'a1', element:'C', formalCharge:0, record:'HETATM', atomName:'C1',
        residueName:'LIG', chain:'L', residueIndex:1 },
      { atomId:'a2', element:'N', formalCharge:0, record:'HETATM', atomName:'N1',
        residueName:'LIG', chain:'L', residueIndex:1 },
      { atomId:'receptor:PHE:890:CG', element:'C', formalCharge:0, record:'ATOM',
        atomName:'CG', residueName:'PHE', chain:'A', residueIndex:890 },
    ], bonds:[{ atomIds:['a1','a2'], order:1 }] }, coordinates:{ unit:'angstrom',
      atomIds:['a1','a2','receptor:PHE:890:CG'],
      positions:[[index,0,0],[index + 1.4,0,0],[0,index + 1,0]] } });
    const commitId = await commitMolecule(campaign, { snapshotId,
      parents:parentCommitId ? [parentCommitId] : [], branch:'main',
      message:`Freeze ${stepId}`, actorId:'agent.test', occurredAt,
      tags:['accepted','pre-holdout'] });
    const campaignBytes = Buffer.from(serializeCampaign(campaign));
    const campaignFilename = `${stepId}-campaign.json`;
    await writeFile(join(scratch, campaignFilename), campaignBytes);
    const fullSystemCampaign = { schema:'molarium.full-system-checkpoint/v1',
      campaignId:campaign.campaignId, branch:'main', commitId, snapshotId,
      filename:campaignFilename, sha256:sha256(campaignBytes), bytes:campaignBytes.length,
      commitActionSequence:1, exportActionSequence:2, verification:{ valid:true } };
    const body = { schema:'molarium.design-prediction-checkpoint/v1',
      routeId:'sos1-hit-only', stepId, frozenBeforeHoldoutAccess:true,
      relaxation:{ accepted:true, valenceSafeguard },
      ...(stepId === 'finish-bay-293' ? { sidechainContinuity:{
        residue:'PHE A890', accepted:true, finalChiDegrees:[-170, 95] } } : {}),
      ...(stepId === 'open-phe890-pocket' ? { rotamerDecision:{
        publicationEligible:true, diagnosticOnly:false,
        deterministicFinalReplayVerified:true } } : {}),
      staging:{ productHeavyGraph, poseTransferPlan:{ featureCorrespondences:[] } },
      fullSystemCampaign,
      ligand:{ ...inspectedLigand, atoms:inspectedLigand.atoms.map((atom, atomIndex) => ({
        ...atom, coordinatesAngstrom:[index + atomIndex * 1.4, 0, 0],
      })) },
      pocket:{ atoms:[] } };
    const bytes = Buffer.from(`${JSON.stringify(body)}\n`);
    const filename = `${stepId}-prediction.json`;
    await writeFile(join(scratch, filename), bytes);
    checkpoints.push({ stepId, predictedStateId:['AWT','AWZ','AWW','AXH'][index],
      filename, sha256:sha256(bytes), freezeActionSequence:freezeSequences.get(stepId),
      fullSystemCampaign });
  }
  const manifest = { schema:'molarium.design-prediction-run/v1', routeId:'sos1-hit-only',
    status:'predictions-frozen-holdouts-unopened', publicationEligible:true, protocol:{
      initialCoordinateInput:'PDB 5OVE/AXE only', sequentialPredictedReferences:true,
      phe890Branching:{ diagnosticOnly:false, diagnosticExactCoordinateSha256:null } },
    checkpoints, agentApi:{ auditSha256:sha256(auditBytes), auditRecords:records.length } };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  await writeFile(join(scratch, 'prediction-manifest.json'), manifestBytes);
  const evaluation = { schema:'molarium.design-prediction-holdout-evaluation-summary/v2',
    routeId:'sos1-hit-only', predictionManifestSha256:sha256(manifestBytes),
    holdoutsOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified:true,
    accepted:true, continuity:{ accepted:true }, results:steps.map((stepId) => ({
      stepId, accepted:true, failedChecks:[],
    })) };
  await writeFile(join(scratch, 'holdout-evaluation-summary.json'),
    `${JSON.stringify(evaluation)}\n`);

  const verified = await verifyAcceptedSos1Run(scratch);
  for (const stepId of steps) {
    const fullSystem = verified.checkpoints.get(stepId).fullSystemCampaign;
    assert.equal(sha256(fullSystem.campaignBytes), fullSystem.record.sha256);
    assert.equal(fullSystem.campaign.branches[fullSystem.record.branch],
      fullSystem.record.commitId);
  }
  const firstCampaignPath = join(scratch,
    verified.checkpoints.get(steps[0]).fullSystemCampaign.record.filename);
  const firstCampaignBytes = await readFile(firstCampaignPath);
  await writeFile(firstCampaignPath, Buffer.concat([firstCampaignBytes, Buffer.from(' ')]));
  await assert.rejects(() => verifyAcceptedSos1Run(scratch),
    /full-system campaign byte count changed/);
  await writeFile(firstCampaignPath, firstCampaignBytes);
  const replay = await buildAcceptedSos1ReplayScript(verified);
  assert.deepEqual(replay.script.actions.filter((step) =>
    step.action === 'designRoute.applyStep').map((step) => step.args.stepId), steps);
  assert.equal(replay.script.actions.filter((step) =>
    step.action === 'pose.applySidechainRotamer').length, 1);
  assert.equal(replay.script.actions.filter((step) => step.action === 'session.inspect'
    && step.args.scope === 'pocket' && step.args.includeCoordinates === true).length, steps.length);
  assert(!JSON.stringify(replay.script).includes('discarded'));
  assert.equal(replay.script.sourceAudit.accepted, true);
  assert.equal(replay.script.sourceAudit.stateHashGuards.mode, 'required');
  assert.equal(replay.script.sourceAudit.stateHashGuards.guardedActionCount, 12);
  const preGuardAudit = structuredClone(verified.audit);
  delete preGuardAudit.records.find((record) => record.action === 'pose.refine').result;
  await assert.rejects(() => buildAcceptedSos1ReplayScript({ ...verified,
    audit:preGuardAudit }), /missing molarium\.molecular-state-hash\/v1 result guards/);

  const rejected = { ...evaluation, accepted:false, continuity:{ accepted:false },
    results:evaluation.results.map((entry, index) => index === evaluation.results.length - 1
      ? { ...entry, accepted:false, failedChecks:['ligandRmsdAngstrom'] } : entry) };
  await writeFile(join(scratch, 'holdout-evaluation-summary.json'), `${JSON.stringify(rejected)}\n`);
  const completeFrozen = await verifyCompleteFrozenSos1Run(scratch);
  assert.equal(completeFrozen.evaluation.accepted, false);
  const predictionReplay = await buildFrozenSos1ReplayScript(completeFrozen);
  assert.match(predictionReplay.script.label, /prediction replay/);
  assert.equal(predictionReplay.script.sourceAudit.publicationClass,
    'complete-frozen-prediction');
  assert.equal(predictionReplay.script.sourceAudit.postFreezeEvaluation.accepted, false);
  assert.equal(predictionReplay.script.sourceAudit.postFreezeEvaluation.continuityAccepted, false);
  assert.deepEqual(predictionReplay.script.sourceAudit.postFreezeEvaluation.failedStepIds,
    ['finish-bay-293']);
  assert.equal(Object.hasOwn(predictionReplay.script.sourceAudit, 'accepted'), false);
  const browserPublication = await buildFrozenBrowserPublicationRecords(completeFrozen);
  assert.equal(browserPublication.declaration.postFreezeEvaluation.accepted, false);
  assert.deepEqual(browserPublication.declaration.postFreezeEvaluation.failedStepIds,
    ['finish-bay-293']);
  assert(browserPublication.reviewBytes.length < 1024 * 1024,
    'checkpoint review must not inline full-system campaigns');
  assert.equal(browserPublication.review.actions.length, steps.length + 1,
    'checkpoint review must include the exact prepared starting hit before predictions');
  assert.equal(browserPublication.review.actions[0].review.registeredStartingHit, true);
  assert.equal(browserPublication.review.actions[0].review.exactHistoryPrefix, true);
  assert.equal(browserPublication.review.provenance.coordinateGranularity
    .syntheticCoordinatesUsed, false);
  assert.deepEqual(browserPublication.review.provenance.coordinateGranularity
    .unavailableIndependentStates, [
      'compound-21-graph-edit-before-phe890-rotamer',
      'phe890-rotamer-before-coupled-relaxation',
    ], 'the review must disclose that graph-edit and Phe890 pre-relax states were not committed');
  assert(browserPublication.review.actions.every((step) =>
    step.action === 'campaign.import' && step.args.serialized == null
    && /^[a-f0-9]{64}$/.test(step.args.sourceSha256)
    && /^\.\/design-history\/publications\/sos1\/checkpoints\//
      .test(step.args.sourcePath)));
  assert.deepEqual(browserPublication.campaignAssets.slice(1).map((asset) => asset.sha256),
    steps.map((stepId) => completeFrozen.checkpoints.get(stepId)
      .fullSystemCampaign.record.sha256));
  const startingAsset = browserPublication.campaignAssets[0];
  assert.equal(startingAsset.stepId, 'starting-hit');
  const startingCampaign = JSON.parse(startingAsset.bytes);
  assert.equal(Object.keys(startingCampaign.objects.commits).length, 1);
  assert.equal(Object.keys(startingCampaign.objects.snapshots).length, 1);
  assert.equal(startingCampaign.branches.main,
    browserPublication.review.actions[0].review.commitId);
  assert.equal(startingCampaign.objects.commits[startingCampaign.branches.main].parents.length, 0);
  assert.equal(browserPublication.review.provenance.postFreezeEvaluation.accepted, false);
  await assert.rejects(() => verifyAcceptedSos1Run(scratch), /was not accepted/);

  await writeFile(join(scratch, 'holdout-evaluation-summary.json'), `${JSON.stringify(evaluation)}\n`);
  const nonPromotableManifest = { ...manifest, publicationEligible:false };
  const nonPromotableBytes = Buffer.from(`${JSON.stringify(nonPromotableManifest)}\n`);
  await writeFile(join(scratch, 'prediction-manifest.json'), nonPromotableBytes);
  await writeFile(join(scratch, 'holdout-evaluation-summary.json'), `${JSON.stringify({
    ...evaluation, predictionManifestSha256:sha256(nonPromotableBytes),
  })}\n`);
  await assert.rejects(() => verifyAcceptedSos1Run(scratch), /explicitly non-promotable/);

  const diagnosticProtocolManifest = { ...manifest, protocol:{ ...manifest.protocol,
    phe890Branching:{ diagnosticOnly:true,
      diagnosticExactCoordinateSha256:'d'.repeat(64) } } };
  const diagnosticProtocolBytes = Buffer.from(`${JSON.stringify(diagnosticProtocolManifest)}\n`);
  await writeFile(join(scratch, 'prediction-manifest.json'), diagnosticProtocolBytes);
  await writeFile(join(scratch, 'holdout-evaluation-summary.json'), `${JSON.stringify({
    ...evaluation, predictionManifestSha256:sha256(diagnosticProtocolBytes),
  })}\n`);
  await assert.rejects(() => verifyAcceptedSos1Run(scratch), /diagnostic-only Phe890/);

  await writeFile(join(scratch, 'prediction-manifest.json'), manifestBytes);
  await writeFile(join(scratch, 'holdout-evaluation-summary.json'), `${JSON.stringify(evaluation)}\n`);
  const rejectedRelaxationPath = join(scratch, 'finish-bay-293-prediction.json');
  const rejectedRelaxation = JSON.parse(await readFile(rejectedRelaxationPath, 'utf8'));
  rejectedRelaxation.relaxation.accepted = false;
  const rejectedRelaxationBytes = Buffer.from(`${JSON.stringify(rejectedRelaxation)}\n`);
  await writeFile(rejectedRelaxationPath, rejectedRelaxationBytes);
  const rejectedRelaxationManifest = { ...manifest,
    checkpoints:manifest.checkpoints.map((entry) => entry.stepId === 'finish-bay-293'
      ? { ...entry, sha256:sha256(rejectedRelaxationBytes) } : entry) };
  const rejectedRelaxationManifestBytes = Buffer.from(
    `${JSON.stringify(rejectedRelaxationManifest)}\n`);
  await writeFile(join(scratch, 'prediction-manifest.json'), rejectedRelaxationManifestBytes);
  await writeFile(join(scratch, 'holdout-evaluation-summary.json'), `${JSON.stringify({
    ...evaluation, predictionManifestSha256:sha256(rejectedRelaxationManifestBytes),
  })}\n`);
  await assert.rejects(() => verifyAcceptedSos1Run(scratch), /relaxation was not accepted/);

  await writeFile(join(scratch, 'prediction-manifest.json'), manifestBytes);
  await writeFile(join(scratch, 'holdout-evaluation-summary.json'), `${JSON.stringify(evaluation)}\n`);
  const finalPath = join(scratch, 'finish-bay-293-prediction.json');
  const originalFinal = { ...rejectedRelaxation,
    relaxation:{ accepted:true, valenceSafeguard } };
  await writeFile(finalPath, `${JSON.stringify(originalFinal)}\n`);
  const contaminated = structuredClone(originalFinal);
  contaminated.evaluation = { role:'evaluation-only', pdbId:'5OVI',
    coordinatesAngstrom:[1,2,3] };
  const contaminatedBytes = Buffer.from(`${JSON.stringify(contaminated)}\n`);
  await writeFile(finalPath, contaminatedBytes);
  const dirtyManifest = { ...manifest, checkpoints:manifest.checkpoints.map((entry) =>
    entry.stepId === 'finish-bay-293' ? { ...entry, sha256:sha256(contaminatedBytes) } : entry) };
  const dirtyManifestBytes = Buffer.from(`${JSON.stringify(dirtyManifest)}\n`);
  await writeFile(join(scratch, 'prediction-manifest.json'), dirtyManifestBytes);
  await writeFile(join(scratch, 'holdout-evaluation-summary.json'), `${JSON.stringify({
    ...evaluation, predictionManifestSha256:sha256(dirtyManifestBytes),
  })}\n`);
  await assert.rejects(() => verifyAcceptedSos1Run(scratch), /holdout coordinates/);
  console.log('Accepted SOS1 publication-run gate: PASS');
} finally {
  await rm(scratch, { recursive:true, force:true });
}
