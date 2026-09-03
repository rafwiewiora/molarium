export const DESIGNER_REVIEW_DIRECTIONS = Object.freeze([
  'previous', 'next', 'final',
]);

export function designerReplayReviewState({ replaying = false, paused = false,
  actionRunning = false, replayStatus = null, index = 0, frontier = 0,
  checkpointCount = 0 } = {}) {
  const live = Boolean(replaying && paused && !actionRunning);
  const completed = Boolean(!replaying && replayStatus === 'completed'
    && !actionRunning && checkpointCount > 0);
  const available = live || completed;
  return Object.freeze({
    available,
    live,
    completed,
    index,
    frontier,
    checkpointCount,
    atStart:index <= 0,
    atFinal:index >= frontier,
    reviewing:index < frontier,
  });
}

export function designerReplayReviewTarget(review, direction) {
  if (!review?.available) throw new Error('No completed replay checkpoints are available for review');
  if (!DESIGNER_REVIEW_DIRECTIONS.includes(direction))
    throw new Error(`direction must be one of: ${DESIGNER_REVIEW_DIRECTIONS.join(', ')}`);
  if (direction === 'final') return review.frontier;
  const delta = direction === 'previous' ? -1 : 1;
  return Math.max(0, Math.min(review.frontier, review.index + delta));
}
