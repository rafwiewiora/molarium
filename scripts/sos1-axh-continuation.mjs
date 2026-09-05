import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { verifyCampaign } from '../design-history/ledger.mjs';
import { deserializeCampaign, serializeCampaign } from '../design-history/live-campaign-store.mjs';
import { sha256 } from './sos1-aww-receptor-only-publication.mjs';
import { finalDiagnosticGate } from './sos1-final-step-checkpoint.mjs';
import { fixedAtomRelaxationGate } from './recover-sos1-final-from-full-system-checkpoint.mjs';

export async function verifyAxhContinuation(directory, source) {
  directory = resolve(directory);
  const read = async (name) => { const bytes = await readFile(join(directory, name));
    return { bytes, value:JSON.parse(bytes) }; };
  const manifestFile = await read('continuation-manifest.json');
  const manifest = manifestFile.value;
  assert.equal(manifest.status, 'completed');
  assert.equal(manifest.designerIntentReferenceInformed, true);
  assert.equal(manifest.externalReferenceCoordinatesUsed, false);
  const bound = async (descriptor) => {
    assert.equal(basename(descriptor.filename), descriptor.filename);
    const file = await read(descriptor.filename);
    assert.equal(file.bytes.length, descriptor.bytes);
    assert.equal(sha256(file.bytes), descriptor.sha256);
    return file;
  };
  const boundary = (await bound(manifest.boundary)).value;
  assert.equal(boundary.sourceCampaignSha256, source.checkpoints.receptorResponse.record.sha256);
  assert.equal(boundary.externalReferenceCoordinatesUsed, false);
  const auditFile = await bound(manifest.audit);
  const records = auditFile.value.records.filter((record) => /^axh-continuation-/.test(record.requestId));
  assert.equal(records.length, 29);
  assert(records.every((record) => record.status === 'completed'));
  assert.equal(records[0].action, 'campaign.import');
  assert.equal(records[0].args.sourceSha256, boundary.sourceCampaignSha256);
  assert.deepEqual(records.filter((record) => record.action === 'designRoute.applyStep')
    .map((record) => record.args.stepId), ['finish-bay-293']);
  const staged = records.find((record) => record.action === 'designRoute.applyStep').result.designStep;
  const featureIds = staged.poseTransferPlan.featureCorrespondences.filter((entry) => entry.required)
    .map((entry) => entry.id);
  assert(featureIds.length > 0);
  const refinementRecord = records.find((record) => record.action === 'pose.refine');
  assert.deepEqual(refinementRecord.args, { searchChains:8, execution:'serial', featureSeedingProtocol:'v5' });
  assert.equal(finalDiagnosticGate(refinementRecord.result.refinement, featureIds).passed, true);
  const optimization = records.find((record) => record.action === 'optimization.run').result.optimization;
  assert.equal(optimization.accepted, true);
  assert.equal(optimization.valenceSafeguard.accepted, true);
  assert.equal(optimization.valenceSafeguard.complete, true);
  assert.equal(optimization.registeredPoseRetention.accepted, true);
  const inspection = (label, scope) => records.find((record) =>
    record.requestId.endsWith(`-${label}-${scope}`)).result;
  const ligand = inspection('relaxed', 'ligand'), pocket = inspection('relaxed', 'pocket');
  const fixedGate = fixedAtomRelaxationGate({ before:inspection('selected', 'pocket'), after:pocket,
    fixedAtomIds:optimization.registeredPoseRetention.before.fixedAtomIds });
  assert.equal(fixedGate.passed, true);
  const finalRecord = manifest.checkpoints['finish-bay-293'];
  const finalFile = await bound(finalRecord);
  const campaign = deserializeCampaign(finalFile.bytes.toString());
  assert.equal(serializeCampaign(campaign), finalFile.bytes.toString());
  assert.equal((await verifyCampaign(campaign)).valid, true);
  assert.equal(campaign.branches.main, finalRecord.commitId);
  const snapshot = campaign.objects.snapshots[finalRecord.snapshotId];
  assert(snapshot.graph.atoms.length > 500);
  const positions = new Map(snapshot.coordinates.atomIds.map((id, index) =>
    [id, snapshot.coordinates.positions[index]]));
  for (const atom of [...ligand.atoms, ...pocket.atoms])
    assert.deepEqual(positions.get(atom.atomId), atom.coordinatesAngstrom);
  let ancestor = finalRecord.commitId;
  const sourceHead = source.checkpoints.receptorResponse.record.commitId;
  while (ancestor && ancestor !== sourceHead) ancestor = campaign.objects.commits[ancestor]?.parents?.[0];
  assert.equal(ancestor, sourceHead, 'AXH campaign is not descended from the corrected AWW state');
  const comparisonFile = await read('post-freeze-comparison.json');
  const comparison = comparisonFile.value;
  assert.equal(comparison.continuationManifestSha256, sha256(manifestFile.bytes));
  assert.equal(comparison.campaignSha256, sha256(finalFile.bytes));
  assert.equal(comparison.measurementOnly, true);
  assert.equal(comparison.holdoutCoordinatesIncluded, false);
  assert.equal(comparison.ligandIntegrity.valid, true);
  assert.equal(comparison.ligandIntegrity.proteinLigandSevereClashes, 0);
  assert.equal(comparison.ligandIntegrity.ligandInternalSevereClashes, 0);
  return { directory, runId:basename(directory), manifest, manifestBytes:manifestFile.bytes,
    boundary, records, auditBytes:auditFile.bytes, campaign, bytes:finalFile.bytes,
    record:finalRecord, comparison, comparisonBytes:comparisonFile.bytes };
}
