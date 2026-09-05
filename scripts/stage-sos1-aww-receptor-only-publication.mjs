#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionScriptFromAudit, actionScriptSha256, validateActionScript } from '../design-history/replay.mjs';
import { verifyAxhContinuation } from './sos1-axh-continuation.mjs';
import { buildSos1AwwReceptorOnlyPublicationRecords, sha256,
  verifySos1AwwReceptorOnlyRun } from './sos1-aww-receptor-only-publication.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runArg = process.argv[2];
assert(runArg, 'Usage: bun scripts/stage-sos1-aww-receptor-only-publication.mjs <frozen-run>');
const run = resolve(root, runArg);
const completeFrozen = process.argv.includes('--complete-frozen');
const verified = await verifySos1AwwReceptorOnlyRun(run,
  { root, requireAccepted:!completeFrozen });
const axhIndex = process.argv.indexOf('--axh-run');
const axh = axhIndex < 0 ? null : await verifyAxhContinuation(resolve(root, process.argv[axhIndex + 1]), verified);
const publicationIndex = process.argv.indexOf('--publication-name');
const publicationName = publicationIndex < 0 ? (axh ? 'publication-with-axh' : 'publication')
  : process.argv[publicationIndex + 1];
assert(/^publication(?:-[a-z0-9]+)*$/.test(publicationName), 'Invalid immutable publication name');
const output = resolve(run, publicationName);
const assetDirectory = `${relative(root, output)}/checkpoints`;
const auditBytes = await readFile(resolve(root,
  'design-history/publications/sos1/source-runs/sos1-a013-a018-complete-frozen/chemist-action-audit.json'));
const graphAuditBytes = verified.graphResume
  ? await readFile(resolve(dirname(verified.source.path), 'chemist-action-audit.json')) : null;
let records = await buildSos1AwwReceptorOnlyPublicationRecords(verified, {
  checkpointDirectory:assetDirectory,
  upstream:{ audit:JSON.parse(auditBytes), auditBytes,
    sourceCampaignSha256:'e1a7722f517b5371efad860dc6d87bf31d813b05df6c3e72db74e71e3236cb81',
    ...(graphAuditBytes ? { graphAudit:JSON.parse(graphAuditBytes), graphAuditBytes } : {}) },
});
if (axh) {
  const asset = { id:'finish-bay-293', path:`${assetDirectory}/finish-bay-293-campaign.json`,
    bytes:axh.bytes, sha256:sha256(axh.bytes), commitId:axh.record.commitId, snapshotId:axh.record.snapshotId };
  const suffix = actionScriptFromAudit({ schema:'molarium.chemist-action-audit/v1',
    routeId:'sos1-hit-only', records:axh.records.slice(2) }, {
    label:'Native AXH continuation', includeReadOnly:true, includeAuditMetadata:true,
    stateHashGuards:'off', executionContract:'portable-scientific',
  });
  const executable = validateActionScript({ ...records.executable,
    label:'SOS1 hit to BAY-293 · reference-informed designer-intent replay',
    actions:[...records.executable.actions, ...suffix.actions],
    provenance:{ ...records.executable.provenance, continuationManifestSha256:sha256(axh.manifestBytes),
      continuationAuditSha256:sha256(axh.auditBytes) } });
  const review = validateActionScript({ ...records.review,
    label:'SOS1 hit to BAY-293 · exact reference-informed checkpoints',
    actions:[...records.review.actions, { action:'campaign.import',
      args:{ sourcePath:`./${asset.path}`, sourceSha256:asset.sha256, preserveView:true },
      expect:{ 'campaignImport.viewPreserved':true }, caption:'Review the BAY-293 attachment rewrite',
      review:{ designStage:asset.id, immutableSnapshot:true, calculationPolicy:'none',
        holdoutCoordinatesIncluded:false, campaignSha256:asset.sha256,
        campaignId:axh.campaign.campaignId, branch:'main',
        commitId:asset.commitId, snapshotId:asset.snapshotId } }] });
  records = { ...records, executable, review,
    executableBytes:Buffer.from(`${JSON.stringify(executable, null, 2)}\n`),
    reviewBytes:Buffer.from(`${JSON.stringify(review, null, 2)}\n`),
    campaignAssets:[...records.campaignAssets, asset],
    declaration:{ ...records.declaration,
      sourceContinuation:{ directory:relative(root, axh.directory),
        manifestSha256:sha256(axh.manifestBytes), comparisonSha256:sha256(axh.comparisonBytes) },
      checkpoints:[...records.declaration.checkpoints, { id:asset.id, path:asset.path,
        sha256:asset.sha256, commitId:asset.commitId, snapshotId:asset.snapshotId }] } };
}
await mkdir(output);
await mkdir(resolve(output, 'checkpoints'));
for (const asset of records.campaignAssets)
  await writeFile(resolve(root, asset.path), asset.bytes, { flag:'wx' });
const scripts = {};
for (const [kind, script, bytes] of [
  ['executable', records.executable, records.executableBytes],
  ['checkpoint-review', records.review, records.reviewBytes],
]) {
  const path = `${relative(root, output)}/${kind}.action-script.json`;
  await writeFile(resolve(root, path), bytes, { flag:'wx' });
  scripts[kind] = { path, sha256:sha256(bytes), actionScriptSha256:await actionScriptSha256(script) };
}
const declaration = { ...records.declaration, stagedOnly:true,
  resultClass:completeFrozen ? 'designer-intent-frozen' : 'designer-intent',
  sourceRun:{ ...records.declaration.sourceRun, directory:relative(root, run) },
  executableReplay:scripts.executable, checkpointReview:scripts['checkpoint-review'] };
await writeFile(resolve(output, 'declaration.json'), `${JSON.stringify(declaration, null, 2)}\n`, { flag:'wx' });
console.log(JSON.stringify({ output:relative(root, output), checkpoints:records.campaignAssets.length, scripts }, null, 2));
