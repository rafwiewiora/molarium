import assert from 'node:assert/strict';
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
console.log('structure timeline tests passed');
