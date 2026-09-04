#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { actionScriptSha256 } from '../design-history/replay.mjs';
import { verifyLocalLabCaptureState } from './local-lab-capture.mjs';
import { argumentValue, buildAcceptedSos1ReplayScript, requireExplicitRunDirectory,
  sha256, verifyAcceptedSos1Run } from './sos1-accepted-run.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const INSTALLED_MOVIE =
  'assets/media/sos1-designer-moves-molarium-interface.mp4';
export const INSTALLED_RENDER_MANIFEST =
  'assets/media/sos1-designer-moves-molarium-interface.render-manifest.json';

async function atomicWrite(path, bytes) {
  await mkdir(dirname(path), { recursive:true });
  const pending = `${path}.pending-${process.pid}`;
  await writeFile(pending, bytes);
  await rename(pending, path);
}

export async function verifyInterfaceRenderForInstallation(accepted, renderDirectory) {
  const manifestBytes = await readFile(resolve(renderDirectory, 'render-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.schema, 'molarium.designer-moves-interface-render/v1');
  assert.equal(manifest.complete, true, 'interface render is incomplete');
  assert.equal(manifest.replay?.status, 'completed', 'interface replay did not complete');
  assert.equal(manifest.acceptedRun?.accepted, true);
  assert.equal(manifest.acceptedRun?.id, accepted.runId,
    'interface render belongs to a different run');
  assert.equal(manifest.acceptedRun?.predictionManifestSha256,
    sha256(accepted.manifestBytes), 'interface render prediction manifest changed');
  assert.equal(manifest.acceptedRun?.evaluationSummarySha256,
    sha256(accepted.evaluationBytes), 'interface render evaluation summary changed');
  const allowedOrigins = manifest.networkPolicy?.allowedNetworkOrigins;
  assert(Array.isArray(allowedOrigins) && allowedOrigins.length === 1,
    'interface render does not identify one Local Lab origin');
  verifyLocalLabCaptureState(manifest.networkPolicy, allowedOrigins[0]);

  const sourceBytes = await readFile(resolve(renderDirectory, manifest.sourceScript?.path || ''));
  assert.equal(sha256(sourceBytes), manifest.sourceScript?.fileSha256,
    'render source action script changed');
  const source = JSON.parse(sourceBytes);
  const generated = await buildAcceptedSos1ReplayScript(accepted);
  assert.equal(await actionScriptSha256(source), generated.actionScriptSha256,
    'interface movie was not rendered from the accepted public replay');
  assert.equal(manifest.sourceScript?.actionScriptSha256, generated.actionScriptSha256);
  assert.equal(manifest.sourceScript?.sourceAuditSha256, sha256(accepted.auditBytes));

  const videoFilename = manifest.video?.filename;
  assert.equal(videoFilename, basename(INSTALLED_MOVIE));
  const videoBytes = await readFile(resolve(renderDirectory, videoFilename));
  assert.equal(sha256(videoBytes), manifest.video.sha256, 'rendered MP4 changed');
  assert.equal(videoBytes.length, manifest.video.bytes, 'rendered MP4 size changed');
  assert(manifest.video.width > 0 && manifest.video.height > 0
    && manifest.video.frames > 0 && manifest.video.durationSeconds > 0,
  'rendered MP4 metadata is incomplete');
  return Object.freeze({ manifest, manifestBytes, videoBytes });
}

export async function installSos1InterfaceRender(accepted, renderDirectory,
  { root = ROOT } = {}) {
  assert.equal(resolve(root), ROOT,
    'SOS1 interface movie may only be installed in the production repository');
  const verified = await verifyInterfaceRenderForInstallation(accepted, renderDirectory);
  // Movie first, pinned manifest last: readers never see a manifest for absent bytes.
  await atomicWrite(resolve(root, INSTALLED_MOVIE), verified.videoBytes);
  await atomicWrite(resolve(root, INSTALLED_RENDER_MANIFEST), verified.manifestBytes);
  return Object.freeze({ movie:{ path:INSTALLED_MOVIE,
    sha256:sha256(verified.videoBytes), bytes:verified.videoBytes.length },
  manifest:{ path:INSTALLED_RENDER_MANIFEST,
    sha256:sha256(verified.manifestBytes), bytes:verified.manifestBytes.length } });
}

export async function main(argv = process.argv.slice(2)) {
  const runDirectory = requireExplicitRunDirectory(argv, { root:ROOT });
  const renderValue = argumentValue(argv, '--render-dir');
  if (!renderValue) throw new Error('--render-dir is required; no render is selected implicitly');
  const accepted = await verifyAcceptedSos1Run(runDirectory);
  const installed = await installSos1InterfaceRender(accepted, resolve(ROOT, renderValue));
  process.stdout.write(`${JSON.stringify({ acceptedRun:accepted.runId, ...installed }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
