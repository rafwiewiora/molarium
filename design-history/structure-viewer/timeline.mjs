export function easeInOut(value) {
  const x = Math.max(0, Math.min(1, Number(value) || 0));
  return x < .5 ? 4 * x ** 3 : 1 - ((-2 * x + 2) ** 3) / 2;
}

export function interpolateVector(start, end, progress) {
  const eased = easeInOut(progress);
  return start.map((value, index) => value + (end[index] - value) * eased);
}

export function interpolateCamera(start, end, progress) {
  return {
    target:interpolateVector(start.target, end.target, progress),
    position:interpolateVector(start.position, end.position, progress),
    up:interpolateVector(start.up || [0, 1, 0], end.up || [0, 1, 0], progress),
    radius:start.radius + (end.radius - start.radius) * easeInOut(progress),
    radiusMax:Math.max(start.radiusMax || 100, end.radiusMax || 100),
  };
}

export function cameraFromView({ target, radius, view = [1, .5, .75], distance = 2.7 }) {
  const length = Math.hypot(...view) || 1;
  const unit = view.map((value) => value / length);
  return { target:[...target], position:target.map((value, index) => value + unit[index] * radius * distance),
    up:[0, 1, 0], radius, radiusMax:120 };
}

export function expandStructureTimeline(story) {
  const frames = [];
  const frameDurationMs = 1000 / story.fps;
  let frame = 0, timeMs = 0;
  story.cues.forEach((cue, cueIndex) => {
    const count = Math.max(1, Math.round(cue.durationMs / frameDurationMs));
    for (let cueFrame = 0; cueFrame < count; cueFrame++) frames.push({
      frame:frame++, cueIndex, cueFrame, cueProgress:count === 1 ? 1 : cueFrame / (count - 1),
      timeMs:Number(timeMs.toFixed(6)), scene:cue.scene,
    }), timeMs += frameDurationMs;
  });
  return frames;
}
