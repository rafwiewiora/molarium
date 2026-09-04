#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionScriptSha256, validateActionScript } from '../design-history/replay.mjs';
import { validatePrecomputedCheckpointReview } from
  '../design-history/structure-viewer/checkpoint-review.mjs';
import { parsePdb } from '../design-history/structures/pipeline.mjs';
import { buildAcceptedSos1ReplayScript, sha256,
  SOS1_ROUTE_ID, SOS1_STEP_IDS, verifyAcceptedSos1Run } from './sos1-accepted-run.mjs';

export const SOS1_PUBLICATION_SCHEMA = 'molarium.sos1-publication/v1';
export const SOS1_PUBLICATION_DECLARATION =
  'design-history/examples/sos1-publication.json';

const SHA256 = /^[a-f0-9]{64}$/;
const APPLICATION_STORY_ID = 'sos1-hit-to-bay293';
const PRODUCTION_INTEGRATION = Object.freeze({
  applicationSource:'app.js',
  structureViewerSource:'design-history/structure-viewer/viewer.mjs',
  buildSource:'scripts/build-web.mjs',
  manifestSource:'scripts/generate-local-lab-manifest.mjs',
  serverSource:'server.js',
});
const LEGACY_SOS1_REFERENCES = Object.freeze([
  'sos1-growth-clash-v7', 'sos1-v7-', 'sos1-chemist-actions-review',
  'sos1-hit-only-success',
]);

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

async function pinnedJsonBeside(root, ownerPath, record, label) {
  assert(record && typeof record === 'object' && !Array.isArray(record),
    `${label} must be a pinned artifact record`);
  requireSha256(record.sha256, `${label}.sha256`);
  assert(typeof record.path === 'string' && record.path && !isAbsolute(record.path),
    `${label}.path must be relative to its owner`);
  const path = resolve(dirname(ownerPath), record.path);
  const fromRoot = relative(root, path);
  assert(fromRoot && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`),
    `${label}.path escapes the repository`);
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

function escaped(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function declaredStringArray(source, name, label) {
  const match = source.match(new RegExp(`const\\s+${escaped(name)}\\s*=\\s*\\[([\\s\\S]*?)\\n\\];`));
  assert(match, `${label} has no ${name} declaration`);
  return [...match[1].matchAll(/['"]([^'"\n]+)['"]/g)].map((entry) => entry[1]);
}

function assertNoLegacyReferences(source, label) {
  for (const legacy of LEGACY_SOS1_REFERENCES)
    assert(!source.includes(legacy), `${label} still references legacy SOS1 asset ${legacy}`);
}

function frozenRegistryRecord(source, registryName, key, label) {
  const start = source.indexOf(`const ${registryName}`);
  assert(start >= 0, `${label} has no ${registryName}`);
  const registry = source.slice(start);
  const match = registry.match(new RegExp(
    `['"]${escaped(key)}['"]\\s*:\\s*Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\)`));
  assert(match, `${label} does not register ${key}`);
  return match[1];
}

function assertQuotedField(source, field, value, label) {
  assert(new RegExp(`${escaped(field)}\\s*:\\s*['"]${escaped(value)}['"]`).test(source),
    `${label} does not bind ${field} to ${value}`);
}

function sceneModels(story, sceneId, trail = []) {
  assert(!trail.includes(sceneId), `checkpoint review scene inheritance cycle at ${sceneId}`);
  const scene = story.scenes?.[sceneId];
  assert(scene, `checkpoint review scene ${sceneId} does not exist`);
  return [...(scene.extends ? sceneModels(story, scene.extends, [...trail, sceneId]) : []),
    ...(scene.models || [])];
}

function inspectionAtomKey(atom, kind) {
  if (kind === 'ligand') return `${atom.atomName}|${String(atom.element).toUpperCase()}`;
  return `${atom.residueName}|${atom.chain}|${Number(atom.residueIndex)}|${atom.atomName}|${String(atom.element).toUpperCase()}`;
}

function pdbAtomKey(atom, kind) {
  if (kind === 'ligand') return `${atom.atomName}|${String(atom.element).toUpperCase()}`;
  return `${atom.resName}|${atom.chain}|${Number(atom.resSeq)}|${atom.atomName}|${String(atom.element).toUpperCase()}`;
}

function assertCoordinateSubset(text, expectedAtoms, kind, label) {
  const expected = new Map(expectedAtoms.filter((atom) => atom.element !== 'H')
    .map((atom) => [inspectionAtomKey(atom, kind), atom]));
  const actual = parsePdb(text).atoms.filter((atom) => atom.element !== 'H');
  assert(actual.length, `${label} contains no heavy-atom coordinates`);
  const keys = new Set();
  for (const atom of actual) {
    const key = pdbAtomKey(atom, kind);
    const reference = expected.get(key);
    assert(reference, `${label} contains atom ${key} absent from its frozen checkpoint`);
    const displacement = Math.hypot(atom.x - reference.coordinatesAngstrom[0],
      atom.y - reference.coordinatesAngstrom[1], atom.z - reference.coordinatesAngstrom[2]);
    assert(displacement <= 0.001,
      `${label} atom ${key} differs from its frozen checkpoint by ${displacement.toFixed(4)} A`);
    keys.add(key);
  }
  return keys;
}

async function validateSceneAssets(root, story, assetManifest, accepted) {
  const assetsByName = new Map();
  for (const asset of assetManifest.assets || []) {
    const name = basename(asset.path || '');
    assert(name && !assetsByName.has(name), `asset manifest has duplicate basename ${name}`);
    assetsByName.set(name, asset);
  }
  const fileCache = new Map();
  const readAsset = async (asset) => {
    if (fileCache.has(asset.path)) return fileCache.get(asset.path);
    requireSha256(asset.sha256, `asset ${asset.path} sha256`);
    const path = repositoryPath(root, asset.path, `asset ${asset.path}`);
    const bytes = await readFile(path);
    assert.equal(sha256(bytes), asset.sha256, `scene asset ${asset.path} changed after generation`);
    const value = { bytes, text:bytes.toString('utf8') };
    fileCache.set(asset.path, value);
    return value;
  };

  for (const cue of story.cues || []) {
    if (!cue.checkpoint?.predictionSha256) continue;
    const frozen = accepted.checkpoints.get(cue.checkpoint.stepId);
    assert(frozen, `checkpoint cue ${cue.id} references an unknown accepted-run step`);
    const expectedState = String(frozen.entry.predictedStateId || frozen.checkpoint.predictedStateId);
    const stateAliases = new Set([expectedState, expectedState.toLowerCase(),
      `${expectedState.toLowerCase()}-prediction`]);
    const ligandExpected = frozen.checkpoint.ligand?.atoms || [];
    const pocketExpected = frozen.checkpoint.pocket?.atoms || [];
    const pheExpected = pocketExpected.filter((atom) => atom.residueName === 'PHE'
      && Number(atom.residueIndex) === 890 && atom.element !== 'H');
    assert(ligandExpected.length && pheExpected.length,
      `${cue.checkpoint.stepId}: frozen checkpoint lacks ligand or Phe890 coordinates`);
    const ligandSeen = new Set(), pocketSeen = new Set();
    for (const model of sceneModels(story, cue.scene)) {
      requireSha256(model.sha256, `scene ${cue.scene} model ${model.path}`);
      const asset = assetsByName.get(basename(model.path || ''));
      assert(asset && asset.sha256 === model.sha256,
        `scene ${cue.scene} model ${model.path} is not pinned by the asset manifest`);
      const { text } = await readAsset(asset);
      const role = String(asset.role || '');
      const prospectiveLigand = /(?:prospective|frozen)-prediction.*(?:ligand|atoms)/.test(role);
      const prospectivePocket = /prospective-prediction.*(?:phe|pocket|peptide|receptor)/.test(role);
      if (!prospectiveLigand && !prospectivePocket) continue;
      assert.equal(asset.stepId, cue.checkpoint.stepId,
        `scene ${cue.scene} asset ${asset.path} belongs to a different checkpoint`);
      assert.equal(asset.checkpointSha256, cue.checkpoint.predictionSha256,
        `scene ${cue.scene} asset ${asset.path} is not bound to its frozen checkpoint`);
      assert(stateAliases.has(String(asset.stateId || '')),
        `scene ${cue.scene} asset ${asset.path} belongs to a different predicted state`);
      const keys = assertCoordinateSubset(text,
        prospectiveLigand ? ligandExpected : pocketExpected,
        prospectiveLigand ? 'ligand' : 'pocket', `scene asset ${asset.path}`);
      for (const key of keys) (prospectiveLigand ? ligandSeen : pocketSeen).add(key);
    }
    const expectedLigandKeys = new Set(ligandExpected.filter((atom) => atom.element !== 'H')
      .map((atom) => inspectionAtomKey(atom, 'ligand')));
    const expectedPheKeys = new Set(pheExpected.map((atom) => inspectionAtomKey(atom, 'pocket')));
    assert.deepEqual(ligandSeen, expectedLigandKeys,
      `${cue.checkpoint.stepId}: displayed ligand is not the complete frozen checkpoint ligand`);
    assert([...expectedPheKeys].every((key) => pocketSeen.has(key)),
      `${cue.checkpoint.stepId}: displayed Phe890 is not the frozen checkpoint side chain`);
  }
}

function validateProductionIntegration({ declaration, applicationSource, structureViewerSource,
  buildSource, manifestSource, serverSource }) {
  assert.deepEqual(declaration.integration, PRODUCTION_INTEGRATION,
    'publication declaration may only name the hard-coded production integration files');
  for (const [label, source] of Object.entries({ applicationSource, structureViewerSource,
    buildSource, manifestSource, serverSource })) assertNoLegacyReferences(source, label);

  const appRecord = frozenRegistryRecord(applicationSource, 'DESIGNER_STORY_LINKS',
    APPLICATION_STORY_ID, 'application registry');
  assertQuotedField(appRecord, 'script', `./${declaration.publicReplay.path}`,
    'application registry');
  assertQuotedField(appRecord, 'sourcePath', declaration.publicReplay.path,
    'application registry');
  assertQuotedField(appRecord, 'sourceSha256', declaration.publicReplay.sha256,
    'application registry');

  const reviewRecord = frozenRegistryRecord(structureViewerSource, 'STORY_REGISTRY',
    declaration.storyId, 'structure-viewer registry');
  const reviewRelative = `./${basename(declaration.checkpointReview.path)}`;
  assertQuotedField(reviewRecord, 'path', reviewRelative, 'structure-viewer registry');
  assertQuotedField(reviewRecord, 'sha256', declaration.checkpointReview.sha256,
    'structure-viewer registry');

  const required = [SOS1_PUBLICATION_DECLARATION, declaration.publicReplay.path,
    declaration.checkpointReview.path];
  const buildFiles = declaredStringArray(buildSource, 'files', 'production build');
  const manifestFiles = declaredStringArray(manifestSource, 'reviewedFiles',
    'local manifest generator');
  for (const path of required) {
    assert(buildFiles.includes(path), `production build does not package ${path}`);
    assert(manifestFiles.includes(path), `local manifest generator does not review ${path}`);
  }
  const redirect = `/design-history/structure-viewer/?story=${declaration.storyId}`;
  assert(buildSource.includes(`/sos1-hit-to-bay293/replay ${redirect} 302`),
    'production redirect does not select the declared checkpoint review');
  assert(serverSource.includes(redirect),
    'local server redirect does not select the declared checkpoint review');
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
  assertNoLegacyReferences(JSON.stringify(publicReplay.value), 'public replay');
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
  assertNoLegacyReferences(JSON.stringify(story.value), 'checkpoint review');
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

  const [provenance, assetManifest] = await Promise.all([
    pinnedJsonBeside(root, story.path, story.value.review?.provenance,
      'checkpoint review provenance'),
    pinnedJsonBeside(root, story.path, story.value.review?.assetManifest,
      'checkpoint review assetManifest'),
  ]);
  assertNoLegacyReferences(JSON.stringify(provenance.value), 'checkpoint review provenance');
  assertNoLegacyReferences(JSON.stringify(assetManifest.value),
    'checkpoint review asset manifest');
  validatePrecomputedCheckpointReview(story.value, {
    actionScript:publicReplay.value,
    provenance:provenance.value,
    assetManifest:assetManifest.value,
  });
  assert.equal(provenance.value.sourceRun?.predictionManifest?.sha256,
    sha256(accepted.manifestBytes),
    'checkpoint review provenance references a different prediction manifest');
  assert.equal(assetManifest.value.boundary?.predictionManifestSha256,
    sha256(accepted.manifestBytes),
    'checkpoint review asset manifest references a different prediction manifest');
  assert.deepEqual(assetManifest.value.checkpoints?.map((entry) => ({
    stepId:entry.stepId, predictedStateId:entry.predictedStateId, sha256:entry.sha256,
    freezeActionSequence:entry.freezeActionSequence,
  })), accepted.manifest.checkpoints.map((entry) => ({
    stepId:entry.stepId, predictedStateId:entry.predictedStateId, sha256:entry.sha256,
    freezeActionSequence:entry.freezeActionSequence,
  })), 'checkpoint review asset manifest is not the accepted run checkpoint manifest');
  await validateSceneAssets(root, story.value, assetManifest.value, accepted);

  const integrationSources = Object.fromEntries(await Promise.all(
    Object.entries(PRODUCTION_INTEGRATION).map(async ([key, path]) => [key,
      await readFile(repositoryPath(root, path, `production ${key}`), 'utf8')])));
  validateProductionIntegration({ declaration, ...integrationSources });

  return Object.freeze({ declaration, acceptedRunId:accepted.runId,
    declarationSha256:sha256(declarationBytes), publicReplaySha256:sha256(publicReplay.bytes),
    checkpointReviewSha256:sha256(story.bytes),
    checkpointReviewProvenanceSha256:sha256(provenance.bytes),
    checkpointReviewAssetManifestSha256:sha256(assetManifest.bytes), checkpoints });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifySos1Publication();
  console.log(`SOS1 publication preflight: PASS · ${result.acceptedRunId}`);
}
