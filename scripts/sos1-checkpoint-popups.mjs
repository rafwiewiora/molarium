import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export const POPUP_DIRECTORY = 'design-history/publications/sos1/designer-intent-2026-09-04/checkpoint-popups-v1';
export const POPUP_DECLARATION = `${POPUP_DIRECTORY}/movie.json`;
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const cueDefinitions = [
  ['starting-hit', 'Preparing the starting hit…', ['protein.prepare']],
  ['scaffold-rewrite', 'Running scaffold refinement and relaxation…', ['pose.refine','optimization.run']],
  ['fragment-merge', 'Running fragment refinement and relaxation…', ['pose.refine','optimization.run']],
  ['aww-phe890-response', 'Evaluating 13 fixed-ligand Phe890 energies…', ['calculation.run']],
  ['finish-bay-293', 'Running BAY-293 refinement and relaxation…', ['pose.refine','optimization.run']],
];

export function checkpointPopupTimeline(manifest, review) {
  assert.equal(manifest.complete, true);
  assert.equal(manifest.replay.status, 'completed');
  assert.equal(review.actions.length, 7);
  const fps = 12;
  return cueDefinitions.map(([stage, text, recordedActions]) => {
    const reviewIndex = review.actions.findIndex((step) => step.review.designStage === stage);
    assert(reviewIndex >= 0);
    let end;
    if (stage === 'starting-hit') {
      end = manifest.captures.find((capture) =>
        capture.label === 'First frozen prediction checkpoint in fixed local pocket')?.firstFrame;
    } else {
      const imports = manifest.presentationScript.timeline.filter((step) => step.action === 'campaign.import');
      const index = imports[reviewIndex].actionNumber - 1;
      end = manifest.captures.find((capture) => capture.actionIndex === index
        && capture.label.includes('. Result '))?.firstFrame;
    }
    assert(Number.isInteger(end) && end >= fps);
    return { stage, text, recordedActions, firstFrame:end - fps, lastFrame:end - 1,
      seconds:1, label:'Precomputed replay · recorded calculation' };
  });
}

export async function verifyCheckpointPopupMovie(root, declarationPath = POPUP_DECLARATION,
  { overlayRoot = null } = {}) {
  const movie = JSON.parse(await readFile(resolve(root, declarationPath)));
  assert.equal(movie.schema, 'molarium.checkpoint-popup-movie/v1');
  assert.equal(movie.calculationPolicy, 'none');
  assert.equal(movie.presentationOnly, true);
  assert.equal(movie.frames, 753); assert.equal(movie.fps, 12);
  assert.equal(movie.durationSeconds, 62.75);
  const pinned = async (file) => {
    assert(file.path.startsWith('design-history/publications/sos1/designer-intent-2026-09-04/'));
    assert(!file.path.split('/').includes('..'));
    const bytes = await readFile(overlayRoot && file.path.startsWith(`${POPUP_DIRECTORY}/`)
      ? resolve(overlayRoot, file.path.slice(POPUP_DIRECTORY.length + 1)) : resolve(root, file.path));
    assert.equal(bytes.length, file.bytes);
    assert.equal(sha256(bytes), file.sha256, `Changed movie asset ${file.path}`);
    return bytes;
  };
  const release = JSON.parse(await readFile(resolve(root,
    'design-history/publications/sos1/designer-intent-2026-09-04/release.json')));
  assert.deepEqual(movie.base.video, release.movies.precomputed.video);
  assert.deepEqual(movie.base.manifest, release.movies.precomputed.manifest);
  const base = JSON.parse(await pinned(movie.base.manifest));
  const review = JSON.parse(await pinned(release.precomputed));
  assert.deepEqual(movie.popups, checkpointPopupTimeline(base, review));
  assert.equal(movie.overlayFrames.length, 60);
  const expectedFrames = movie.popups.flatMap((cue) =>
    Array.from({ length:12 }, (_,i) => cue.firstFrame + i));
  assert.deepEqual(movie.overlayFrames.map((frame) => frame.frameNumber), expectedFrames);
  for (const file of [movie.base.video, movie.video, movie.blankOverlay, ...movie.overlayFrames])
    await pinned(file);
  assert.equal(movie.video.width, 1600); assert.equal(movie.video.height, 1000);
  assert.equal(movie.video.frameCount, movie.frames);
  assert.equal(movie.video.durationSeconds, movie.durationSeconds);
  assert(movie.nativeUi.sources.some((entry) => entry.sourcePath === 'index.html'));
  assert.equal(movie.nativeUi.component, '#run-overlay .run-card');
  for (const source of ['sos1.html','server.js','scripts/build-web.mjs'])
    assert((await readFile(resolve(root,source),'utf8')).includes(movie.video.path),
      `Preferred movie is not registered in ${source}`);
  return movie;
}
