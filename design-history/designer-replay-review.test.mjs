import assert from 'node:assert/strict';
import { DESIGNER_REVIEW_DIRECTIONS, designerReplayReviewState,
  designerReplayReviewTarget } from './designer-replay-review.mjs';

assert.deepEqual(DESIGNER_REVIEW_DIRECTIONS, ['previous', 'next', 'final']);

const running = designerReplayReviewState({ replaying:true, paused:false,
  index:4, frontier:4, checkpointCount:5 });
assert.equal(running.available, false);

const paused = designerReplayReviewState({ replaying:true, paused:true,
  index:3, frontier:5, checkpointCount:6 });
assert.equal(paused.available, true);
assert.equal(paused.live, true);
assert.equal(paused.reviewing, true);
assert.equal(designerReplayReviewTarget(paused, 'previous'), 2);
assert.equal(designerReplayReviewTarget(paused, 'next'), 4);
assert.equal(designerReplayReviewTarget(paused, 'final'), 5);

const completed = designerReplayReviewState({ replayStatus:'completed',
  index:51, frontier:51, checkpointCount:52 });
assert.equal(completed.available, true);
assert.equal(completed.completed, true);
assert.equal(completed.checkpointCount, 52);
assert.equal(completed.atFinal, true);
assert.equal(designerReplayReviewTarget(completed, 'previous'), 50);

const reviewingCompleted = designerReplayReviewState({ replayStatus:'completed',
  index:12, frontier:51, checkpointCount:52 });
assert.equal(reviewingCompleted.reviewing, true);
assert.equal(designerReplayReviewTarget(reviewingCompleted, 'final'), 51);

assert.throws(() => designerReplayReviewTarget(running, 'previous'),
  /No completed replay checkpoints/);
assert.throws(() => designerReplayReviewTarget(completed, 'future'),
  /direction must be one of/);

console.log('Designer replay review navigation: PASS');
