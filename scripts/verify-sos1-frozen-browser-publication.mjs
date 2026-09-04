#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionScriptSha256, validateActionScript } from '../design-history/replay.mjs';
import { verifyCampaign } from '../design-history/ledger.mjs';
import { deserializeCampaign, serializeCampaign } from
  '../design-history/live-campaign-store.mjs';
import { buildFrozenSos1ReplayScript, sha256, SOS1_STEP_IDS,
  verifyCompleteFrozenSos1Run } from './sos1-accepted-run.mjs';
import { SOS1_PREDICTION_CAMPAIGN_DIRECTORY, SOS1_PREDICTION_DECLARATION,
  SOS1_PREDICTION_REPLAY, SOS1_PREDICTION_REVIEW } from
  './publish-sos1-frozen-browser-replays.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA256 = /^[a-f0-9]{64}$/;

function safePath(root, path, label) {
  assert(typeof path === 'string' && path && !isAbsolute(path),
    `${label} must be repository-relative`);
  const absolute = resolve(root, path);
  const fromRoot = relative(root, absolute);
  assert(fromRoot && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`),
    `${label} escapes the repository`);
  return absolute;
}

async function pinned(root, record, label) {
  assert(SHA256.test(record?.sha256 || ''), `${label}.sha256 is invalid`);
  const bytes = await readFile(safePath(root, record.path, `${label}.path`));
  assert.equal(sha256(bytes), record.sha256, `${label} changed`);
  return { bytes, value:JSON.parse(bytes) };
}

function registryEntry(source, id) {
  const start = source.indexOf(`'${id}':Object.freeze({`);
  assert(start >= 0, `application registry lacks ${id}`);
  const end = source.indexOf('}),', start);
  assert(end > start, `application registry entry ${id} is malformed`);
  return source.slice(start, end);
}

/** Strict alternate deployment gate for an honestly labelled complete frozen
 * prediction. This does not accept or emulate the accepted-run declaration. */
export async function verifySos1FrozenBrowserPublication({ root = ROOT,
  declarationPath = SOS1_PREDICTION_DECLARATION } = {}) {
  const declarationBytes = await readFile(safePath(root, declarationPath,
    'browser publication declaration'));
  const declaration = JSON.parse(declarationBytes);
  assert.equal(declaration.schema, 'molarium.sos1-frozen-browser-publication/v1');
  assert.equal(declaration.routeId, 'sos1-hit-only');
  assert.equal(declaration.publicationClass, 'complete-frozen-prediction');
  assert(typeof declaration.sourceRun?.directory === 'string',
    'browser declaration must preserve its immutable source run directory');
  const verified = await verifyCompleteFrozenSos1Run(safePath(root,
    declaration.sourceRun.directory, 'sourceRun.directory'));
  assert.equal(declaration.sourceRun.id, verified.runId);
  assert.equal(declaration.sourceRun.predictionManifestSha256,
    sha256(verified.manifestBytes));
  assert.equal(declaration.sourceRun.sourceAuditSha256, sha256(verified.auditBytes));
  assert.deepEqual(declaration.sourceRun.checkpoints.map((entry) => entry.stepId),
    SOS1_STEP_IDS);

  const replay = await pinned(root, declaration.executableReplay, 'executableReplay');
  validateActionScript(replay.value);
  assert.equal(declaration.executableReplay.path, SOS1_PREDICTION_REPLAY);
  assert.equal(declaration.executableReplay.publicUrl, '/sos1-hit-to-bay293');
  assert.equal(await actionScriptSha256(replay.value),
    declaration.executableReplay.actionScriptSha256);
  assert.equal(replay.value.sourceAudit?.stateHashGuards?.mode, 'required');
  const generated = await buildFrozenSos1ReplayScript(verified);
  assert.equal(await actionScriptSha256(replay.value), generated.actionScriptSha256,
    'executable replay is not the selected public-action audit route');

  const review = await pinned(root, declaration.checkpointReview, 'checkpointReview');
  validateActionScript(review.value);
  assert.equal(declaration.checkpointReview.path, SOS1_PREDICTION_REVIEW);
  assert.equal(declaration.checkpointReview.calculationPolicy, 'none');
  assert.equal(declaration.checkpointReview.promotable, false);
  assert.equal(declaration.checkpointReview.publicUrl, '/sos1-hit-to-bay293/review');
  assert.equal(await actionScriptSha256(review.value),
    declaration.checkpointReview.actionScriptSha256);
  assert(review.bytes.length < 1024 * 1024,
    'checkpoint review inlines campaigns instead of referencing separate assets');
  assert.equal(review.value.actions.length, SOS1_STEP_IDS.length);

  for (const [index, stepId] of SOS1_STEP_IDS.entries()) {
    const declared = declaration.sourceRun.checkpoints[index];
    const frozen = verified.checkpoints.get(stepId);
    assert.equal(declared.sha256, frozen.entry.sha256);
    assert.equal(declared.fullSystemCampaignSha256,
      frozen.fullSystemCampaign.record.sha256);
    const expectedPath = `${SOS1_PREDICTION_CAMPAIGN_DIRECTORY}/${stepId}-campaign.json`;
    assert.equal(declared.publishedCampaignPath, expectedPath);
    const action = review.value.actions[index];
    assert.equal(action.action, 'campaign.import');
    assert.equal(Object.hasOwn(action.args, 'serialized'), false,
      `${stepId}: review action inlines the full campaign`);
    assert.equal(action.args.sourcePath, `./${expectedPath}`);
    assert.equal(action.args.sourceSha256, declared.fullSystemCampaignSha256);
    assert.equal(Boolean(action.args.preserveView), index > 0);
    assert.equal(action.review.campaignId,
      frozen.fullSystemCampaign.record.campaignId);
    assert.equal(action.review.commitId,
      frozen.fullSystemCampaign.record.commitId);
    const campaignBytes = await readFile(safePath(root, expectedPath,
      `${stepId} campaign asset`));
    assert.equal(sha256(campaignBytes), declared.fullSystemCampaignSha256,
      `${stepId}: published campaign asset changed`);
    const serialized = campaignBytes.toString('utf8');
    const campaign = deserializeCampaign(serialized);
    assert.equal(serializeCampaign(campaign), serialized);
    assert.equal((await verifyCampaign(campaign)).valid, true);
    assert.equal(campaign.branches[frozen.fullSystemCampaign.record.branch],
      frozen.fullSystemCampaign.record.commitId);
  }

  assert.equal(declaration.postFreezeEvaluation.summarySha256,
    sha256(verified.evaluationBytes));
  assert.equal(declaration.postFreezeEvaluation.accepted,
    verified.evaluation.accepted === true);
  const [app, build, manifest, server] = await Promise.all([
    readFile(safePath(root, 'app.js', 'app.js'), 'utf8'),
    readFile(safePath(root, 'scripts/build-web.mjs', 'build-web'), 'utf8'),
    readFile(safePath(root, 'scripts/generate-local-lab-manifest.mjs', 'manifest'), 'utf8'),
    readFile(safePath(root, 'server.js', 'server'), 'utf8'),
  ]);
  for (const [id, path, hash] of [
    ['sos1-hit-to-bay293', SOS1_PREDICTION_REPLAY, declaration.executableReplay.sha256],
    ['sos1-hit-to-bay293-review', SOS1_PREDICTION_REVIEW,
      declaration.checkpointReview.sha256],
  ]) {
    const entry = registryEntry(app, id);
    assert(entry.includes(`sourcePath:'${path}'`));
    assert(entry.includes(`sourceSha256:'${hash}'`));
    assert(entry.includes(`presentation:'chemist-pocket'`));
  }
  const requiredAssets = [declarationPath, SOS1_PREDICTION_REPLAY,
    SOS1_PREDICTION_REVIEW,
    ...declaration.sourceRun.checkpoints.map((entry) => entry.publishedCampaignPath)];
  for (const asset of requiredAssets) {
    assert(build.includes(`'${asset}'`), `build omits ${asset}`);
    assert(manifest.includes(`'${asset}'`), `manifest omits ${asset}`);
  }
  assert(build.includes('/sos1-hit-to-bay293 /?story=sos1-hit-to-bay293 302'));
  assert(build.includes('/sos1-hit-to-bay293/review /?story=sos1-hit-to-bay293-review 302'));
  assert(server.includes("'/?story=sos1-hit-to-bay293'"));
  assert(server.includes("'/?story=sos1-hit-to-bay293-review'"));
  return Object.freeze({ declarationSha256:sha256(declarationBytes),
    runId:verified.runId, evaluationAccepted:verified.evaluation.accepted === true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifySos1FrozenBrowserPublication();
  console.log(`SOS1 frozen browser publication preflight: PASS · ${result.runId}`);
}
