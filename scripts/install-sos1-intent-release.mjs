#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { sha256, verifySos1AwwReceptorOnlyRun } from './sos1-aww-receptor-only-publication.mjs';
import { verifyAxhContinuation } from './sos1-axh-continuation.mjs';
import { buildFullSos1IntentRecords, jsonBytes, releasePath, SOS1_INTENT_RELEASE_DIRECTORY,
  SOS1_INTENT_RELEASE, verifySos1IntentRelease } from './sos1-intent-release.mjs';

const root = resolve(import.meta.dirname, '..');
const [awwArg, axhArg, executableArg, checkpointArg] = process.argv.slice(2);
assert(awwArg && axhArg && executableArg && checkpointArg,
  'Expected explicit AWW run, AXH run, complete executable render, and complete checkpoint render');
const aww = await verifySos1AwwReceptorOnlyRun(releasePath(root, awwArg), { root, requireAccepted:false });
const axh = await verifyAxhContinuation(releasePath(root, axhArg), aww);
const records = await buildFullSos1IntentRecords({ root, aww, axh,
  checkpointDirectory:`${SOS1_INTENT_RELEASE_DIRECTORY}/checkpoints` });
const stageRoot = await mkdtemp(join(tmpdir(), 'molarium-sos1-release-install-'));
const output = releasePath(stageRoot, SOS1_INTENT_RELEASE_DIRECTORY);
await mkdir(output, { recursive:true });
const save = async (name, bytes) => {
  const path = `${SOS1_INTENT_RELEASE_DIRECTORY}/${name}`;
  const target = releasePath(stageRoot, path);
  await mkdir(dirname(target), { recursive:true });
  await writeFile(target, bytes, { flag:'wx' });
  return { path, bytes:bytes.length, sha256:sha256(bytes) };
};
try {
  const release = { schema:'molarium.sos1-designer-intent-release/v1', referenceInformed:true,
    source:{ aww:awwArg, axh:axhArg },
    executable:await save('executable.action-script.json', jsonBytes(records.executable)),
    precomputed:await save('checkpoint-review.action-script.json', jsonBytes(records.review)),
    checkpoints:[], movies:{}, evidence:[],
    paper:await save('molarium-paper.pdf', await readFile(join(root, 'paper/build/main.pdf'))) };
  for (const asset of records.campaignAssets)
    release.checkpoints.push({ ...await save(`checkpoints/${basename(asset.path)}`,
      asset.encoding === 'gzip' ? gzipSync(asset.bytes, { level:9 }) : asset.bytes),
      ...(asset.encoding ? { encoding:asset.encoding } : {}), canonicalSha256:asset.sha256,
      id:asset.id, commitId:asset.commitId, snapshotId:asset.snapshotId });
  const evidencePaths = new Set([
    relative(root, aww.source.path),
    relative(root, join(dirname(aww.source.path), 'chemist-action-audit.json')),
    'design-history/publications/sos1/source-runs/sos1-a013-a018-complete-frozen/chemist-action-audit.json',
  ]);
  for (const directory of [awwArg, axhArg])
    for (const entry of await readdir(releasePath(root, directory), { withFileTypes:true }))
      if (entry.isFile() && entry.name.endsWith('.json')) evidencePaths.add(`${directory}/${entry.name}`);
  for (const [kind, directory] of [['executable', executableArg], ['precomputed', checkpointArg]]) {
    const manifestBytes = await readFile(releasePath(root, `${directory}/render-manifest.json`));
    const manifest = JSON.parse(manifestBytes);
    assert.equal(manifest.complete, true); assert.equal(manifest.replay.status, 'completed');
    const videoBytes = await readFile(releasePath(root, `${directory}/${manifest.video.filename}`));
    assert.equal(sha256(videoBytes), manifest.video.sha256);
    release.movies[kind] = {
      video:await save(`${kind}.mp4`, videoBytes),
      manifest:await save(`${kind}.render-manifest.json`, manifestBytes),
      sourceScript:`${directory}/source.action-script.json`,
      audit:`${directory}/chemist-action-audit.json` };
    evidencePaths.add(release.movies[kind].sourceScript);
    evidencePaths.add(release.movies[kind].audit);
  }
  for (const [index, originalPath] of [...evidencePaths].sort().entries()) {
    const bytes = await readFile(releasePath(root, originalPath));
    const compressed = gzipSync(bytes, { level:9 });
    const name = `evidence/${String(index + 1).padStart(3,'0')}-${basename(originalPath)}.gz`;
    release.evidence.push({ ...await save(name, compressed), originalPath,
      originalBytes:bytes.length, originalSha256:sha256(bytes), encoding:'gzip' });
  }
  await save('release.json', jsonBytes(release));
  await verifySos1IntentRelease({ root:stageRoot, checkIntegration:false });
  const destination = releasePath(root, SOS1_INTENT_RELEASE_DIRECTORY);
  await mkdir(dirname(destination), { recursive:true });
  await rename(output, destination);
  console.log(JSON.stringify({ installed:SOS1_INTENT_RELEASE, evidenceFiles:release.evidence.length,
    executable:release.executable, precomputed:release.precomputed,
    movies:release.movies, verified:true }, null, 2));
} catch (error) {
  console.error(`Unpublished release evidence retained at ${stageRoot}`);
  throw error;
}
await rm(stageRoot, { recursive:true, force:true });
