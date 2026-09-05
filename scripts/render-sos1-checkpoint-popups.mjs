#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';
import { POPUP_DIRECTORY, POPUP_DECLARATION, checkpointPopupTimeline,
  sha256, jsonBytes, verifyCheckpointPopupMovie } from './sos1-checkpoint-popups.mjs';

const root = resolve(import.meta.dirname, '..');
const release = JSON.parse(await readFile(resolve(root,
  'design-history/publications/sos1/designer-intent-2026-09-04/release.json')));
const base = release.movies.precomputed;
for (const file of [base.video, base.manifest, release.precomputed])
  assert.equal(sha256(await readFile(resolve(root, file.path))), file.sha256);
const manifest = JSON.parse(await readFile(resolve(root, base.manifest.path)));
const review = JSON.parse(await readFile(resolve(root, release.precomputed.path)));
const popups = checkpointPopupTimeline(manifest, review);
const parent = resolve(root, dirname(POPUP_DIRECTORY));
const stage = await mkdtemp(join(parent, '.checkpoint-popups-pending-'));
const frames = await mkdtemp(join(tmpdir(), 'molarium-popup-frames-'));
const descriptors = [], byFrame = new Map();
const save = async (name, bytes) => {
  await writeFile(join(stage, name), bytes, { flag:'wx' });
  return { path:`${POPUP_DIRECTORY}/${name}`, bytes:bytes.length, sha256:sha256(bytes) };
};
let browser;
try {
  browser = await startMolariumBrowser({ root, appPath:'scripts/sos1-calculation-popup.html',
    width:1600, height:1000, localOnly:true });
  await browser.client.call('Emulation.setDefaultBackgroundColorOverride',
    { color:{ r:0,g:0,b:0,a:0 } });
  await waitFor(() => browser.evaluate('window.recordedPopupReady'), 30000, 'native calculation card');
  await browser.evaluate('window.setRecordedPopup(null)');
  const blank = await save('overlay-blank.png', await browser.capturePng());
  const alphaCheck = Bun.spawn(['ffmpeg','-v','error','-i',join(stage,'overlay-blank.png'),
    '-vf','alphaextract','-f','rawvideo','-pix_fmt','gray','pipe:1'],
    { stdout:'pipe',stderr:'inherit' });
  const alpha = new Uint8Array(await new Response(alphaCheck.stdout).arrayBuffer());
  assert.equal(await alphaCheck.exited, 0);
  assert.equal(alpha.length, 1600 * 1000);
  assert(alpha.every((value) => value === 0), 'Blank overlay must preserve every underlying movie pixel');
  for (const [cueIndex, cue] of popups.entries()) {
    for (let frame = 0; frame < 12; frame++) {
      const shown = await browser.evaluate(`window.setRecordedPopup(${JSON.stringify(cue.text)}, ${frame})`);
      assert.equal(shown.text, cue.text); assert.equal(shown.label, cue.label);
      assert.equal(shown.hasApplicationApi, false);
      const descriptor = await save(`overlay-${cueIndex}-${String(frame).padStart(2,'0')}.png`,
        await browser.capturePng());
      descriptors.push({ ...descriptor, frameNumber:cue.firstFrame + frame });
      byFrame.set(cue.firstFrame + frame, descriptor);
    }
  }
  await browser.close(); browser = null;
  for (let frame = 0; frame < 753; frame++) {
    const source = (byFrame.get(frame) || blank).path.split('/').at(-1);
    await copyFile(join(stage, source), join(frames, `frame-${String(frame).padStart(4,'0')}.png`));
  }
  const movieName = 'checkpoint-overview.mp4';
  const encoding = ['-filter_complex_threads','1','-i',resolve(root, base.video.path),
    '-framerate','12','-i',join(frames, 'frame-%04d.png'),
    '-filter_complex','[0:v][1:v]overlay=0:0:format=auto:shortest=1,format=yuv420p[v]',
    '-map','[v]','-an','-frames:v','753','-c:v','libx264','-preset','medium','-crf','18',
    '-g','12','-keyint_min','12','-sc_threshold','0','-movflags','+faststart'];
  const encode = Bun.spawn(['ffmpeg','-hide_banner','-loglevel','error',...encoding,join(stage,movieName)],
    { stdout:'ignore', stderr:'pipe' });
  const errors = await new Response(encode.stderr).text();
  assert.equal(await encode.exited, 0, errors);
  const probe = Bun.spawn(['ffprobe','-v','error','-select_streams','v:0','-count_frames',
    '-show_entries','stream=width,height,nb_read_frames,duration','-of','json',join(stage,movieName)],
    { stdout:'pipe', stderr:'inherit' });
  const info = JSON.parse(await new Response(probe.stdout).text()).streams[0];
  assert.equal(await probe.exited, 0); assert.equal(Number(info.nb_read_frames), 753);
  assert.equal(info.width, 1600); assert.equal(info.height, 1000);
  assert.equal(Number(info.duration), 62.75);
  const videoBytes = await readFile(join(stage,movieName));
  const sources = [];
  for (const sourcePath of ['index.html','styles.css','molarium-workspace.css','openmm-worker.js','webgpu-worker.js',
    'scripts/sos1-calculation-popup.html','scripts/sos1-calculation-popup.mjs','scripts/render-sos1-checkpoint-popups.mjs',
    'scripts/sos1-checkpoint-popups.mjs'])
    sources.push({ sourcePath, sha256:sha256(await readFile(resolve(root,sourcePath))) });
  const declaration = { schema:'molarium.checkpoint-popup-movie/v1',
    calculationPolicy:'none', presentationOnly:true, base,
    fps:12, frames:753, durationSeconds:62.75, popups,
    nativeUi:{ component:'#run-overlay .run-card', sources },
    video:{ path:`${POPUP_DIRECTORY}/${movieName}`, bytes:videoBytes.length, sha256:sha256(videoBytes),
      width:1600,height:1000,frameCount:753,durationSeconds:62.75 },
    blankOverlay:blank, overlayFrames:descriptors,
    composition:'Original verified checkpoint MP4 + transparent native calculation-card overlays; no new molecular frames or calculations. Five one-second recorded-calculation cues; original frame count and timing retained.',
    ffmpegArguments:encoding.map((arg) => arg.replace(root,'<repo>').replace(frames,'<overlay-frame-directory>')) };
  await writeFile(join(stage,'movie.json'), jsonBytes(declaration), { flag:'wx' });
  await verifyCheckpointPopupMovie(root, join(stage,'movie.json'), { overlayRoot:stage });
  await rename(stage, resolve(root,POPUP_DIRECTORY));
  await verifyCheckpointPopupMovie(root);
  console.log(JSON.stringify({ verified:true, declaration:POPUP_DECLARATION, video:declaration.video,
    popups:popups.length, secondsPerPopup:1 },null,2));
} catch (error) {
  console.error(`Popup render evidence retained at ${stage}`); throw error;
} finally {
  await browser?.close(); await rm(frames,{ recursive:true,force:true });
}
