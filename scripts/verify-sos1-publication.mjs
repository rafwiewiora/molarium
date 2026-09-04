#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionScriptSha256, validateActionScript } from '../design-history/replay.mjs';
import { buildAcceptedSos1ReplayScript, sha256,
  SOS1_ROUTE_ID, SOS1_STEP_IDS, verifyAcceptedSos1Run } from './sos1-accepted-run.mjs';

export const SOS1_PUBLICATION_SCHEMA = 'molarium.sos1-publication/v1';
export const SOS1_PUBLICATION_DECLARATION =
  'design-history/examples/sos1-publication.json';

const SHA256 = /^[a-f0-9]{64}$/;

function requireSha256(value, label) {
  assert(SHA256.test(value || ''), `${label} must be a lowercase SHA-256 digest`);
}

function repositoryPath(root, value, label) {
  assert(typeof value === 'string' && value && !isAbsolute(value),
    `${label} must be a non-empty repository-relative path`);
  const absolute = resolve(root, value);
  const fromRoot = relative(root, absolute);
  assert(fromRoot && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`),
    `${label} escapes the repository`);
  return absolute;
}

async function pinnedJson(root, record, label) {
  assert(record && typeof record === 'object' && !Array.isArray(record),
    `${label} must be a pinned artifact record`);
  requireSha256(record.sha256, `${label}.sha256`);
  const path = repositoryPath(root, record.path, `${label}.path`);
  const bytes = await readFile(path);
  assert.equal(sha256(bytes), record.sha256, `${label} changed after publication declaration`);
  return { path, bytes, value:JSON.parse(bytes) };
}

function assertNoV3(value, path = 'public replay') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoV3(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'featureSeedingProtocol' && entry === 'v3')
      throw new Error(`${path}.${key} uses forbidden featureSeedingProtocol v3`);
    assertNoV3(entry, `${path}.${key}`);
  }
}

function expectedCheckpointRecords(accepted) {
  return SOS1_STEP_IDS.map((stepId) => {
    const frozen = accepted.checkpoints.get(stepId);
    return { stepId, sha256:frozen.entry.sha256 };
  });
}

function assertRunLink(link, accepted, expectedCheckpoints, label) {
  assert(link && typeof link === 'object' && !Array.isArray(link),
    `${label} has no accepted-run link`);
  assert.equal(link.runId, accepted.runId, `${label} references a different accepted run`);
  assert.equal(link.routeId, SOS1_ROUTE_ID, `${label} references a different route`);
  assert.equal(link.accepted, true, `${label} is not marked accepted`);
  assert.equal(link.predictionManifestSha256, sha256(accepted.manifestBytes),
    `${label} prediction-manifest hash changed`);
  assert.equal(link.evaluationSummarySha256, sha256(accepted.evaluationBytes),
    `${label} evaluation-summary hash changed`);
  assert.equal(link.sourceAuditSha256, sha256(accepted.auditBytes),
    `${label} Chemist Actions audit hash changed`);
  assert.deepEqual(link.checkpoints, expectedCheckpoints,
    `${label} frozen-checkpoint hashes changed`);
}

function assertSourceReferences(source, requiredPaths, label) {
  for (const path of requiredPaths) {
    const candidates = new Set([path, `./${path}`]);
    assert([...candidates].some((candidate) => source.includes(candidate)),
      `${label} does not reference current publication artifact ${path}`);
  }
}

/**
 * Verify the one explicit SOS1 production declaration and every hash boundary
 * behind it. This reads evidence only; it never generates or repairs assets.
 */
export async function verifySos1Publication({
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  declarationPath = SOS1_PUBLICATION_DECLARATION,
} = {}) {
  const declarationAbsolute = repositoryPath(root, declarationPath, 'publication declaration');
  let declarationBytes;
  try {
    declarationBytes = await readFile(declarationAbsolute);
  } catch (error) {
    if (error?.code === 'ENOENT')
      throw new Error(`SOS1 publication is not declared at ${declarationPath}; promote one complete accepted run before building`);
    throw error;
  }
  const declaration = JSON.parse(declarationBytes);
  assert.equal(declaration.schema, SOS1_PUBLICATION_SCHEMA);
  assert.equal(declaration.routeId, SOS1_ROUTE_ID);

  const run = declaration.acceptedRun;
  assert(run && typeof run === 'object' && !Array.isArray(run),
    'publication declaration requires acceptedRun');
  const runDirectory = repositoryPath(root, run.directory, 'acceptedRun.directory');
  const accepted = await verifyAcceptedSos1Run(runDirectory);
  assert.equal(run.id, accepted.runId, 'publication declaration selected a different run directory');
  assert.equal(run.predictionManifestSha256, sha256(accepted.manifestBytes),
    'declared prediction-manifest hash changed');
  assert.equal(run.evaluationSummarySha256, sha256(accepted.evaluationBytes),
    'declared evaluation-summary hash changed');
  assert.equal(run.sourceAuditSha256, sha256(accepted.auditBytes),
    'declared Chemist Actions audit hash changed');
  const checkpoints = expectedCheckpointRecords(accepted);
  assert.deepEqual(run.checkpoints, checkpoints, 'declared frozen-checkpoint hashes changed');

  const publicReplay = await pinnedJson(root, declaration.publicReplay,
    'publication publicReplay');
  validateActionScript(publicReplay.value);
  assertNoV3(publicReplay.value);
  requireSha256(declaration.publicReplay.actionScriptSha256,
    'publication publicReplay.actionScriptSha256');
  assert.equal(await actionScriptSha256(publicReplay.value),
    declaration.publicReplay.actionScriptSha256,
    'public replay canonical action-script hash changed');
  const generatedReplay = await buildAcceptedSos1ReplayScript(accepted);
  assert.equal(await actionScriptSha256(publicReplay.value), generatedReplay.actionScriptSha256,
    'public replay was not generated from the accepted run audit');
  assertRunLink(publicReplay.value.sourceAudit, accepted, checkpoints, 'public replay');

  const story = await pinnedJson(root, declaration.checkpointReview,
    'publication checkpointReview');
  assertNoV3(story.value, 'checkpoint review');
  assert.equal(story.value.schema, 'molarium.structure-story/v1');
  assert.equal(story.value.id, declaration.storyId,
    'publication declaration and checkpoint review use different story IDs');
  assert.equal(story.value.publication?.schema, 'molarium.sos1-accepted-run-link/v1',
    'checkpoint review has no accepted-run link');
  assertRunLink(story.value.publication, accepted, checkpoints, 'checkpoint review');
  assert.equal(story.value.review?.sourceAuditSha256, sha256(accepted.auditBytes),
    'checkpoint review source audit does not match the accepted run');

  const reviewScriptPath = resolve(dirname(story.path), story.value.review?.actionScript?.path || '');
  assert.equal(reviewScriptPath, publicReplay.path,
    'checkpoint review and application do not use the same accepted replay');
  assert.equal(story.value.review?.actionScript?.sha256, declaration.publicReplay.sha256,
    'checkpoint review action-script file hash changed');
  const checkpointByStep = new Map(checkpoints.map((entry) => [entry.stepId, entry.sha256]));
  const reviewCheckpoints = (story.value.cues || []).map((cue) => cue.checkpoint)
    .filter((entry) => entry?.predictionSha256);
  assert.deepEqual(reviewCheckpoints.map((entry) => entry.stepId), SOS1_STEP_IDS,
    'checkpoint review does not cover the complete accepted route');
  for (const checkpoint of reviewCheckpoints)
    assert.equal(checkpoint.predictionSha256, checkpointByStep.get(checkpoint.stepId),
      `${checkpoint.stepId}: checkpoint review hash changed`);

  const requiredPaths = [declarationPath, declaration.publicReplay.path,
    declaration.checkpointReview.path];
  const integration = declaration.integration || {};
  const [applicationSource, buildSource, manifestSource] = await Promise.all([
    readFile(repositoryPath(root, integration.applicationSource, 'integration.applicationSource'), 'utf8'),
    readFile(repositoryPath(root, integration.buildSource, 'integration.buildSource'), 'utf8'),
    readFile(repositoryPath(root, integration.manifestSource, 'integration.manifestSource'), 'utf8'),
  ]);
  assertSourceReferences(applicationSource,
    [declaration.storyId, declaration.publicReplay.path], 'application registry');
  assertSourceReferences(buildSource, requiredPaths, 'production build');
  assertSourceReferences(manifestSource, requiredPaths, 'local manifest generator');

  return Object.freeze({ declaration, acceptedRunId:accepted.runId,
    declarationSha256:sha256(declarationBytes), publicReplaySha256:sha256(publicReplay.bytes),
    checkpointReviewSha256:sha256(story.bytes), checkpoints });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifySos1Publication();
  console.log(`SOS1 publication preflight: PASS · ${result.acceptedRunId}`);
}
