#!/usr/bin/env node

import assert from 'node:assert/strict';
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { measureInspectedSidechainChiAngles } from '../docking/sidechain-rotamers.mjs';
import { verifyCampaign } from '../design-history/ledger.mjs';
import { deserializeCampaign, serializeCampaign } from
  '../design-history/live-campaign-store.mjs';
import { sha256, SOS1_STEP_IDS } from './sos1-accepted-run.mjs';

export const SOS1_RECOVERED_RUN_SCHEMA = 'molarium.sos1-recovered-run-assembly/v1';
const FIRST_STEPS = SOS1_STEP_IDS.slice(0, 3);
const ORIGINAL_MAX_SEQUENCE = 251;
const PHE890 = Object.freeze({ residueName:'PHE', chain:'A', residueIndex:890,
  insertionCode:'' });

const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const coordinateDigest = (inspection) => sha256(Buffer.from(JSON.stringify(
  inspection.atoms.map((atom) => [atom.atomId, atom.coordinatesAngstrom]))));
const periodicDistance = (first, second, period) =>
  Math.abs(((Number(first) - Number(second) + period / 2) % period + period) % period
    - period / 2);

function valueFor(args, name) {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
}

function exactRecord(records, requestId, action) {
  const matches = records.filter((record) => record.requestId === requestId
    && record.action === action && record.status === 'completed');
  assert.equal(matches.length, 1, `${requestId}: expected one completed ${action} record`);
  return matches[0];
}

/** Preserve every source action byte-for-byte except for its sequence in the joined
 * timeline and an explicit non-replay provenance annotation on retry actions. */
export function combineRecoveryAudits(originalAudit, recoveryAudit,
  { originalAttemptId = 'a013', recoveryAttemptId = 'a014' } = {}) {
  assert.equal(originalAudit?.schema, 'molarium.chemist-actions/v1');
  assert.equal(recoveryAudit?.schema, 'molarium.chemist-actions/v1');
  assert.equal(originalAudit.records?.length, ORIGINAL_MAX_SEQUENCE,
    `source attempt must contain exactly ${ORIGINAL_MAX_SEQUENCE} records`);
  assert.deepEqual(originalAudit.records.map((record) => record.sequence),
    Array.from({ length:ORIGINAL_MAX_SEQUENCE }, (_, index) => index + 1),
  'source attempt sequences are not contiguous');
  assert(recoveryAudit.records?.length > 0, 'recovery audit is empty');
  assert(recoveryAudit.records.every((record, index) => record.sequence === index + 1),
    'recovery audit sequences are not contiguous');
  const retryRecords = recoveryAudit.records.map((record) => ({ ...record,
    sequence:ORIGINAL_MAX_SEQUENCE + record.sequence,
    retryProvenance:{ schema:SOS1_RECOVERED_RUN_SCHEMA,
      attemptId:recoveryAttemptId, originalSequence:record.sequence,
      publicationReplay:false } }));
  return { schema:'molarium.chemist-actions/v1', routeId:'sos1-hit-only',
    status:'completed-with-recovery',
    replaySelection:{ schema:SOS1_RECOVERED_RUN_SCHEMA,
      sourceAttemptId:originalAttemptId, maximumSequence:ORIGINAL_MAX_SEQUENCE,
      excludedRecoveryAttemptId:recoveryAttemptId },
    records:[...originalAudit.records, ...retryRecords] };
}

async function readJson(path) {
  const bytes = await readFile(path);
  return { bytes, value:JSON.parse(bytes) };
}

async function requireCampaign(path, expectedSha256) {
  const bytes = await readFile(path);
  assert.equal(sha256(bytes), expectedSha256, 'recovery campaign hash changed');
  const serialized = bytes.toString('utf8');
  const campaign = deserializeCampaign(serialized);
  assert.equal(serializeCampaign(campaign), serialized,
    'recovery campaign is not canonically serialized');
  const verification = await verifyCampaign(campaign);
  assert.equal(verification.valid, true, `recovery campaign is invalid: ${verification.reason}`);
  return { bytes, campaign, verification };
}

function completeInspection(record, label) {
  const result = record.result;
  assert.equal(result?.truncated, false, `${label} is truncated`);
  assert.equal(result?.totalAtomCount, result?.atoms?.length, `${label} is incomplete`);
  assert(result.atoms.every((atom) => Array.isArray(atom.coordinatesAngstrom)
    && atom.coordinatesAngstrom.length === 3
    && atom.coordinatesAngstrom.every(Number.isFinite)), `${label} has invalid coordinates`);
  return result;
}

export async function assembleRecoveredSos1Run({ baseDirectory, recoveryDirectory,
  outputDirectory, baseAttemptId = 'a013', recoveryAttemptId = 'a014' }) {
  const base = resolve(baseDirectory), recovery = resolve(recoveryDirectory);
  const output = resolve(outputDirectory);
  try { await access(output); throw new Error(`Refusing to overwrite immutable run: ${output}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  const [{ bytes:failureBytes, value:failure },
    { bytes:baseAuditBytes, value:baseAudit },
    { bytes:resultBytes, value:result },
    { bytes:recoveryAuditBytes, value:recoveryAudit }] = await Promise.all([
    readJson(join(base, 'failed-run.json')), readJson(join(base, 'chemist-action-audit.json')),
    readJson(join(recovery, 'recovery-result.json')),
    readJson(join(recovery, 'chemist-action-audit.json')),
  ]);
  assert.equal(failure.schema, 'molarium.design-prediction-failure/v1');
  assert.equal(failure.routeId, 'sos1-hit-only');
  assert.deepEqual(failure.completedCheckpoints?.map((entry) => entry.stepId), FIRST_STEPS,
    'source attempt does not contain exactly the first three checkpoints');
  assert.equal(failure.auditRecords, ORIGINAL_MAX_SEQUENCE);
  assert.equal(failure.auditSha256, sha256(baseAuditBytes));
  assert.equal(result.status, 'completed', 'recovery did not complete');
  assert.equal(result.holdoutCoordinatesUsed, false, 'recovery used holdout coordinates');
  assert.equal(result.candidateGate?.passed, true, 'recovery candidate gate failed');
  assert.equal(result.fixedAtomGate?.passed, true, 'recovery fixed-atom gate failed');
  assert.equal(recoveryAudit.status, 'completed', 'recovery audit is not complete');

  const predecessorEntry = failure.completedCheckpoints[2];
  assert.equal(result.sourceCampaignSha256,
    predecessorEntry.fullSystemCampaign.sha256,
  'recovery did not start from the frozen open-Phe890 full-system campaign');
  const finalCampaignPath = join(recovery, result.export?.filename ||
    'finish-bay-293-campaign.json');
  const finalCampaign = await requireCampaign(finalCampaignPath, result.finalCampaignSha256);
  const branch = result.export.branch;
  const commitId = result.commit?.commitId;
  const snapshotId = result.commit?.snapshotId;
  assert.equal(finalCampaign.campaign.branches?.[branch], commitId,
    'recovery campaign branch does not select the recorded commit');
  assert.equal(finalCampaign.campaign.objects?.commits?.[commitId]?.snapshotId, snapshotId,
    'recovery commit does not select the recorded snapshot');

  const combinedAudit = combineRecoveryAudits(baseAudit, recoveryAudit,
    { originalAttemptId:baseAttemptId, recoveryAttemptId });
  const combinedSequence = (record) => ORIGINAL_MAX_SEQUENCE + record.sequence;
  const records = recoveryAudit.records;
  const staged = exactRecord(records, 'recovery-stage-final-axh', 'designRoute.applyStep');
  const refined = exactRecord(records, 'recovery-refine-final-axh', 'pose.refine');
  const parameterized = exactRecord(records, 'recovery-parameterize-final-axh',
    'protein.parameterize');
  const relaxed = exactRecord(records, 'recovery-relax-final-axh', 'optimization.run');
  const pocketRecord = exactRecord(records, 'recovery-inspect-post-relax-pocket',
    'session.inspect');
  const ligandRecord = exactRecord(records, 'recovery-inspect-final-ligand',
    'session.inspect');
  const routeRecord = exactRecord(records, 'recovery-inspect-final-route',
    'designRoute.inspect');
  const commitRecord = exactRecord(records, 'recovery-commit-final-full-system',
    'campaign.commitCurrent');
  const verifyRecord = exactRecord(records, 'recovery-verify-final-full-system',
    'campaign.verify');
  const exportRecord = exactRecord(records, 'recovery-export-final-full-system',
    'campaign.export');
  const captureRecord = exactRecord(records, 'recovery-capture-aww-reference',
    'pose.captureReference');
  const ligand = completeInspection(ligandRecord, 'final ligand inspection');
  const pocket = completeInspection(pocketRecord, 'final pocket inspection');

  const predecessor = (await readJson(join(base, predecessorEntry.filename))).value;
  const referenceChiDegrees = measureInspectedSidechainChiAngles({
    atoms:predecessor.pocket.atoms, residue:PHE890 });
  const finalChiDegrees = measureInspectedSidechainChiAngles({ atoms:pocket.atoms,
    residue:PHE890 });
  const chiPeriodsDegrees = [360,180];
  const differencesDegrees = referenceChiDegrees.map((value, index) =>
    periodicDistance(finalChiDegrees[index], value, chiPeriodsDegrees[index]));
  const sidechainContinuity = { schema:'molarium.sidechain-state-continuity/v1',
    residue:'PHE A890', source:'preceding frozen prediction', referenceChiDegrees,
    finalChiDegrees, differencesDegrees, chiPeriodsDegrees,
    maximumDifferenceDegrees:30,
    accepted:differencesDegrees.every((value) => value <= 30) };
  assert.equal(sidechainContinuity.accepted, true,
    'recovered final Phe890 state left the frozen predecessor rotamer basin');

  const campaignFilename = 'finish-bay-293-campaign.json';
  const campaignRecord = { schema:'molarium.full-system-checkpoint/v1',
    campaignId:finalCampaign.campaign.campaignId, branch, commitId, snapshotId,
    filename:campaignFilename, sha256:sha256(finalCampaign.bytes),
    bytes:finalCampaign.bytes.length,
    commitActionSequence:combinedSequence(commitRecord),
    exportActionSequence:combinedSequence(exportRecord),
    verification:verifyRecord.result.campaignVerification };
  const finalCheckpoint = { schema:'molarium.design-prediction-checkpoint/v1',
    routeId:'sos1-hit-only', stepId:'finish-bay-293',
    referenceStateId:staged.result.designStep.referenceStateId,
    predictedStateId:staged.result.designStep.stateId,
    frozenBeforeHoldoutAccess:true, boundary:predecessor.boundary,
    state:routeRecord.result.designRoute, staging:staged.result.designStep,
    refinement:refined.result.refinement,
    parameterization:parameterized.result.parameterization,
    rotamerDecision:null, relaxation:relaxed.result.optimization,
    sidechainContinuity, fullSystemCampaign:campaignRecord, ligand, pocket };
  const checkpointBytes = jsonBytes(finalCheckpoint);
  const checkpointEntry = { stepId:'finish-bay-293',
    predictedStateId:finalCheckpoint.predictedStateId,
    filename:'finish-bay-293-prediction.json', sha256:sha256(checkpointBytes),
    bytes:checkpointBytes.length, ligandCoordinateSha256:coordinateDigest(ligand),
    pocketCoordinateSha256:coordinateDigest(pocket),
    freezeActionSequence:combinedSequence(pocketRecord), fullSystemCampaign:campaignRecord };

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const routePath = join(root,
    'design-history/structures/generated/sos1-prospective-campaign.json');
  const routeBytes = await readFile(routePath);
  const auditProvenance = { schema:SOS1_RECOVERED_RUN_SCHEMA,
    original:{ attemptId:baseAttemptId, failedRunSha256:sha256(failureBytes),
      auditSha256:sha256(baseAuditBytes), maximumSequence:ORIGINAL_MAX_SEQUENCE },
    recovery:{ attemptId:recoveryAttemptId, resultSha256:sha256(resultBytes),
      auditSha256:sha256(recoveryAuditBytes), campaignSha256:sha256(finalCampaign.bytes) },
    finalStepAudit:{ captureActionSequence:combinedSequence(captureRecord),
      stageActionSequence:combinedSequence(staged),
      freezeActionSequence:combinedSequence(pocketRecord),
      commitActionSequence:combinedSequence(commitRecord),
      exportActionSequence:combinedSequence(exportRecord) } };
  combinedAudit.retryProvenance = auditProvenance;
  const auditBytes = jsonBytes(combinedAudit);
  const manifest = { schema:'molarium.design-prediction-run/v1',
    routeId:'sos1-hit-only', status:'predictions-frozen-holdouts-unopened',
    publicationEligible:true,
    protocol:{ initialCoordinateInput:'PDB 5OVE/AXE only',
      sequentialPredictedReferences:true, relaxMethod:failure.relaxMethod,
      phe890Branching:{ diagnosticOnly:false,
        diagnosticExactCoordinateSha256:null } },
    checkpoints:[...failure.completedCheckpoints, checkpointEntry],
    agentApi:{ schema:'molarium.chemist-actions/v1',
      actions:[...new Set(combinedAudit.records.map((record) => record.action))],
      auditRecords:combinedAudit.records.length, auditSha256:sha256(auditBytes),
      replaySelection:combinedAudit.replaySelection },
    inputs:{ campaign:{ path:relative(root, routePath), sha256:sha256(routeBytes) } },
    retryProvenance:auditProvenance };

  await mkdir(output, { recursive:false });
  for (const entry of failure.completedCheckpoints) {
    await cp(join(base, entry.filename), join(output, entry.filename), { errorOnExist:true });
    await cp(join(base, entry.fullSystemCampaign.filename),
      join(output, entry.fullSystemCampaign.filename), { errorOnExist:true });
  }
  await writeFile(join(output, campaignFilename), finalCampaign.bytes);
  await writeFile(join(output, checkpointEntry.filename), checkpointBytes);
  await writeFile(join(output, 'chemist-action-audit.json'), auditBytes);
  await writeFile(join(output, 'recovery-assembly.json'), jsonBytes(auditProvenance));
  await writeFile(join(output, 'prediction-manifest.json'), jsonBytes(manifest));
  return { output, manifest, audit:combinedAudit, finalCheckpoint };
}

export async function main(args = process.argv.slice(2)) {
  const baseDirectory = valueFor(args, '--base-run');
  const recoveryDirectory = valueFor(args, '--recovery-run');
  const outputDirectory = valueFor(args, '--output');
  const baseAttemptId = valueFor(args, '--base-attempt');
  const recoveryAttemptId = valueFor(args, '--recovery-attempt');
  if (!baseDirectory || !recoveryDirectory || !outputDirectory) throw new Error(
    'Usage: node scripts/assemble-sos1-recovered-run.mjs --base-run <a013-run-directory> --recovery-run <successful-recovery-directory> --output <new-directory> [--base-attempt a013 --recovery-attempt a018]');
  const assembled = await assembleRecoveredSos1Run({ baseDirectory, recoveryDirectory,
    outputDirectory,
    ...(baseAttemptId ? { baseAttemptId } : {}),
    ...(recoveryAttemptId ? { recoveryAttemptId } : {}) });
  process.stdout.write(`${JSON.stringify({ output:assembled.output,
    predictionManifestSha256:sha256(jsonBytes(assembled.manifest)),
    auditSha256:assembled.manifest.agentApi.auditSha256 }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
