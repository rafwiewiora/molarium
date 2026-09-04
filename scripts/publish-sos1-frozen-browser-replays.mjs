#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exactCampaignHistoryPrefix, frozenCheckpointReviewScript } from
  '../design-history/frozen-checkpoint-review.mjs';
import { serializeCampaign } from '../design-history/live-campaign-store.mjs';
import { actionScriptSha256 } from '../design-history/replay.mjs';
import { buildFrozenSos1ReplayScript, requireExplicitRunDirectory, sha256,
  SOS1_STEP_IDS, verifyCompleteFrozenSos1Run } from './sos1-accepted-run.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SOS1_PREDICTION_REPLAY =
  'design-history/examples/sos1-prediction.action-script.json';
export const SOS1_PREDICTION_REVIEW =
  'design-history/examples/sos1-prediction-checkpoint-review.action-script.json';
export const SOS1_PREDICTION_DECLARATION =
  'design-history/publications/sos1/browser-replay-declaration.json';
export const SOS1_PREDICTION_CAMPAIGN_DIRECTORY =
  'design-history/publications/sos1/checkpoints';
export const SOS1_STARTING_HIT_CAMPAIGN =
  `${SOS1_PREDICTION_CAMPAIGN_DIRECTORY}/starting-hit-campaign.json`;

const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function evaluationOutcome(verified) {
  return { schema:'molarium.sos1-post-freeze-evaluation-outcome/v1',
    attached:true, summarySha256:sha256(verified.evaluationBytes),
    accepted:verified.evaluation.accepted === true,
    continuityAccepted:verified.evaluation.continuity?.accepted === true,
    failedStepIds:verified.evaluation.results.filter((entry) => entry.accepted !== true)
      .map((entry) => entry.stepId),
    results:verified.evaluation.results.map((entry) => ({ stepId:entry.stepId,
      accepted:entry.accepted === true, failedChecks:[...entry.failedChecks] })) };
}

function reviewCheckpoint(verified, stepId) {
  const frozen = verified.checkpoints.get(stepId);
  const fullSystem = frozen.fullSystemCampaign;
  return { completeFrozenPrediction:true, frozenBeforeHoldoutAccess:true,
    checkpointSha256:frozen.entry.sha256,
    campaignSha256:fullSystem.record.sha256,
    campaignPath:`./${SOS1_PREDICTION_CAMPAIGN_DIRECTORY}/${stepId}-campaign.json`,
    campaignId:fullSystem.record.campaignId,
    branch:fullSystem.record.branch, commitId:fullSystem.record.commitId,
    snapshotId:fullSystem.record.snapshotId, label:`${stepId} prediction checkpoint` };
}

async function startingHitReviewRecord(verified) {
  const scaffold = verified.checkpoints.get('scaffold-rewrite')?.fullSystemCampaign;
  assert(scaffold, 'scaffold-rewrite full-system campaign is unavailable');
  const scaffoldHead = scaffold.campaign.objects?.commits?.[scaffold.record.commitId];
  assert.equal(scaffoldHead?.parents?.length, 1,
    'scaffold-rewrite must have one exact prepared-hit parent commit');
  const commitId = scaffoldHead.parents[0];
  const commit = scaffold.campaign.objects.commits[commitId];
  assert.equal(commit?.parents?.length, 0,
    'prepared 5OVE/AXE coordinate boundary must be the root commit');
  const campaign = await exactCampaignHistoryPrefix(scaffold.campaign, commitId);
  const serializedCampaign = serializeCampaign(campaign);
  const bytes = Buffer.from(serializedCampaign);
  const snapshotId = commit.snapshotId;
  assert.deepEqual(campaign.objects.snapshots[snapshotId],
    scaffold.campaign.objects.snapshots[snapshotId],
    'starting-hit history prefix changed the exact molecular snapshot');
  const campaignSha256 = sha256(bytes);
  return Object.freeze({
    checkpoint:{ registeredStartingHit:true, exactHistoryPrefix:true,
      frozenBeforeHoldoutAccess:true,
      checkpointSha256:snapshotId.replace(/^snapshot:/, ''), campaignSha256,
      campaignPath:`./${SOS1_STARTING_HIT_CAMPAIGN}`,
      campaignId:campaign.campaignId, branch:commit.branch, commitId, snapshotId,
      label:'the exact prepared 5OVE/AXE starting hit' },
    asset:{ stepId:'starting-hit', path:SOS1_STARTING_HIT_CAMPAIGN,
      sha256:campaignSha256, bytes },
  });
}

export const SOS1_CHECKPOINT_GRANULARITY = Object.freeze({
  schema:'molarium.checkpoint-review-granularity/v1',
  startingHitIncluded:true,
  startingHitSource:'exact scaffold-rewrite campaign history prefix',
  syntheticCoordinatesUsed:false,
  independentlyCommittedStates:Object.freeze([
    'registered-starting-hit', 'scaffold-rewrite', 'fragment-merge',
    'open-phe890-pocket', 'finish-bay-293',
  ]),
  unavailableIndependentStates:Object.freeze([
    'compound-21-graph-edit-before-phe890-rotamer',
    'phe890-rotamer-before-coupled-relaxation',
  ]),
  limitation:'The source run did not commit separate full-system snapshots between compound-21 graph editing, Phe890 rotamer application, and coupled relaxation. The calculation-free review therefore keeps those operations in their single exact open-phe890-pocket checkpoint and does not synthesize intermediate coordinates.',
});

export async function buildFrozenBrowserPublicationRecords(verified,
  { sourceRunDirectory = null } = {}) {
  assert.deepEqual([...verified.checkpoints.keys()], SOS1_STEP_IDS,
    'prediction browser publication requires the complete ordered SOS1 route');
  const replay = await buildFrozenSos1ReplayScript(verified);
  const replayBytes = jsonBytes(replay.script);
  const postFreezeEvaluation = evaluationOutcome(verified);
  const startingHit = await startingHitReviewRecord(verified);
  const review = await frozenCheckpointReviewScript({
    label:`SOS1 prediction checkpoint review ${verified.runId}`,
    checkpoints:[startingHit.checkpoint,
      ...SOS1_STEP_IDS.map((stepId) => reviewCheckpoint(verified, stepId))],
    postFreezeEvaluation, coordinateGranularity:SOS1_CHECKPOINT_GRANULARITY,
  });
  const reviewBytes = jsonBytes(review);
  const campaignAssets = [startingHit.asset, ...SOS1_STEP_IDS.map((stepId) => {
    const fullSystem = verified.checkpoints.get(stepId).fullSystemCampaign;
    return { stepId, path:`${SOS1_PREDICTION_CAMPAIGN_DIRECTORY}/${stepId}-campaign.json`,
      sha256:fullSystem.record.sha256, bytes:fullSystem.campaignBytes };
  })];
  const declaration = {
    schema:'molarium.sos1-frozen-browser-publication/v1',
    routeId:'sos1-hit-only', publicationClass:'complete-frozen-prediction',
    sourceRun:{ id:verified.runId,
      ...(sourceRunDirectory ? { directory:sourceRunDirectory } : {}),
      predictionManifestSha256:sha256(verified.manifestBytes),
      sourceAuditSha256:sha256(verified.auditBytes),
      checkpoints:SOS1_STEP_IDS.map((stepId) => ({ stepId,
        sha256:verified.checkpoints.get(stepId).entry.sha256,
        fullSystemCampaignSha256:
          verified.checkpoints.get(stepId).fullSystemCampaign.record.sha256,
        publishedCampaignPath:campaignAssets.find((asset) => asset.stepId === stepId).path })) },
    postFreezeEvaluation,
    executableReplay:{ path:SOS1_PREDICTION_REPLAY, sha256:sha256(replayBytes),
      actionScriptSha256:await actionScriptSha256(replay.script),
      publicUrl:'/sos1-hit-to-bay293' },
    checkpointReview:{ path:SOS1_PREDICTION_REVIEW, sha256:sha256(reviewBytes),
      actionScriptSha256:await actionScriptSha256(review), calculationPolicy:'none',
      promotable:false, publicUrl:'/sos1-hit-to-bay293/review',
      startingHit:{ campaignPath:SOS1_STARTING_HIT_CAMPAIGN,
        campaignSha256:startingHit.asset.sha256,
        commitId:startingHit.checkpoint.commitId,
        snapshotId:startingHit.checkpoint.snapshotId,
        source:'exact scaffold-rewrite campaign history prefix' } },
  };
  return Object.freeze({ replay:replay.script, replayBytes, review, reviewBytes,
    campaignAssets, declaration, declarationBytes:jsonBytes(declaration) });
}

function registryBounds(source) {
  const start = source.indexOf('const DESIGNER_STORY_LINKS');
  assert(start >= 0, 'Missing DESIGNER_STORY_LINKS');
  const close = source.indexOf('\n});', start);
  assert(close > start, 'Cannot locate DESIGNER_STORY_LINKS terminator');
  return { start, close };
}

function entryBounds(source, key) {
  const registry = registryBounds(source);
  const keyAt = source.indexOf(`'${key}'`, registry.start);
  if (keyAt < 0 || keyAt > registry.close) return null;
  const start = source.lastIndexOf('\n', keyAt) + 1;
  const objectAt = source.indexOf('Object.freeze({', keyAt);
  let depth = 0, quote = null, escaped = false, close = -1;
  for (let index = source.indexOf('{', objectAt); index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
    } else if ('\'"`'.includes(character)) quote = character;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) { close = index; break; }
  }
  assert(close >= 0, `Unclosed DESIGNER_STORY_LINKS.${key}`);
  const comma = source.indexOf(',', close);
  assert(comma >= 0, `Malformed DESIGNER_STORY_LINKS.${key}`);
  return { start, end:source[comma + 1] === '\n' ? comma + 2 : comma + 1 };
}

function setStory(source, key, record) {
  const existing = entryBounds(source, key);
  let result = existing
    ? source.slice(0, existing.start) + source.slice(existing.end) : source;
  const { close } = registryBounds(result);
  return `${result.slice(0, close)}\n  '${key}':Object.freeze({\n${record}\n  }),${result.slice(close)}`;
}

function addReviewedFiles(source, name, paths) {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\];`));
  assert(match, `Missing ${name} array`);
  const existing = match[1].split('\n').filter(Boolean);
  const additions = paths.filter((path) => !existing.some((line) => line.includes(`'${path}'`)))
    .map((path) => `  '${path}',`);
  return source.slice(0, match.index)
    + `const ${name} = [\n${[...additions, ...existing].join('\n')}\n];`
    + source.slice(match.index + match[0].length);
}

export function rewriteFrozenBrowserIntegration({ appSource, buildSource, manifestSource },
  records) {
  let app = setStory(appSource, 'sos1-hit-to-bay293',
    `    title:'SOS1 prediction replay',\n    script:'./${SOS1_PREDICTION_REPLAY}',\n`
    + `    sourcePath:'${SOS1_PREDICTION_REPLAY}',\n`
    + `    sourceSha256:'${sha256(records.replayBytes)}',\n`
    + `    presentation:'chemist-pocket',`);
  app = setStory(app, 'sos1-hit-to-bay293-review',
    `    title:'SOS1 prediction checkpoint review',\n`
    + `    script:'./${SOS1_PREDICTION_REVIEW}',\n`
    + `    sourcePath:'${SOS1_PREDICTION_REVIEW}',\n`
    + `    sourceSha256:'${sha256(records.reviewBytes)}',\n`
    + `    presentation:'chemist-pocket',`);
  const paths = [SOS1_PREDICTION_REPLAY, SOS1_PREDICTION_REVIEW,
    SOS1_PREDICTION_DECLARATION,
    ...(records.campaignAssets || []).map((asset) => asset.path)];
  return { appSource:app, buildSource:addReviewedFiles(buildSource, 'files', paths),
    manifestSource:addReviewedFiles(manifestSource, 'reviewedFiles', paths) };
}

async function atomicWrite(path, bytes) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, bytes);
  await rename(temporary, path);
}

export async function writeFrozenBrowserPublication(verified, { root = ROOT } = {}) {
  assert.equal(resolve(root), ROOT,
    'Frozen browser publication only writes the checked-out production repository');
  const sourceRunDirectory = relative(root, verified.directory);
  assert(sourceRunDirectory && sourceRunDirectory !== '..'
    && !sourceRunDirectory.startsWith(`..${sep}`),
  'source run must be preserved inside the production repository');
  const records = await buildFrozenBrowserPublicationRecords(verified,
    { sourceRunDirectory });
  const [appSource, buildSource, manifestSource] = await Promise.all([
    readFile(resolve(root, 'app.js'), 'utf8'),
    readFile(resolve(root, 'scripts/build-web.mjs'), 'utf8'),
    readFile(resolve(root, 'scripts/generate-local-lab-manifest.mjs'), 'utf8'),
  ]);
  const rewritten = rewriteFrozenBrowserIntegration({ appSource, buildSource,
    manifestSource }, records);
  await mkdir(resolve(root, SOS1_PREDICTION_CAMPAIGN_DIRECTORY), { recursive:true });
  await Promise.all([
    atomicWrite(resolve(root, SOS1_PREDICTION_REPLAY), records.replayBytes),
    atomicWrite(resolve(root, SOS1_PREDICTION_REVIEW), records.reviewBytes),
    atomicWrite(resolve(root, 'app.js'), Buffer.from(rewritten.appSource)),
    atomicWrite(resolve(root, 'scripts/build-web.mjs'), Buffer.from(rewritten.buildSource)),
    atomicWrite(resolve(root, 'scripts/generate-local-lab-manifest.mjs'),
      Buffer.from(rewritten.manifestSource)),
    ...records.campaignAssets.map((asset) =>
      atomicWrite(resolve(root, asset.path), asset.bytes)),
  ]);
  await atomicWrite(resolve(root, SOS1_PREDICTION_DECLARATION), records.declarationBytes);
  return records.declaration;
}

export async function main(argv = process.argv.slice(2)) {
  const runDirectory = requireExplicitRunDirectory(argv, { root:ROOT });
  const verified = await verifyCompleteFrozenSos1Run(runDirectory);
  const records = await buildFrozenBrowserPublicationRecords(verified);
  if (!argv.includes('--execute')) {
    process.stdout.write(`${JSON.stringify({ execute:false, declaration:records.declaration }, null, 2)}\n`);
    return;
  }
  const declaration = await writeFrozenBrowserPublication(verified);
  process.stdout.write(`${JSON.stringify({ execute:true, declaration }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
