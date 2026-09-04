#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { frozenCheckpointReviewScript } from
  '../design-history/frozen-checkpoint-review.mjs';
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
    serializedCampaign:fullSystem.serializedCampaign,
    branch:fullSystem.record.branch, commitId:fullSystem.record.commitId,
    snapshotId:fullSystem.record.snapshotId, label:`${stepId} prediction checkpoint` };
}

export async function buildFrozenBrowserPublicationRecords(verified) {
  assert.deepEqual([...verified.checkpoints.keys()], SOS1_STEP_IDS,
    'prediction browser publication requires the complete ordered SOS1 route');
  const replay = await buildFrozenSos1ReplayScript(verified);
  const replayBytes = jsonBytes(replay.script);
  const postFreezeEvaluation = evaluationOutcome(verified);
  const review = await frozenCheckpointReviewScript({
    label:`SOS1 prediction checkpoint review ${verified.runId}`,
    checkpoints:SOS1_STEP_IDS.map((stepId) => reviewCheckpoint(verified, stepId)),
    postFreezeEvaluation,
  });
  const reviewBytes = jsonBytes(review);
  const declaration = {
    schema:'molarium.sos1-frozen-browser-publication/v1',
    routeId:'sos1-hit-only', publicationClass:'complete-frozen-prediction',
    sourceRun:{ id:verified.runId,
      predictionManifestSha256:sha256(verified.manifestBytes),
      sourceAuditSha256:sha256(verified.auditBytes),
      checkpoints:SOS1_STEP_IDS.map((stepId) => ({ stepId,
        sha256:verified.checkpoints.get(stepId).entry.sha256,
        fullSystemCampaignSha256:
          verified.checkpoints.get(stepId).fullSystemCampaign.record.sha256 })) },
    postFreezeEvaluation,
    executableReplay:{ path:SOS1_PREDICTION_REPLAY, sha256:sha256(replayBytes),
      actionScriptSha256:await actionScriptSha256(replay.script),
      publicUrl:'/sos1-hit-to-bay293' },
    checkpointReview:{ path:SOS1_PREDICTION_REVIEW, sha256:sha256(reviewBytes),
      actionScriptSha256:await actionScriptSha256(review), calculationPolicy:'none',
      promotable:false, publicUrl:'/sos1-hit-to-bay293/review' },
  };
  return Object.freeze({ replay:replay.script, replayBytes, review, reviewBytes,
    declaration, declarationBytes:jsonBytes(declaration) });
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
    + `    sourceSha256:'${sha256(records.reviewBytes)}',`);
  const paths = [SOS1_PREDICTION_REPLAY, SOS1_PREDICTION_REVIEW,
    SOS1_PREDICTION_DECLARATION];
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
  const records = await buildFrozenBrowserPublicationRecords(verified);
  const [appSource, buildSource, manifestSource] = await Promise.all([
    readFile(resolve(root, 'app.js'), 'utf8'),
    readFile(resolve(root, 'scripts/build-web.mjs'), 'utf8'),
    readFile(resolve(root, 'scripts/generate-local-lab-manifest.mjs'), 'utf8'),
  ]);
  const rewritten = rewriteFrozenBrowserIntegration({ appSource, buildSource,
    manifestSource }, records);
  await Promise.all([
    atomicWrite(resolve(root, SOS1_PREDICTION_REPLAY), records.replayBytes),
    atomicWrite(resolve(root, SOS1_PREDICTION_REVIEW), records.reviewBytes),
    atomicWrite(resolve(root, 'app.js'), Buffer.from(rewritten.appSource)),
    atomicWrite(resolve(root, 'scripts/build-web.mjs'), Buffer.from(rewritten.buildSource)),
    atomicWrite(resolve(root, 'scripts/generate-local-lab-manifest.mjs'),
      Buffer.from(rewritten.manifestSource)),
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
