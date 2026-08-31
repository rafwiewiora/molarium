import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cameraFromView, easeInOut, expandStructureTimeline, interpolateCamera } from './timeline.mjs';

assert.equal(easeInOut(0), 0);
assert.equal(easeInOut(1), 1);
assert.equal(easeInOut(.5), .5);
const start = cameraFromView({ target:[0, 0, 0], radius:10, view:[0, 0, 1] });
const end = cameraFromView({ target:[4, 2, 0], radius:2, view:[0, 0, 1] });
const middle = interpolateCamera(start, end, .5);
assert.deepEqual(middle.target, [2, 1, 0]);
assert.equal(middle.radius, 6);
const frames = expandStructureTimeline({ fps:10, cues:[
  { durationMs:1000, scene:'a' }, { durationMs:500, scene:'b' },
] });
assert.equal(frames.length, 15);
assert.equal(frames[0].cueProgress, 0);
assert.equal(frames[9].cueProgress, 1);
assert.equal(frames[10].scene, 'b');
assert.equal(frames.at(-1).cueProgress, 1);

const bcl = JSON.parse(await readFile(new URL('./bclxl-fragment-linking.json', import.meta.url)));
assert.equal(bcl.cues.length, 15, 'the five-state story uses approach, before, and after shots');
assert(bcl.cues.every((cue) => cue.durationMs >= 1400), 'no BCL-xL camera cue is rushed');
const focusCameras = Object.entries(bcl.cameras)
  .filter(([name]) => /Focus|Reveal|Wide/.test(name)).map(([, camera]) => camera);
assert.equal(new Set(focusCameras.map((camera) => JSON.stringify(camera.view))).size, 1,
  'change-site shots keep one viewing direction instead of orbiting');
for (const [beforeId, afterId] of [
  ['link-site-before','compound-6-linked'],
  ['linker-carbonyl-before','compound-7-linker'],
  ['sidechain-before','compound-16-truncation'],
  ['ethyl-pocket-before','compound-21-pocket-fill'],
]) {
  const before = bcl.cues.find((cue) => cue.id === beforeId);
  const after = bcl.cues.find((cue) => cue.id === afterId);
  assert.equal(before.cameraStart, before.cameraEnd, `${beforeId} must hold still before the edit`);
  assert.equal(after.cameraStart, before.cameraEnd, `${afterId} must begin at the same change site`);
  assert(before.focusLabel && after.focusLabel, `${beforeId} and ${afterId} need visible focus labels`);
}

const cdk2 = JSON.parse(await readFile(new URL('./cdk2-hit-only-prospective.json', import.meta.url)));
assert.equal(cdk2.cues.length, 11, 'CDK2 tells the two-step prospective result without extra shots');
assert(cdk2.cues.every((cue) => cue.durationMs >= 1800), 'CDK2 comparison cues must remain readable');
assert.equal(new Set(Object.values(cdk2.cameras).map((camera) => JSON.stringify(camera.view))).size, 1,
  'CDK2 holds one viewing direction for the entire prospective comparison');
for (const cue of cdk2.cues.slice(1)) {
  assert.equal(cue.cameraStart, cue.cameraEnd,
    `${cue.id} must hold the active-site camera still after the initial approach`);
}
for (const id of ['freeze-6cp','freeze-n76']) {
  const cue=cdk2.cues.find((entry)=>entry.id===id);
  assert.match(cue.detail, /Agent API sequence \d+/,
    `${id} must expose its Agent API freeze sequence`);
}
for (const id of ['reveal-1h1r','reveal-1oiu']) {
  const cue=cdk2.cues.find((entry)=>entry.id===id);
  assert.match(cue.detail, /opened after freeze/i,
    `${id} must label the post-freeze holdout boundary`);
}
console.log('structure timeline tests passed');
