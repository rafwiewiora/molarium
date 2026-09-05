import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkpointPopupTimeline } from './sos1-checkpoint-popups.mjs';
const root = new URL('../design-history/publications/sos1/designer-intent-2026-09-04/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('precomputed.render-manifest.json',root)));
const review = JSON.parse(await readFile(new URL('checkpoint-review.action-script.json',root)));
const timeline = checkpointPopupTimeline(manifest,review);
assert.deepEqual(timeline.map((cue) => [cue.firstFrame,cue.lastFrame]),
  [[38,49],[127,138],[216,227],[512,523],[630,641]]);
assert(timeline.every((cue) => cue.seconds === 1 && cue.lastFrame - cue.firstFrame + 1 === 12));
assert(timeline.every((cue) => cue.label.includes('recorded calculation')));
assert.throws(() => checkpointPopupTimeline({ ...manifest,complete:false },review));
assert.throws(() => checkpointPopupTimeline(manifest,{ ...review,actions:review.actions.slice(1) }));
assert.equal(timeline.some((cue) => ['aww-graph','aww-designer-intent'].includes(cue.stage)), false);
console.log('Checkpoint movie: five one-second recorded-calculation cues; immutable science and timing PASS');
