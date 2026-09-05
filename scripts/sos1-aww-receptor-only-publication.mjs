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
const ENERGY_OPTIONS = Object.freeze({ implicitSolvent:'obc2',
  nonbondedCutoffNm:1.0, constraintMode:'none' });
const PHE890_RESPONSE_ATOMS = Object.freeze(
  ['CG','CD1','CD2','CE1','CE2','CZ'].map((atomName) => Object.freeze({
    residueName:'PHE', chain:'A', residueIndex:890, insertionCode:'', atomName,
  })));
const CURRENT_REQUIRED_ACTIONS = Object.freeze([
  'designRoute.applyStep',
  'pose.addContact',
  'pose.addContact',
  'geometry.alignBranchToContact',
  'pose.setDesignerLigandPoseFixed',
  'pose.enumerateSidechainRotamers',
  'pose.applySidechainRotamer',
]);
const PROHIBITED_ACTIONS = new Set([
  'geometry.setInternalCoordinate',
  'pose.refine', 'pose.apply', 'pose.updateReceptorReference',
  'optimization.run',
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

function assertMeasurementOnlyValidation(validation, { requireAccepted = true } = {}) {
  assert.equal(validation.schema, VALIDATION_SCHEMA);
  if (requireAccepted) assert.equal(validation.accepted, true,
    'post-freeze scientific validation did not accept this prediction');
  else {
    assert.equal(validation.designerIntentReferenceInformed, true,
      'complete-frozen review is explicitly limited to reference-informed runs');
    assert.equal(validation.checks?.ligandIntegrity?.accepted, true,
      'complete-frozen review cannot bypass ligand chemistry or clash integrity');
    assert.equal(validation.accepted, validation.failedChecks.length === 0);
    assert.deepEqual(validation.failedChecks,
      Object.entries(validation.checks).filter(([, check]) => check.accepted !== true)
        .map(([name]) => name), 'failed-check list is inconsistent');
  }
  assert.equal(validation.predictionFrozenBeforeValidationAccess,
    validation.designerIntentReferenceInformed !== true,
    'validation must state whether crystal inspection preceded the frozen run');
  if (validation.designerIntentReferenceInformed)
    assert.equal(validation.predictionFrozenBeforeNumericalComparison, true,
      'numerical comparison was not performed after prediction freeze');
  assert.equal(validation.measurementOnly, true,
    'post-freeze validation must contain measurements only');
  assert.equal(validation.holdoutCoordinatesIncluded, false,
    'post-freeze validation embeds holdout coordinates');
  if (requireAccepted) assert.equal(validation.checks?.phe890?.accepted, true,
    'post-freeze Phe890 validation was not accepted');
  assert.equal(validation.checks?.designerInteraction?.accepted, true,
    'post-freeze designer-interaction validation was not accepted');
  if (requireAccepted) assert.deepEqual(validation.failedChecks || [], [],
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
  return records.sort((left, right) => left.sequence - right.sequence);
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
export async function verifySos1AwwReceptorOnlyRun(runDirectory,
  { root = ROOT, requireAccepted = true } = {}) {
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
  const referenceInformed = manifest.status === 'prediction-frozen-reference-informed-designer-intent';
  const graphResume = boundary.source?.kind === 'exact-frozen-graph-only-campaign';
  assert.equal(manifest.schema, RUN_SCHEMA);
  assert.equal(boundary.schema, RUN_SCHEMA);
  assert.equal(manifest.status, referenceInformed
    ? 'prediction-frozen-reference-informed-designer-intent'
    : 'prediction-frozen-later-structures-unopened');
  assert.equal(manifest.publicationEligible, true);
  assert.equal(boundary.laterStructureAccess, referenceInformed);
  assert.equal(manifest.scientificContract?.laterStructureAccess, referenceInformed);
  if (referenceInformed) {
    assert.equal(boundary.designerIntentOrigin, 'reported-series-informed designer hypothesis');
    assert.equal(boundary.externalReferenceCoordinatesUsed, false);
    assert.equal(manifest.scientificContract.externalReferenceCoordinatesUsed, false);
    assert.equal(validation.designerIntentReferenceInformed, true);
    assert.equal(boundary.waterPolicy, 'all source waters retained and fixed');
    assert.deepEqual(boundary.designerIntent.upstreamAxisAtomNames, ['N7','C12']);
    assert.deepEqual(boundary.designerIntent.upstreamRotationRangeDegrees, [0,60]);
  }
  assert.equal(manifest.scientificContract?.receptorOnly, true);
  assert.equal(manifest.scientificContract?.poseRefinementUsed, false);
  assert.equal(manifest.scientificContract?.optimizationUsed, false);
  assert.equal(manifest.scientificContract?.ligandIntentFrozenBeforeReceptorPrediction, true);
  assert.equal(manifest.scientificContract?.ligandCoordinateEquality, true);
  assert.equal(manifest.scientificContract?.everyEnumeratedReceptorCandidateEvaluated, true);
  assert.equal(manifest.fixedLigand?.exactEquality, true);
  assert.deepEqual(manifest.fixedLigand?.before, manifest.fixedLigand?.after,
    'manifest does not prove exact ligand-state equality across the Phe890 response');
  assert.deepEqual(inspection.fixedLigand?.before, inspection.fixedLigand?.after,
    'coordinate evidence does not prove exact ligand-state equality');
  assert.equal(inspection.fixedLigand?.exactEquality, true);
  assertMeasurementOnlyValidation(validation, { requireAccepted });
  assert.equal(validation.predictionManifestSha256, sha256(manifestFile.bytes),
    'post-freeze validation does not belong to this prediction manifest');
  assert.deepEqual(manifest.boundary, manifest.evidence?.boundary,
    'prediction manifest does not bind one exact prospective boundary');
  assert.equal(manifest.boundary?.filename, 'boundary.json');
  assert.equal(manifest.boundary?.bytes, boundaryFile.bytes.length,
    'prospective boundary byte count changed');
  assert.equal(manifest.boundary?.sha256, sha256(boundaryFile.bytes),
    'prospective boundary bytes changed');
  for (const [key, file] of [['audit', auditFile], ['coordinateInspections', inspectionFile]]) {
    const descriptor = manifest.evidence?.[key];
    assert.equal(descriptor?.filename, key === 'audit'
      ? 'chemist-action-audit.json' : 'coordinate-inspections.json');
    assert.equal(descriptor?.bytes, file.bytes.length, `${key} evidence byte count changed`);
    assert.equal(descriptor?.sha256, sha256(file.bytes), `${key} evidence bytes changed`);
  }
  assert.equal(boundary.designerIntent?.action, 'geometry.alignBranchToContact',
    'designer intent must use contact-directed branch alignment');
  assert.deepEqual(boundary.designerIntent?.orderedAxisAtomNames, ['C12','C15']);
  assert.equal(boundary.designerIntent?.designerPrimaryRotationDegrees, 150);
  assert.deepEqual(boundary.designerIntent?.coupledAxisAtomNames,
    [['CX4','CX5'],['CX15','CX16']]);
  assert.deepEqual(boundary.designerIntent?.directionalContact, {
    ligandAtom:'AWW OX3', receptorAtom:'TYR A884 O',
    contactIdSource:'result.contact.contactId from the preceding pose.addContact action',
  });
  assert.equal(boundary.designerIntent?.solution, 'best-directional',
    'designer intent must select the declared best-directional solution');
  assert.equal(boundary.designerIntent?.currentSceneCoordinatesOnly, true);
  assert.equal(boundary.designerIntent?.externalReferenceCoordinatesUsed, false);
  assert.equal(boundary.designerIntent?.hypothesesAreScoringResults, false);
  assert.deepEqual(boundary.designerIntent?.allowedResponseAtoms,
    PHE890_RESPONSE_ATOMS,
  'designer intent must permit only the movable Phe890 heavy side-chain atoms');
  assert.deepEqual(boundary.receptorPrediction?.energy, {
    job:'energy', method:'openmm', options:ENERGY_OPTIONS,
    coordinatePolicy:'fixed-coordinate single-point; no optimization or dynamics',
  });
  assert.equal(boundary.receptorPrediction?.everyEnumeratedCandidateEvaluated, true);
  assert.equal(boundary.receptorPrediction?.ligandCoordinatesFixed, true);

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
  if (graphResume) {
    assert.equal(boundary.source.stateId, 'AWW');
    assert.equal(boundary.source.sha256,
      'c0672efabc8da255de45a6d8b41f3f1a2bb0652ac2e683a70a9ed33b8692b3b1');
    assert.equal(graphOnly.record.sha256, boundary.source.sha256);
    assert.equal(graphOnly.record.commitId, sourceCampaign.branches.main);
  }
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
  assert.deepEqual(audit.currentRunRequestIds, manifest.currentRun?.currentRunRequestIds,
    'currentRunRequestIds are not bound to the prediction manifest');
  assert.equal(records.length, manifest.currentRun?.actionCount);
  assert.deepEqual(records.map((record) => record.sequence),
    Array.from({ length:records.length }, (_, index) =>
      manifest.currentRun.firstSequence + index),
  'current-run sequences are not complete and contiguous');
  assert.equal(records.at(-1)?.sequence, manifest.currentRun?.lastSequence);
  assert.deepEqual(records.map((record) => record.action), manifest.currentRun?.actions,
    'current-run actions differ from the frozen manifest');
  assert(actionSubsequence(records, graphResume
    ? CURRENT_REQUIRED_ACTIONS.slice(1) : CURRENT_REQUIRED_ACTIONS),
    'current-run audit lacks the ordered graph/contact/directional-geometry/lock/Phe response');
  assert.deepEqual(records.filter((record) => PROHIBITED_ACTIONS.has(record.action)), [],
    'a legacy torsion, ligand-moving action, or coupled relaxation entered the receptor-only run');
  assert.deepEqual(manifest.currentRun?.prohibitedActionsObserved, []);
  const calculations = records.filter((record) => record.action === 'calculation.run');
  for (const record of calculations) {
    assert.deepEqual(record.args, { job:'energy', method:'openmm', options:ENERGY_OPTIONS },
      'receptor-only run contains a calculation other than the exact OpenMM/OBC2 single-point energy');
    assert.equal(record.result?.calculation?.job, 'energy');
    assert.equal(record.result?.calculation?.method, 'openmm');
    assert.equal(record.result?.calculation?.movedHeavyAtomCount, 0,
      'single-point energy moved a heavy atom');
    assert.equal(record.result?.calculation?.maximumDisplacementAngstrom, 0,
      'single-point energy changed coordinates');
  }
  const graph = records.find((record) => record.action === 'designRoute.applyStep');
  if (!graphResume || graph) {
    assert.equal(graph?.args?.stepId, 'open-phe890-pocket');
    assert.equal(graph?.result?.designStep?.referenceStateId, 'AWZ');
    assert.equal(graph?.result?.designStep?.stateId, 'AWW');
    assert.equal(graph?.result?.designStep?.inputKind, 'molecular-graph-only');
  }
  const hingeContact = contact(records, 'N7', { residueName:'ASN', chain:'A',
    residueIndex:879, atomName:'OD1' });
  const directionalContact = contact(records, 'OX3', { residueName:'TYR', chain:'A',
    residueIndex:884, atomName:'O' });
  assert(hingeContact, 'portable N7 to ASN A879 OD1 designer contact is absent');
  assert(directionalContact, 'portable OX3 to TYR A884 backbone-O designer contact is absent');
  for (const declaredContact of [hingeContact, directionalContact]) {
    assert.equal(declaredContact.result?.contact?.required, true,
      'designer interaction hypothesis was not recorded as required');
    assert.equal(declaredContact.result?.contact?.origin?.kind,
      'user-added-hydrogen-bond-hypothesis',
    'designer interaction hypothesis lacks user-supplied provenance');
  }
  const alignments = records.filter((record) =>
    record.action === 'geometry.alignBranchToContact');
  assert.equal(alignments.length, 1,
    'receptor-only run must contain one designer-directed branch alignment');
  const alignment = alignments[0];
  assert.equal(alignment.args?.solution, 'best-directional');
  const stagedIds = new Map((inspection.inspections?.stagedLigand?.atoms || [])
    .filter((atom) => atom.residueName === 'AWW' && Number(atom.residueIndex) === 1104)
    .map((atom) => [atom.atomName, atom.atomId]));
  const expectedPrimaryAxis = ['C12','C15'].map((name) => stagedIds.get(name));
  const expectedCoupledAxes = [['CX4','CX5'],['CX15','CX16']]
    .map((axis) => axis.map((name) => stagedIds.get(name)));
  assert(expectedPrimaryAxis.every(Boolean)
    && expectedCoupledAxes.flat().every(Boolean),
  'coordinate evidence lacks the declared AWW axes');
  assert.deepEqual(alignment.args?.axisAtomIds, expectedPrimaryAxis);
  assert.deepEqual(alignment.args?.coupledAxisAtomIds, expectedCoupledAxes);
  assert.equal(alignment.args?.designerPrimaryRotationDegrees, 150);
  assert.deepEqual(alignment.args?.allowedResponseAtoms,
    PHE890_RESPONSE_ATOMS);
  assert.equal(alignment.args?.contactId,
    directionalContact.result.contact.contactId,
  'directional geometry does not use the declared contactId');
  const move = alignment.result?.designerBranchContact;
  assert.equal(move?.coordinateOrigin, 'current-visible-molecule');
  assert.equal(move?.externalReferenceCoordinatesUsed, false);
  assert.equal(move?.solution, 'best-directional');
  assert.equal(move?.contactId, directionalContact.result.contact.contactId);
  assert.deepEqual(move?.orderedAxisAtomIds, expectedPrimaryAxis);
  assert.deepEqual(move?.coupledAxisAtomIds, expectedCoupledAxes);
  assert.deepEqual(move?.allowedResponseAtoms, PHE890_RESPONSE_ATOMS);
  assert.deepEqual(move?.allowedResponseResidues,
    [{ residueName:'PHE', chain:'A', residueIndex:890, insertionCode:'' }],
  'derived response-residue audit grouping is not Phe890-only');
  assert.equal(move?.selected?.designerPrimaryRotationDegrees, 150);
  if (referenceInformed) {
    const upstreamIds = ['N7','C12'].map((name) => stagedIds.get(name));
    assert(upstreamIds.every(Boolean));
    assert.deepEqual(alignment.args.upstreamAxisAtomIds, upstreamIds);
    assert.deepEqual(alignment.args.upstreamRotationRangeDegrees, [0,60]);
    assert.deepEqual(move.upstreamAxisAtomIds, upstreamIds);
    assert.deepEqual(move.upstreamRotationRangeDegrees, [0,60]);
    assert(move.selected.upstreamRotationDegrees >= 0 && move.selected.upstreamRotationDegrees <= 60);
    assert.equal(move.selected.internalSevereContactCount, 0);
  }
  assert.equal(move?.selected?.contactGeometry?.dhaAngleDegrees >= 150, true,
    'designer contact does not satisfy the 150 degree directional H-bond gate');
  assert.equal(move?.selected?.contacts?.outsideAllowedResponseContactCount, 0,
    'designer geometry permits a severe response outside Phe890');
  assert(hingeContact.sequence < alignment.sequence
    && directionalContact.sequence < alignment.sequence,
  'designer contact hypotheses must be recorded before directional geometry is applied');
  const lock = records.find((record) => record.action === 'pose.setDesignerLigandPoseFixed');
  assert(alignment.sequence < lock?.sequence,
    'designer ligand lock must be recorded after directional geometry is applied');
  assert.equal(lock?.args?.fixed, true);
  assert.equal(lock?.result?.designerFixedLigandPose?.active, true);
  assertDigest(lock?.result?.designerFixedLigandPose?.lockId, 'designer ligand lock ID');
  const enumeration = records.find((record) =>
    record.action === 'pose.enumerateSidechainRotamers');
  assert.equal(enumeration?.result?.sidechainRotamers?.designerFixedLigandPose?.lockId,
    lock.result.designerFixedLigandPose.lockId);
  assert.equal(enumeration?.result?.sidechainRotamers?.ligandPosePolicy,
    'designer-fixed; receptor branches were ranked without generating or reranking ligand poses');
  assert.equal(enumeration?.result?.sidechainRotamers?.generatedCandidateCount,
    enumeration?.result?.sidechainRotamers?.candidates?.length,
  'Phe890 enumeration does not retain every generated candidate');
  const application = records.findLast((record) =>
    record.action === 'pose.applySidechainRotamer');
  assert.equal(application?.result?.sidechainRotamer?.designerFixedLigandPose?.lockId,
    lock.result.designerFixedLigandPose.lockId);
  assert(Array.isArray(application?.result?.sidechainRotamer?.chiDegrees)
    && application.result.sidechainRotamer.chiDegrees.every(Number.isFinite),
  'selected Phe890 response lacks a portable chi-angle identity');
  assert.equal(manifest.designerFixedLigandPose?.lockId,
    lock.result.designerFixedLigandPose.lockId);
  assert.equal(inspection.designerFixedLigandPose?.lockId,
    lock.result.designerFixedLigandPose.lockId);
  assert.equal(manifest.scientificContract?.designerFixedLigandPoseLockId,
    lock.result.designerFixedLigandPose.lockId);

  const candidateDescriptors = manifest.phe890Selection?.candidateFiles;
  const generatedCount = manifest.phe890Selection?.generatedCandidateCount;
  assert(Array.isArray(candidateDescriptors) && candidateDescriptors.length > 0,
    'prediction manifest lacks saved Phe890 candidate coordinates');
  assert.equal(generatedCount, manifest.phe890Selection?.evaluatedCandidateCount);
  assert.equal(generatedCount, candidateDescriptors.length);
  assert.equal(manifest.phe890Selection?.everyGeneratedCandidateEvaluated, true);
  assert.equal(calculations.length, generatedCount,
    'run does not contain exactly one energy calculation per generated candidate');
  assert.deepEqual(manifest.evidence?.phe890Candidates, candidateDescriptors,
    'candidate coordinate evidence is not hash-bound by the manifest');
  assert.deepEqual(inspection.phe890CandidateFiles?.map((entry) => entry.file),
    candidateDescriptors, 'coordinate inspection does not bind every candidate file');
  const enumeratedHashes = enumeration.result.sidechainRotamers.candidates
    .map((candidate) => candidate.coordinateSha256);
  assert.equal(new Set(enumeratedHashes).size, generatedCount);
  const candidateEvidence = [];
  for (const [index, descriptor] of candidateDescriptors.entries()) {
    const candidateFile = await readJson(resolve(directory, descriptor.filename),
      `Phe890 candidate ${index + 1}`);
    assert.equal(candidateFile.bytes.length, descriptor.bytes);
    assert.equal(sha256(candidateFile.bytes), descriptor.sha256);
    const candidate = candidateFile.value;
    assert.equal(candidate.ordinal, index + 1);
    assert.equal(candidate.coordinatesSaved, true);
    assert(enumeratedHashes.includes(candidate.coordinateSha256));
    assert.equal(inspection.phe890CandidateFiles[index].ordinal, index + 1);
    assert.equal(inspection.phe890CandidateFiles[index].coordinateSha256,
      candidate.coordinateSha256);
    assert(Array.isArray(candidate.ligand?.atoms) && candidate.ligand.atoms.length > 0);
    assert(Array.isArray(candidate.pocket?.atoms) && candidate.pocket.atoms.length > 0);
    assert.deepEqual(candidate.energy?.options, ENERGY_OPTIONS);
    assert.equal(candidate.energy?.job, 'energy');
    assert.equal(candidate.energy?.method, 'openmm');
    assert.equal(candidate.energy?.assertedZeroCoordinateMotion, true);
    assert.equal(candidate.energy?.result?.movedHeavyAtomCount, 0);
    assert.equal(candidate.energy?.result?.maximumDisplacementAngstrom, 0);
    candidateEvidence.push(candidate);
  }
  assert.deepEqual(new Set(candidateEvidence.map((candidate) => candidate.coordinateSha256)),
    new Set(enumeratedHashes), 'saved candidates do not cover the full enumeration');
  const eligible = candidateEvidence.filter((candidate) =>
    candidate.severeClashes === 0 && Number.isFinite(candidate.fullSystemEnergy))
    .sort((left, right) => left.fullSystemEnergy - right.fullSystemEnergy
      || JSON.stringify(left.chiDegrees).localeCompare(JSON.stringify(right.chiDegrees))
      || left.coordinateSha256.localeCompare(right.coordinateSha256));
  assert(eligible.length > 0, 'no finite clash-free candidate is available');
  assert.equal(manifest.phe890Selection.selectedCoordinateSha256,
    eligible[0].coordinateSha256,
  'frozen Phe890 response is not the energy-selected candidate');
  assert.equal(manifest.phe890Selection.selectedFullSystemEnergy,
    eligible[0].fullSystemEnergy);
  assert.equal(application.result.sidechainRotamer.selectedCoordinateSha256,
    eligible[0].coordinateSha256);
  assert.deepEqual(manifest.currentRun?.energyCalculations,
    calculations.map((record) => ({ requestId:record.requestId,
      job:record.args.job, method:record.args.method, options:record.args.options,
      movedHeavyAtomCount:record.result.calculation.movedHeavyAtomCount,
      maximumDisplacementAngstrom:record.result.calculation.maximumDisplacementAngstrom,
      assertedZeroCoordinateMotion:true })),
  'manifest energy evidence differs from the public action audit');
  assertNoHoldoutPayload(boundary, 'prospective boundary');
  assertNoHoldoutPayload(manifest, 'prediction manifest');
  assertNoHoldoutPayload(audit, 'Chemist Actions audit');
  assertNoHoldoutPayload(inspection, 'coordinate evidence');
  return Object.freeze({ directory, runId:basename(directory), root, referenceInformed, graphResume,
    manifest, manifestBytes:manifestFile.bytes, boundary, boundaryBytes:boundaryFile.bytes,
    audit, auditBytes:auditFile.bytes, inspection, inspectionBytes:inspectionFile.bytes,
    validation, validationBytes:validationFile.bytes,
    records, candidateEvidence, source:{ path:sourcePath, bytes:sourceBytes, campaign:sourceCampaign,
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
      designStage:asset.id,
      ...(index === 0 ? { registeredStartingHit:true, exactHistoryPrefix:true } : {}),
      calculationPolicy:'none', holdoutCoordinatesIncluded:false,
      checkpointSha256:asset.checkpointSha256, campaignSha256:asset.sha256,
      campaignId:asset.campaign.campaignId, branch:asset.branch,
      commitId:asset.commitId, snapshotId:asset.snapshotId } }));
  return validateActionScript({ schema:'molarium.chemist-action-script/v1',
    label:`SOS1 AWW designer-intent checkpoint review ${verified.runId}`,
    provenance:{ schema:REVIEW_SCHEMA, reviewOnly:true,
      sourceStatus:verified.referenceInformed ? 'reference-informed-designer-intent-receptor-response'
        : 'prospective-designer-intent-receptor-response',
      designerIntentReferenceInformed:verified.referenceInformed,
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
    [/record-designer-asn879-hypothesis$/, 'Record the N7 to Asn879 interaction hypothesis'],
    [/record-designer-tyr884-hypothesis$/, 'Record the OX3 to Tyr884 backbone-oxygen hypothesis'],
    [/align-designer-aww-branch-to-tyr884$/,
      'Choose the contact-compatible attachment direction explicitly'],
    [/fix-designer-ligand-intent$/, 'Fix the chemist-selected ligand pose'],
    [/enumerate-phe890$/, 'Enumerate receptor-only Phe890 responses'],
    [/energy-phe890-\d+$/, 'Measure one fixed-coordinate Phe890 candidate energy'],
    [/apply-energy-selected-phe890$/, 'Apply the energy-selected Phe890 response'],
  ];
  return captions.find(([pattern]) => pattern.test(id))?.[1]
    || id.replaceAll('-', ' ').replace(/^./, (character) => character.toUpperCase());
}

function executableScript(verified, upstream, sourceAwzSha256) {
  const upstreamRecords = upstream?.audit?.records || [];
  const cutoff = upstreamRecords.find((record) =>
    record.requestId === 'fragment-merge-capture-predicted-reference');
  assert(cutoff?.status === 'completed' && cutoff.action === 'pose.captureReference',
    'upstream audit lacks the exact post-AWZ reference-capture seam');
  const predecessor = upstream?.sourceCampaignSha256;
  assert.equal(predecessor, sourceAwzSha256,
    'upstream recomputation audit does not terminate at the imported AWZ source campaign');
  const prefix = upstreamRecords.filter((record) => record.sequence <= cutoff.sequence
    && record.status === 'completed');
  assert.deepEqual(prefix.filter((record) => record.action === 'designRoute.applyStep')
    .map((record) => record.args?.stepId), ['scaffold-rewrite','fragment-merge'],
  'upstream replay does not contain the ordered AWT and AWZ graph steps');
  const firstCurrent = verified.records.findIndex((record) =>
    record.action === 'designRoute.applyStep' && record.args?.stepId === 'open-phe890-pocket');
  let suffix;
  if (verified.graphResume) {
    const bridgeRecords = upstream.graphAudit?.records;
    assert(Array.isArray(bridgeRecords) && Buffer.isBuffer(upstream.graphAuditBytes),
      'graph resume requires the original hashable a010 graph-build audit');
    const graphImport = bridgeRecords.find((record) => record.action === 'campaign.import');
    assert.equal(graphImport?.args?.sourceSha256, sourceAwzSha256);
    const bridgeStart = bridgeRecords.findIndex((record) => record.action === 'designRoute.resume');
    const graphCommit = bridgeRecords.findIndex((record) => record.action === 'campaign.commitCurrent'
      && record.result?.campaignCommit?.commitId === verified.checkpoints.graphOnly.record.commitId);
    assert(bridgeStart >= 0 && graphCommit > bridgeStart,
      'original graph-build audit does not prove the resumed commit');
    const newStart = verified.records.findIndex((record) => record.action === 'designRoute.resume');
    assert(newStart >= 0, 'current run lacks its graph-resume action');
    suffix = [...bridgeRecords.slice(bridgeStart, graphCommit + 1), ...verified.records.slice(newStart)];
  } else {
    assert(firstCurrent >= 0, 'current run lacks its AWW graph step');
    suffix = verified.records.slice(firstCurrent);
  }
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
      ...(verified.graphResume ? { graphBuildAuditSha256:sha256(upstream.graphAuditBytes) } : {}),
      upstreamCutoffSequence:cutoff.sequence,
      sourceCampaignSha256:verified.source.sha256,
      designerIntentReferenceInformed:verified.referenceInformed,
      coordinatePolicy:'5OVE/AXE precursor plus public molecular-graph, contact, and directional-geometry actions; no later crystal coordinates',
      ligandIntent:'chemist-recorded contacts, +150 degree primary rotation, current-coordinate coupled-axis direction, then fixed ligand pose',
      receptorSelection:'minimum finite full-system OpenMM/OBC2 single-point energy among every zero-severe-clash Phe890 candidate',
      predictedDegreesOfFreedom:'Phe890 side chain only' },
  });
  assert.equal(script.actions[0].action, 'designRoute.load',
    'executable story must start from the registered 5OVE route, not a checkpoint import');
  assert(!script.actions.some((step) => step.action === 'campaign.import'),
    'executable story must not import the AWZ checkpoint');
  assert.deepEqual(script.actions.filter((step) => step.action === 'designRoute.applyStep')
    .map((step) => step.args.stepId),
  ['scaffold-rewrite','fragment-merge','open-phe890-pocket']);
  assert(!suffix.some((record) => PROHIBITED_ACTIONS.has(record.action)),
    'AWW executable story contains a prohibited legacy torsion or coupled calculation');
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
  { upstream, checkpointDirectory = SOS1_AWW_PUBLIC_CHECKPOINT_DIRECTORY } = {}) {
  assert(upstream?.audit && Buffer.isBuffer(upstream.auditBytes),
    'an explicit hashable upstream Chemist Actions audit is required');
  const chain = ancestry(verified.source.campaign);
  assert.equal(chain.length, verified.graphResume ? 4 : 3,
    'Source campaign must contain the prepared hit, AWT, AWZ, and optionally the resumed AWW graph commit');
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
  safePath(verified.root, checkpointDirectory, 'checkpoint asset directory');
  for (const asset of assets)
    asset.path = `${checkpointDirectory}/${basename(asset.path)}`;
  const executable = executableScript(verified, upstream, assets[2].sha256);
  const review = reviewScript(verified, assets);
  const executableBytes = jsonBytes(executable), reviewBytes = jsonBytes(review);
  const declaration = { schema:DECLARATION_SCHEMA,
    routeId:'sos1-hit-only', publicationClass:verified.referenceInformed
      ? 'reference-informed-designer-intent-receptor-response' : 'prospective-designer-intent-receptor-response',
    sourceRun:{ id:verified.runId,
      manifestSha256:sha256(verified.manifestBytes),
      auditSha256:sha256(verified.auditBytes),
      scientificValidationSha256:sha256(verified.validationBytes),
      sourceCampaignSha256:verified.source.sha256 },
    scientificContract:{ scope:'AWW designer-intent and receptor-response segment',
      precursorCoordinates:'registered 5OVE/AXE lineage',
      designerIntentReferenceInformed:verified.referenceInformed,
      laterCrystalCoordinatesUsed:false,
      ligandDirection:'explicit chemist contacts, +150 degree primary rotation, and current-coordinate coupled-axis branch alignment',
      ligandPoseFixedBeforePrediction:true, predictedDegreesOfFreedom:['PHE A890 side chain'],
      receptorSelection:'minimum finite full-system OpenMM/OBC2 single-point energy among every zero-severe-clash candidate',
      everyEnumeratedCandidateEvaluated:true,
      energyOptions:ENERGY_OPTIONS,
      poseRefinementUsed:false, optimizationUsed:false },
    scientificValidation:{ schema:VALIDATION_SCHEMA, accepted:verified.validation.accepted,
      predictionFrozenBeforeValidationAccess:!verified.referenceInformed,
      predictionFrozenBeforeNumericalComparison:true, measurementOnly:true,
      holdoutCoordinatesIncluded:false,
      failedChecks:structuredClone(verified.validation.failedChecks || []),
      phe890Accepted:verified.validation.checks.phe890.accepted,
      designerInteractionAccepted:verified.validation.checks.designerInteraction.accepted },
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
