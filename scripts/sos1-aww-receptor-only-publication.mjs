import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exactCampaignHistoryPrefix } from '../design-history/frozen-checkpoint-review.mjs';
import { verifyCampaign } from '../design-history/ledger.mjs';
import { deserializeCampaign, serializeCampaign } from
  '../design-history/live-campaign-store.mjs';
import { actionScriptFromAudit, actionScriptSha256,
  validateActionScript } from '../design-history/replay.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUN_SCHEMA = 'molarium.sos1-aww-receptor-only-prospective/v1';
const VALIDATION_SCHEMA = 'molarium.sos1-aww-receptor-only-validation/v1';
const REVIEW_SCHEMA = 'molarium.sos1-aww-receptor-only-checkpoint-review/v1';
const DECLARATION_SCHEMA = 'molarium.sos1-aww-receptor-only-browser-publication/v1';
const SHA256 = /^[a-f0-9]{64}$/;
const HOLDOUT_IDS = /5OV[F-I]/i;
const CURRENT_REQUIRED_ACTIONS = Object.freeze([
  'designRoute.applyStep',
  'geometry.setInternalCoordinate',
  'pose.addContact',
  'pose.addContact',
  'pose.setDesignerLigandPoseFixed',
  'pose.enumerateSidechainRotamers',
  'pose.applySidechainRotamer',
]);
const PROHIBITED_ACTIONS = new Set([
  'pose.refine', 'pose.apply', 'pose.updateReceptorReference',
  'optimization.run', 'calculation.run',
]);
export const SOS1_AWW_PUBLIC_CHECKPOINT_DIRECTORY =
  'design-history/publications/sos1/checkpoints';
export const SOS1_AWW_EXECUTABLE_REPLAY =
  'design-history/examples/sos1-prediction.action-script.json';
export const SOS1_AWW_CHECKPOINT_REVIEW =
  'design-history/examples/sos1-prediction-checkpoint-review.action-script.json';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function safePath(root, path, label) {
  assert(typeof path === 'string' && path && !isAbsolute(path),
    `${label} must be repository-relative`);
  const absolute = resolve(root, path);
  const fromRoot = relative(root, absolute);
  assert(fromRoot && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`),
    `${label} escapes the repository`);
  return absolute;
}

function assertDigest(value, label) {
  assert(SHA256.test(String(value || '')), `${label} is not a SHA-256 digest`);
}

function assertNoHoldoutPayload(value, label) {
  assert(!HOLDOUT_IDS.test(JSON.stringify(value)),
    `${label} contains a later crystal identifier`);
}

function assertMeasurementOnlyValidation(validation) {
  assert.equal(validation.schema, VALIDATION_SCHEMA);
  assert.equal(validation.accepted, true,
    'post-freeze scientific validation did not accept this prediction');
  assert.equal(validation.predictionFrozenBeforeValidationAccess, true,
    'scientific validation was not performed after prediction freeze');
  assert.equal(validation.measurementOnly, true,
    'post-freeze validation must contain measurements only');
  assert.equal(validation.holdoutCoordinatesIncluded, false,
    'post-freeze validation embeds holdout coordinates');
  assert.equal(validation.checks?.phe890?.accepted, true,
    'post-freeze Phe890 validation was not accepted');
  assert.equal(validation.checks?.designerInteraction?.accepted, true,
    'post-freeze designer-interaction validation was not accepted');
  assert.deepEqual(validation.failedChecks || [], [],
    'post-freeze validation contains failed checks');
  const forbiddenKeys = new Set(['atom','atoms','bond','bonds','coordinate','coordinates',
    'coordinatesangstrom','molecule','pdb','pdbdata','pdbtext','position','positions',
    'structure','structuredata']);
  const visit = (value, path = 'post-freeze validation') => {
    if (typeof value === 'string')
      assert(!/(?:^|\n)(?:ATOM  |HETATM)/.test(value), `${path} embeds PDB coordinates`);
    if (Array.isArray(value)) return value.forEach((entry, index) =>
      visit(entry, `${path}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      assert(!forbiddenKeys.has(key.toLowerCase()),
        `${path}.${key} is a forbidden holdout-coordinate payload`);
      visit(entry, `${path}.${key}`);
    }
  };
  visit(validation);
}

async function readJson(path, label) {
  const bytes = await readFile(path);
  let value;
  try { value = JSON.parse(bytes); }
  catch { throw new Error(`${label} is not valid JSON`); }
  return { bytes, value };
}

function campaignRecord(manifest, key) {
  const record = manifest?.checkpoints?.[key];
  assert(record && typeof record === 'object',
    `prediction manifest lacks checkpoints.${key}`);
  assert(typeof record.filename === 'string' && record.filename,
    `checkpoints.${key}.filename is missing`);
  assertDigest(record.sha256, `checkpoints.${key}.sha256`);
  assertDigest(String(record.snapshotId || '').replace(/^snapshot:/, ''),
    `checkpoints.${key}.snapshotId`);
  assertDigest(String(record.commitId || '').replace(/^commit:/, ''),
    `checkpoints.${key}.commitId`);
  return record;
}

async function verifiedCampaign(directory, record, label) {
  const path = resolve(directory, record.filename);
  assert.equal(dirname(path), directory, `${label} campaign filename escapes the run`);
  const bytes = await readFile(path);
  assert.equal(bytes.length, record.bytes, `${label} campaign byte count changed`);
  assert.equal(sha256(bytes), record.sha256, `${label} campaign bytes changed`);
  const serialized = bytes.toString('utf8');
  const campaign = deserializeCampaign(serialized);
  assert.equal(serializeCampaign(campaign), serialized,
    `${label} campaign is not canonically serialized`);
  const verification = await verifyCampaign(campaign);
  assert.equal(verification.valid, true, `${label} campaign is invalid: ${verification.reason}`);
  const commit = campaign.objects?.commits?.[record.commitId];
  assert(commit, `${label} campaign lacks its declared commit`);
  assert.equal(commit.snapshotId, record.snapshotId,
    `${label} commit does not identify its declared snapshot`);
  assert(campaign.objects?.snapshots?.[record.snapshotId],
    `${label} campaign lacks its declared snapshot`);
  assert(Object.values(campaign.branches || {}).includes(record.commitId),
    `${label} declared commit is not a branch head`);
  return Object.freeze({ label, record, path, bytes, campaign,
    branch:Object.entries(campaign.branches).find(([, id]) => id === record.commitId)?.[0] });
}

function assertContainsHistory(later, earlier) {
  assert.deepEqual(later.campaign.objects.commits[earlier.record.commitId],
    earlier.campaign.objects.commits[earlier.record.commitId],
  `${later.label} campaign changed the ${earlier.label} commit`);
  assert.deepEqual(later.campaign.objects.snapshots[earlier.record.snapshotId],
    earlier.campaign.objects.snapshots[earlier.record.snapshotId],
  `${later.label} campaign changed the ${earlier.label} snapshot`);
}

function currentRecords(audit) {
  assert(Array.isArray(audit?.currentRunRequestIds)
    && new Set(audit.currentRunRequestIds).size === audit.currentRunRequestIds.length,
  'current-run request IDs are missing or duplicated');
  const ids = new Set(audit.currentRunRequestIds);
  const records = (audit.records || []).filter((record) => ids.has(record.requestId));
  assert.equal(records.length, ids.size,
    'the Chemist Actions audit does not contain every current-run request');
  assert(records.every((record) => record.status === 'completed'),
    'one or more current-run Chemist Actions did not complete');
  return records;
}

function actionSubsequence(records, expected) {
  let cursor = 0;
  for (const record of records)
    if (record.action === expected[cursor] && ++cursor === expected.length) return true;
  return false;
}

function contact(records, ligandAtomName, receptor) {
  return records.find((record) => record.action === 'pose.addContact'
    && record.args?.ligandAtom?.componentId === 'heterogen:A:1104::AWW'
    && record.args?.ligandAtom?.atomName === ligandAtomName
    && record.args?.receptorAtom?.residueName === receptor.residueName
    && record.args?.receptorAtom?.chain === receptor.chain
    && Number(record.args?.receptorAtom?.residueIndex) === receptor.residueIndex
    && String(record.args?.receptorAtom?.insertionCode || '') === ''
    && record.args?.receptorAtom?.atomName === receptor.atomName
    && record.args?.ligandRole === 'donor');
}

/** Verify the immutable output of the public-action AWW designer-intent run.
 * This is intentionally independent of the older coupled-pose/AXH verifier. */
export async function verifySos1AwwReceptorOnlyRun(runDirectory, { root = ROOT } = {}) {
  const directory = resolve(runDirectory);
  const [manifestFile, boundaryFile, auditFile, inspectionFile, validationFile] = await Promise.all([
    readJson(resolve(directory, 'prediction-manifest.json'), 'prediction manifest'),
    readJson(resolve(directory, 'boundary.json'), 'prospective boundary'),
    readJson(resolve(directory, 'chemist-action-audit.json'), 'Chemist Actions audit'),
    readJson(resolve(directory, 'coordinate-inspections.json'), 'coordinate evidence'),
    readJson(resolve(directory, 'post-freeze-validation.json'),
      'post-freeze scientific validation'),
  ]);
  const manifest = manifestFile.value, boundary = boundaryFile.value;
  const audit = auditFile.value, inspection = inspectionFile.value;
  const validation = validationFile.value;
  assert.equal(manifest.schema, RUN_SCHEMA);
  assert.equal(boundary.schema, RUN_SCHEMA);
  assert.equal(manifest.status, 'prediction-frozen-later-structures-unopened');
  assert.equal(manifest.publicationEligible, true);
  assert.equal(boundary.laterStructureAccess, false);
  assert.equal(manifest.scientificContract?.laterStructureAccess, false);
  assert.equal(manifest.scientificContract?.receptorOnly, true);
  assert.equal(manifest.scientificContract?.poseRefinementUsed, false);
  assert.equal(manifest.scientificContract?.optimizationUsed, false);
  assert.equal(manifest.scientificContract?.ligandIntentFrozenBeforeReceptorPrediction, true);
  assert.equal(manifest.scientificContract?.ligandCoordinateEquality, true);
  assert.equal(manifest.fixedLigand?.exactEquality, true);
  assert.deepEqual(manifest.fixedLigand?.before, manifest.fixedLigand?.after,
    'manifest does not prove exact ligand-state equality across the Phe890 response');
  assert.deepEqual(inspection.fixedLigand?.before, inspection.fixedLigand?.after,
    'coordinate evidence does not prove exact ligand-state equality');
  assert.equal(inspection.fixedLigand?.exactEquality, true);
  assertMeasurementOnlyValidation(validation);
  assert.equal(validation.predictionManifestSha256, sha256(manifestFile.bytes),
    'post-freeze validation does not belong to this prediction manifest');
  assert.equal(boundary.designerIntent?.action, 'geometry.setInternalCoordinate');
  assert.equal(boundary.designerIntent?.relativeRotationDegrees, 180);
  assert.deepEqual(boundary.designerIntent?.atomNames, ['N7','C12','C15','CX2']);
  assert.equal(boundary.designerIntent?.hypothesesAreScoringResults, false);

  const sourcePath = safePath(root, boundary.source?.path, 'source campaign path');
  const sourceBytes = await readFile(sourcePath);
  assertDigest(boundary.source?.sha256, 'source campaign sha256');
  assert.equal(sha256(sourceBytes), boundary.source.sha256,
    'the exact frozen AWZ source campaign changed');
  assert.equal(manifest.source?.sha256, boundary.source.sha256);
  const sourceSerialized = sourceBytes.toString('utf8');
  const sourceCampaign = deserializeCampaign(sourceSerialized);
  assert.equal(serializeCampaign(sourceCampaign), sourceSerialized);
  assert.equal((await verifyCampaign(sourceCampaign)).valid, true,
    'the exact frozen AWZ source campaign is invalid');

  const graphOnly = await verifiedCampaign(directory,
    campaignRecord(manifest, 'graphOnly'), 'AWW graph-only');
  const ligandIntent = await verifiedCampaign(directory,
    campaignRecord(manifest, 'ligandIntent'), 'AWW designer intent');
  const receptorResponse = await verifiedCampaign(directory,
    campaignRecord(manifest, 'receptorResponse'), 'AWW Phe890 response');
  assertContainsHistory(graphOnly, { label:'AWZ source', record:{
    commitId:sourceCampaign.branches.main,
    snapshotId:sourceCampaign.objects.commits[sourceCampaign.branches.main].snapshotId,
  }, campaign:sourceCampaign });
  assertContainsHistory(ligandIntent, graphOnly);
  assertContainsHistory(receptorResponse, ligandIntent);

  const records = currentRecords(audit);
  assert(actionSubsequence(records, CURRENT_REQUIRED_ACTIONS),
    'current-run audit lacks the ordered graph/torsion/contact/lock/Phe response');
  assert.deepEqual(records.filter((record) => PROHIBITED_ACTIONS.has(record.action)), [],
    'a ligand-moving or coupled calculation entered the receptor-only run');
  const graph = records.find((record) => record.action === 'designRoute.applyStep');
  assert.equal(graph?.args?.stepId, 'open-phe890-pocket');
  assert.equal(graph?.result?.designStep?.referenceStateId, 'AWZ');
  assert.equal(graph?.result?.designStep?.stateId, 'AWW');
  assert.equal(graph?.result?.designStep?.inputKind, 'molecular-graph-only');
  const torsion = records.find((record) => record.action === 'geometry.setInternalCoordinate');
  assert.equal(torsion?.args?.moveConnected, true);
  assert(Array.isArray(torsion?.args?.atomIds) && torsion.args.atomIds.length === 4,
    'designer torsion does not identify four persistent atoms');
  assert(Number.isFinite(torsion?.args?.value), 'designer torsion value is not finite');
  assert(contact(records, 'N7', { residueName:'ASN', chain:'A', residueIndex:879,
    atomName:'OD1' }), 'portable N7 to ASN A879 OD1 designer contact is absent');
  assert(contact(records, 'OX3', { residueName:'TYR', chain:'A', residueIndex:884,
    atomName:'O' }), 'portable OX3 to TYR A884 backbone-O designer contact is absent');
  const lock = records.find((record) => record.action === 'pose.setDesignerLigandPoseFixed');
  assert.equal(lock?.args?.fixed, true);
  assert.equal(lock?.result?.designerFixedLigandPose?.active, true);
  assertDigest(lock?.result?.designerFixedLigandPose?.lockId, 'designer ligand lock ID');
  const enumeration = records.find((record) =>
    record.action === 'pose.enumerateSidechainRotamers');
  assert.equal(enumeration?.result?.sidechainRotamers?.designerFixedLigandPose?.lockId,
    lock.result.designerFixedLigandPose.lockId);
  assert.equal(enumeration?.result?.sidechainRotamers?.ligandPosePolicy,
    'designer-fixed; receptor branches were ranked without generating or reranking ligand poses');
  const application = records.find((record) => record.action === 'pose.applySidechainRotamer');
  assert.equal(application?.result?.sidechainRotamer?.designerFixedLigandPose?.lockId,
    lock.result.designerFixedLigandPose.lockId);
  assert(Array.isArray(application?.result?.sidechainRotamer?.chiDegrees)
    && application.result.sidechainRotamer.chiDegrees.every(Number.isFinite),
  'selected Phe890 response lacks a portable chi-angle identity');
  assertNoHoldoutPayload(boundary, 'prospective boundary');
  assertNoHoldoutPayload(manifest, 'prediction manifest');
  assertNoHoldoutPayload(audit, 'Chemist Actions audit');
  assertNoHoldoutPayload(inspection, 'coordinate evidence');
  return Object.freeze({ directory, runId:basename(directory), root,
    manifest, manifestBytes:manifestFile.bytes, boundary, boundaryBytes:boundaryFile.bytes,
    audit, auditBytes:auditFile.bytes, inspection, inspectionBytes:inspectionFile.bytes,
    validation, validationBytes:validationFile.bytes,
    records, source:{ path:sourcePath, bytes:sourceBytes, campaign:sourceCampaign,
      sha256:boundary.source.sha256 },
    checkpoints:Object.freeze({ graphOnly, ligandIntent, receptorResponse }) });
}

function ancestry(campaign) {
  const result = [];
  let commitId = campaign.branches?.main;
  while (commitId) {
    const commit = campaign.objects?.commits?.[commitId];
    assert(commit, `campaign ancestry lacks ${commitId}`);
    result.push({ commitId, commit });
    assert((commit.parents || []).length <= 1,
      'publication source ancestry must be a single prospective route');
    commitId = commit.parents?.[0] || null;
  }
  return result.reverse();
}

async function prefixAsset(verified, entry, id, filename, label) {
  const campaign = await exactCampaignHistoryPrefix(verified.source.campaign, entry.commitId);
  const bytes = Buffer.from(serializeCampaign(campaign));
  return { id, label, path:`${SOS1_AWW_PUBLIC_CHECKPOINT_DIRECTORY}/${filename}`,
    bytes, sha256:sha256(bytes), campaign, branch:entry.commit.branch,
    commitId:entry.commitId, snapshotId:entry.commit.snapshotId,
    checkpointSha256:entry.commit.snapshotId.replace(/^snapshot:/, '') };
}

function exactAsset(checkpoint, id, filename, label) {
  return { id, label, path:`${SOS1_AWW_PUBLIC_CHECKPOINT_DIRECTORY}/${filename}`,
    bytes:checkpoint.bytes, sha256:checkpoint.record.sha256,
    campaign:checkpoint.campaign, branch:checkpoint.branch,
    commitId:checkpoint.record.commitId, snapshotId:checkpoint.record.snapshotId,
    checkpointSha256:checkpoint.record.snapshotId.replace(/^snapshot:/, '') };
}

function reviewScript(verified, assets) {
  const actions = assets.map((asset, index) => ({ action:'campaign.import',
    args:{ sourcePath:`./${asset.path}`, sourceSha256:asset.sha256,
      preserveView:index > 0 },
    caption:`Review ${asset.label}`,
    ...(index ? { expect:{ 'campaignImport.viewPreserved':true } } : {}),
    review:{ schema:REVIEW_SCHEMA, immutableSnapshot:true, promotable:false,
      calculationPolicy:'none', holdoutCoordinatesIncluded:false,
      checkpointSha256:asset.checkpointSha256, campaignSha256:asset.sha256,
      campaignId:asset.campaign.campaignId, branch:asset.branch,
      commitId:asset.commitId, snapshotId:asset.snapshotId } }));
  return validateActionScript({ schema:'molarium.chemist-action-script/v1',
    label:`SOS1 AWW designer-intent checkpoint review ${verified.runId}`,
    provenance:{ schema:REVIEW_SCHEMA, reviewOnly:true,
      sourceStatus:'prospective-designer-intent-receptor-response',
      sourceSnapshotsContentAddressed:true, promotable:false,
      nonPromotableReason:'Checkpoint review performs no scientific calculation.',
      calculationPolicy:'none', holdoutCoordinatesIncluded:false,
      sourceRunId:verified.runId, sourceManifestSha256:sha256(verified.manifestBytes),
      scientificValidationSha256:sha256(verified.validationBytes),
      publicChemistActions:['campaign.import'] }, actions });
}

function caption(record) {
  const id = String(record.requestId || '');
  const captions = [
    [/route-load-hit$/, 'Begin with the only allowed coordinates: the 5OVE/AXE hit'],
    [/scaffold-rewrite-stage$/, 'Rewrite the hit scaffold'],
    [/fragment-merge-stage$/, 'Merge the prospective fragment design'],
    [/apply-aww-graph$/, 'Install the reported AWW molecular graph without crystal coordinates'],
    [/set-designer-aww-torsion$/, 'Choose the attachment direction explicitly'],
    [/record-designer-asn879-hypothesis$/, 'Record the N7 to Asn879 interaction hypothesis'],
    [/record-designer-tyr884-hypothesis$/, 'Record the OX3 to Tyr884 backbone-oxygen hypothesis'],
    [/fix-designer-ligand-intent$/, 'Fix the chemist-selected ligand pose'],
    [/enumerate-phe890$/, 'Enumerate receptor-only Phe890 responses'],
    [/apply-top-phe890-steric-rank$/, 'Apply the prospectively ranked Phe890 response'],
  ];
  return captions.find(([pattern]) => pattern.test(id))?.[1]
    || id.replaceAll('-', ' ').replace(/^./, (character) => character.toUpperCase());
}

function executableScript(verified, upstream) {
  const upstreamRecords = upstream?.audit?.records || [];
  const cutoff = upstreamRecords.find((record) =>
    record.requestId === 'fragment-merge-capture-predicted-reference');
  assert(cutoff?.status === 'completed' && cutoff.action === 'pose.captureReference',
    'upstream audit lacks the exact post-AWZ reference-capture seam');
  const predecessor = upstream?.sourceCampaignSha256;
  assert.equal(predecessor, verified.source.sha256,
    'upstream recomputation audit does not terminate at the imported AWZ source campaign');
  const prefix = upstreamRecords.filter((record) => record.sequence <= cutoff.sequence
    && record.status === 'completed');
  assert.deepEqual(prefix.filter((record) => record.action === 'designRoute.applyStep')
    .map((record) => record.args?.stepId), ['scaffold-rewrite','fragment-merge'],
  'upstream replay does not contain the ordered AWT and AWZ graph steps');
  const firstCurrent = verified.records.findIndex((record) =>
    record.action === 'designRoute.applyStep' && record.args?.stepId === 'open-phe890-pocket');
  assert(firstCurrent >= 0, 'current run lacks its AWW graph step');
  const suffix = verified.records.slice(firstCurrent);
  const sourceRecords = [...prefix, ...suffix];
  const records = sourceRecords.map((record, index) => ({ ...structuredClone(record),
    sequence:index + 1 }));
  const captionsBySequence = Object.fromEntries(records.map((record) =>
    [record.sequence, caption(record)]));
  const script = actionScriptFromAudit({ schema:'molarium.chemist-action-audit/v1',
    routeId:'sos1-hit-only', records }, {
    label:`SOS1 AWW designer-intent receptor-response replay ${verified.runId}`,
    includeReadOnly:true, captionsBySequence, includeAuditMetadata:true,
    stateHashGuards:'off', executionContract:'portable-scientific',
    provenance:{ schema:DECLARATION_SCHEMA,
      sourceRunId:verified.runId, sourceManifestSha256:sha256(verified.manifestBytes),
      sourceAuditSha256:sha256(verified.auditBytes),
      scientificValidationSha256:sha256(verified.validationBytes),
      upstreamAuditSha256:sha256(upstream.auditBytes),
      upstreamCutoffSequence:cutoff.sequence,
      sourceCampaignSha256:verified.source.sha256,
      coordinatePolicy:'5OVE/AXE precursor plus public molecular-graph and geometry actions; no later crystal coordinates',
      ligandIntent:'chemist-selected attachment direction, recorded hypotheses, then fixed ligand pose',
      predictedDegreesOfFreedom:'Phe890 side chain only' },
  });
  assert.equal(script.actions[0].action, 'designRoute.load',
    'executable story must start from the registered 5OVE route, not a checkpoint import');
  assert(!script.actions.some((step) => step.action === 'campaign.import'),
    'executable story must not import the AWZ checkpoint');
  assert.deepEqual(script.actions.filter((step) => step.action === 'designRoute.applyStep')
    .map((step) => step.args.stepId),
  ['scaffold-rewrite','fragment-merge','open-phe890-pocket']);
  assert(!script.actions.some((step) => PROHIBITED_ACTIONS.has(step.action)),
    'AWW executable story contains a prohibited coupled calculation');
  const rotamer = script.actions.find((step) =>
    step.action === 'pose.applySidechainRotamer');
  assert(Array.isArray(rotamer?.args?.chiDegrees),
    'portable replay did not convert Phe890 application to a chi-angle selector');
  for (const key of ['coordinateSha256','expectedInputCoordinateSha256',
    'expectedSelectedCoordinateSha256'])
    assert.equal(Object.hasOwn(rotamer.args, key), false,
      `portable replay retained exact-coordinate rotamer argument ${key}`);
  assertNoHoldoutPayload(script, 'executable action script');
  return script;
}

/** Build both browser inputs in memory. This function deliberately performs no
 * repository writes, registry changes, deployment, or scientific calculation. */
export async function buildSos1AwwReceptorOnlyPublicationRecords(verified,
  { upstream } = {}) {
  assert(upstream?.audit && Buffer.isBuffer(upstream.auditBytes),
    'an explicit hashable upstream Chemist Actions audit is required');
  const chain = ancestry(verified.source.campaign);
  assert.equal(chain.length, 3,
    'AWZ source campaign must contain exactly the prepared hit, AWT, and AWZ commits');
  const [starting, scaffold, fragment] = chain;
  const assets = [
    await prefixAsset(verified, starting, 'starting-hit',
      'starting-hit-campaign.json', 'the exact prepared 5OVE/AXE starting hit'),
    await prefixAsset(verified, scaffold, 'scaffold-rewrite',
      'scaffold-rewrite-campaign.json', 'the scaffold-rewrite checkpoint'),
    await prefixAsset(verified, fragment, 'fragment-merge',
      'fragment-merge-campaign.json', 'the fragment-merge checkpoint'),
    exactAsset(verified.checkpoints.graphOnly, 'aww-graph',
      'aww-graph-campaign.json', 'the AWW graph before directional placement'),
    exactAsset(verified.checkpoints.ligandIntent, 'aww-designer-intent',
      'aww-designer-intent-campaign.json', 'the fixed AWW designer-intent pose'),
    exactAsset(verified.checkpoints.receptorResponse, 'aww-phe890-response',
      'aww-phe890-response-campaign.json', 'the receptor-only Phe890 response'),
  ];
  const executable = executableScript(verified, upstream);
  const review = reviewScript(verified, assets);
  const executableBytes = jsonBytes(executable), reviewBytes = jsonBytes(review);
  const declaration = { schema:DECLARATION_SCHEMA,
    routeId:'sos1-hit-only', publicationClass:'prospective-designer-intent-receptor-response',
    sourceRun:{ id:verified.runId,
      manifestSha256:sha256(verified.manifestBytes),
      auditSha256:sha256(verified.auditBytes),
      scientificValidationSha256:sha256(verified.validationBytes),
      sourceCampaignSha256:verified.source.sha256 },
    scientificContract:{ precursorCoordinates:'registered 5OVE/AXE lineage',
      laterCrystalCoordinatesUsed:false, ligandDirection:'explicit chemist action',
      ligandPoseFixedBeforePrediction:true, predictedDegreesOfFreedom:['PHE A890 side chain'],
      poseRefinementUsed:false, optimizationUsed:false },
    scientificValidation:{ schema:VALIDATION_SCHEMA, accepted:true,
      predictionFrozenBeforeValidationAccess:true, measurementOnly:true,
      holdoutCoordinatesIncluded:false,
      phe890Accepted:true, designerInteractionAccepted:true },
    checkpoints:assets.map((asset) => ({ id:asset.id, path:asset.path,
      sha256:asset.sha256, commitId:asset.commitId, snapshotId:asset.snapshotId })),
    executableReplay:{ path:SOS1_AWW_EXECUTABLE_REPLAY,
      sha256:sha256(executableBytes), actionScriptSha256:await actionScriptSha256(executable) },
    checkpointReview:{ path:SOS1_AWW_CHECKPOINT_REVIEW,
      sha256:sha256(reviewBytes), actionScriptSha256:await actionScriptSha256(review),
      calculationPolicy:'none', promotable:false } };
  return Object.freeze({ executable, executableBytes, review, reviewBytes,
    campaignAssets:assets, declaration, declarationBytes:jsonBytes(declaration) });
}
