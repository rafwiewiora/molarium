import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { actionScriptFromAudit, actionScriptSha256 } from '../design-history/replay.mjs';
import { buildPocketInterfaceStory } from '../design-history/interface-story.mjs';
import { buildSos1AwwReceptorOnlyPublicationRecords, sha256,
  verifySos1AwwReceptorOnlyRun } from './sos1-aww-receptor-only-publication.mjs';
import { verifyAxhContinuation } from './sos1-axh-continuation.mjs';
import { verifySos1ExecutableScience } from './sos1-executable-science.mjs';
import { verifyHighlightCameraAudit } from './designer-movie-presentation.mjs';

export const SOS1_INTENT_RELEASE_DIRECTORY = 'design-history/publications/sos1/designer-intent-2026-09-04';
export const SOS1_INTENT_RELEASE = `${SOS1_INTENT_RELEASE_DIRECTORY}/release.json`;
export const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
export function releasePath(root, path) {
  assert(typeof path === 'string' && path && !isAbsolute(path));
  const target = resolve(root, path), local = relative(root, target);
  assert(local && local !== '..' && !local.startsWith('../'), 'Release path escapes its root');
  return target;
}

// Rebuild the full public protocol from the verified native AWW and AXH audits.
// The checkpoint directory is the only relocation input; coordinate bytes and
// scientific requests remain unchanged.
export async function buildFullSos1IntentRecords({ root, aww, axh, checkpointDirectory,
  compressFinalCheckpoint = true,
  upstreamAuditPath = 'design-history/publications/sos1/source-runs/sos1-a013-a018-complete-frozen/chemist-action-audit.json' }) {
  const auditBytes = await readFile(releasePath(root, upstreamAuditPath));
  const graphAuditBytes = await readFile(join(dirname(aww.source.path), 'chemist-action-audit.json'));
  const base = await buildSos1AwwReceptorOnlyPublicationRecords(aww, {
    checkpointDirectory, upstream:{ audit:JSON.parse(auditBytes), auditBytes,
      sourceCampaignSha256:'e1a7722f517b5371efad860dc6d87bf31d813b05df6c3e72db74e71e3236cb81',
      graphAudit:JSON.parse(graphAuditBytes), graphAuditBytes } });
  const suffix = actionScriptFromAudit({ schema:'molarium.chemist-action-audit/v1',
    routeId:'sos1-hit-only', records:axh.records.slice(2) }, {
    label:'Native AXH continuation', includeReadOnly:true, includeAuditMetadata:true,
    stateHashGuards:'off', executionContract:'portable-scientific' });
  const executable = { ...base.executable,
    label:'SOS1 hit to BAY-293 · reference-informed designer-intent replay',
    actions:[...base.executable.actions, ...suffix.actions],
    provenance:{ ...base.executable.provenance, continuationManifestSha256:sha256(axh.manifestBytes),
      continuationAuditSha256:sha256(axh.auditBytes) } };
  const asset = { id:'finish-bay-293', path:`${checkpointDirectory}/finish-bay-293-campaign.json${compressFinalCheckpoint ? '.gz' : ''}`,
    ...(compressFinalCheckpoint ? { encoding:'gzip' } : {}),
    bytes:axh.bytes, sha256:sha256(axh.bytes), commitId:axh.record.commitId, snapshotId:axh.record.snapshotId };
  const review = { ...base.review,
    label:'SOS1 hit to BAY-293 · exact reference-informed checkpoints',
    actions:[...base.review.actions, { action:'campaign.import',
      args:{ sourcePath:`./${asset.path}`, sourceSha256:asset.sha256, preserveView:true,
        ...(asset.encoding ? { sourceEncoding:asset.encoding } : {}) },
      expect:{ 'campaignImport.viewPreserved':true }, caption:'Review the BAY-293 attachment rewrite',
      review:{ designStage:asset.id, immutableSnapshot:true, calculationPolicy:'none',
        holdoutCoordinatesIncluded:false, campaignSha256:asset.sha256,
        campaignId:axh.campaign.campaignId, branch:'main',
        commitId:asset.commitId, snapshotId:asset.snapshotId } }] };
  return { executable, review, campaignAssets:[...base.campaignAssets, asset] };
}

export function verifyNativeScriptAudit(script, audit, fingerprint) {
  const records = audit.records || audit;
  const bindings = new Map();
  const atPath = (value, path) => path.split('.').reduce((v, key) => v?.[key], value);
  const resolveValue = (value) => {
    if (Array.isArray(value)) return value.map(resolveValue);
    if (!value || typeof value !== 'object') return value;
    if (Object.hasOwn(value, '$binding')) {
      assert(bindings.has(value.$binding));
      return bindings.get(value.$binding);
    }
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, resolveValue(v)]));
  };
  for (const [index, step] of script.actions.entries()) {
    const matches = records.filter((record) =>
      record.requestId === `story-${fingerprint.slice(0,12)}-${index + 1}`);
    assert.equal(matches.length, 1, `Missing or duplicate native script step ${index + 1}`);
    const record = matches[0];
    assert.equal(record.status, 'completed');
    assert.equal(record.action, step.action);
    assert.deepEqual(record.args, resolveValue(step.args || {}));
    for (const [path, expected] of Object.entries(step.expect || {}))
      assert.deepEqual(atPath(record.result, path), expected, `Native result expectation ${path}`);
    for (const [name, path] of Object.entries(step.capture || {}))
      bindings.set(name, atPath(record.result, path));
  }
  return true;
}

export async function verifySos1IntentRelease({ root, declarationPath = SOS1_INTENT_RELEASE,
  checkIntegration = true } = {}) {
  const release = JSON.parse(await readFile(releasePath(root, declarationPath)));
  assert.equal(release.schema, 'molarium.sos1-designer-intent-release/v1');
  assert.equal(release.referenceInformed, true);
  const pinned = async (descriptor) => {
    const bytes = await readFile(releasePath(root, descriptor.path));
    assert.equal(bytes.length, descriptor.bytes);
    assert.equal(sha256(bytes), descriptor.sha256, `Release bytes changed: ${descriptor.path}`);
    return bytes;
  };
  const temporary = await mkdtemp(join(tmpdir(), 'molarium-sos1-release-verify-'));
  try {
    const restored = new Set();
    for (const descriptor of release.evidence) {
      assert(!restored.has(descriptor.originalPath)); restored.add(descriptor.originalPath);
      assert(Number.isInteger(descriptor.originalBytes) && descriptor.originalBytes > 0
        && descriptor.originalBytes < 512 * 1024 * 1024);
      const bytes = gunzipSync(await pinned(descriptor), { maxOutputLength:descriptor.originalBytes });
      assert.equal(bytes.length, descriptor.originalBytes);
      assert.equal(sha256(bytes), descriptor.originalSha256);
      const target = releasePath(temporary, descriptor.originalPath);
      await mkdir(dirname(target), { recursive:true }); await writeFile(target, bytes, { flag:'wx' });
    }
    const aww = await verifySos1AwwReceptorOnlyRun(releasePath(temporary, release.source.aww),
      { root:temporary, requireAccepted:false });
    const axh = await verifyAxhContinuation(releasePath(temporary, release.source.axh), aww);
    const rebuilt = await buildFullSos1IntentRecords({ root:temporary, aww, axh,
      checkpointDirectory:`${SOS1_INTENT_RELEASE_DIRECTORY}/checkpoints` });
    const executableBytes = await pinned(release.executable);
    const reviewBytes = await pinned(release.precomputed);
    assert.equal(sha256(executableBytes), sha256(jsonBytes(rebuilt.executable)));
    assert.equal(sha256(reviewBytes), sha256(jsonBytes(rebuilt.review)));
    assert.equal(rebuilt.executable.actions.length, 159);
    assert.equal(rebuilt.review.actions.length, 7);
    assert.equal(release.checkpoints.length, 7);
    for (const [index, asset] of rebuilt.campaignAssets.entries()) {
      const descriptor = release.checkpoints[index];
      assert.equal(descriptor.path, asset.path);
      assert.equal(descriptor.encoding, asset.encoding);
      const encoded = await pinned(descriptor);
      const bytes = descriptor.encoding === 'gzip'
        ? gunzipSync(encoded, { maxOutputLength:32 * 1024 * 1024 }) : encoded;
      assert.equal(sha256(bytes), asset.sha256);
      assert.equal(descriptor.canonicalSha256, asset.sha256);
    }
    for (const [kind, movie] of Object.entries(release.movies)) {
      await pinned(movie.video);
      const manifest = JSON.parse(await pinned(movie.manifest));
      assert.equal(manifest.complete, true); assert.equal(manifest.replay.status, 'completed');
      assert.equal(manifest.video.sha256, movie.video.sha256);
      assert.equal(manifest.video.bytes, movie.video.bytes);
      assert.equal(manifest.video.width, 1600); assert.equal(manifest.video.height, 1000);
      assert.equal(manifest.networkPolicy.verified, true);
      assert(manifest.presentation.depictionChecks.length >= 7);
      assert(manifest.presentation.depictionChecks.every((check) =>
        check.visibleWidth >= 40 && check.visibleHeight >= 40));
      const source = JSON.parse(await readFile(releasePath(temporary, movie.sourceScript)));
      assert.equal(await actionScriptSha256(source), manifest.sourceScript.actionScriptSha256);
      if (kind === 'executable') assert.deepEqual(source, rebuilt.executable);
      else assert.deepEqual(source.actions.map((step) => step.args.sourceSha256),
        rebuilt.campaignAssets.map((asset) => asset.sha256));
      const presentation = buildPocketInterfaceStory(source, {
        sourcePath:manifest.sourceScript.provenancePath,
        sourceSha256:manifest.sourceScript.fileSha256 });
      const presentationHash = await actionScriptSha256(presentation);
      assert.equal(presentationHash, manifest.presentationScript.actionScriptSha256);
      const audit = JSON.parse(await readFile(releasePath(temporary, movie.audit)));
      assert.equal(sha256(jsonBytes(audit)), manifest.audit.sha256);
      verifyNativeScriptAudit(presentation, audit, presentationHash);
      verifyHighlightCameraAudit(audit.records, manifest.presentation.cameraContract.highlightCount);
      if (kind === 'executable') {
        assert.deepEqual(verifySos1ExecutableScience(audit), manifest.recomputedScience);
        assert(audit.records.every((record, i) => record.sequence === i + 1));
      } else assert.equal(audit.records.some((record) => ['calculation.run','optimization.run','pose.refine']
        .includes(record.action)), false);
    }
    await pinned(release.paper);
    if (checkIntegration) {
      const app = await readFile(join(root, 'app.js'), 'utf8');
      for (const [id, descriptor] of [['sos1-hit-to-bay293', release.executable],
        ['sos1-hit-to-bay293-review', release.precomputed]]) {
        const start = app.indexOf(`'${id}':Object.freeze({`), end = app.indexOf('}),', start);
        assert(start >= 0 && end > start);
        const entry = app.slice(start, end);
        assert(entry.includes(`sourcePath:'${descriptor.path}'`));
        assert(entry.includes(`sourceSha256:'${descriptor.sha256}'`));
        assert(entry.includes("presentation:'chemist-pocket'"));
      }
    }
    return { passed:true, awwRun:aww.runId, axhRun:axh.runId,
      executableActions:159, exactCheckpoints:7, files:release };
  } finally { await rm(temporary, { recursive:true, force:true }); }
}
