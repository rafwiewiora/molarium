import { cloneRecord, sha256Object } from './integrity.mjs';

export const MOVIE_SCHEMA = 'molarium.design-movie/v1';

function validateCue(cue, index) {
  if (!cue || typeof cue !== 'object') throw new Error(`Movie cue ${index + 1} must be an object`);
  if (typeof cue.title !== 'string' || !cue.title) throw new Error(`Movie cue ${index + 1} needs a title`);
  if (!Number.isInteger(cue.durationMs) || cue.durationMs < 250 || cue.durationMs > 120000)
    throw new Error(`Movie cue ${index + 1} duration must be 250–120000 ms`);
  if (!cue.eventId && !cue.commitId) throw new Error(`Movie cue ${index + 1} needs an eventId or commitId`);
}

export async function buildMovieManifest({ campaign, title, createdAt, width = 1920,
  height = 1080, fps = 30, cues }) {
  if (!campaign?.campaignSha256) throw new Error('Movies require a finalized campaign');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 240)
    throw new Error('Movie dimensions are invalid');
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new Error('Movie FPS must be 1–60');
  if (!Array.isArray(cues) || !cues.length) throw new Error('A movie requires cues');
  const events = new Set(campaign.events.map((entry) => entry.eventId));
  const commits = new Set(Object.keys(campaign.objects.commits));
  cues.forEach((cue, index) => {
    validateCue(cue, index);
    if (cue.eventId && !events.has(cue.eventId)) throw new Error(`Movie cue ${index + 1} event is missing`);
    if (cue.commitId && !commits.has(cue.commitId)) throw new Error(`Movie cue ${index + 1} commit is missing`);
    if (cue.snapshotId && !campaign.objects.snapshots[cue.snapshotId])
      throw new Error(`Movie cue ${index + 1} snapshot is missing`);
  });
  const body = cloneRecord({ schema:MOVIE_SCHEMA, title:String(title || campaign.title), createdAt,
    campaignId:campaign.campaignId, campaignSha256:campaign.campaignSha256,
    width, height, fps, cues });
  return { ...body, movieSha256:await sha256Object(body) };
}

export async function verifyMovieManifest(movie, campaign) {
  try {
    if (movie?.schema !== MOVIE_SCHEMA) return { valid:false, reason:'schema mismatch' };
    const { movieSha256, ...body } = movie;
    if (await sha256Object(body) !== movieSha256) return { valid:false, reason:'movie hash mismatch' };
    if (!Number.isFinite(Date.parse(movie.createdAt))) return { valid:false, reason:'createdAt is invalid' };
    if (!Number.isInteger(movie.width) || !Number.isInteger(movie.height)
      || movie.width < 320 || movie.height < 240) return { valid:false, reason:'dimensions are invalid' };
    if (!Number.isInteger(movie.fps) || movie.fps < 1 || movie.fps > 60)
      return { valid:false, reason:'FPS is invalid' };
    if (!Array.isArray(movie.cues) || !movie.cues.length) return { valid:false, reason:'cues are missing' };
    movie.cues.forEach(validateCue);
    if (campaign) {
      if (movie.campaignId !== campaign.campaignId
        || movie.campaignSha256 !== campaign.campaignSha256)
        return { valid:false, reason:'campaign linkage mismatch' };
      const events = new Set(campaign.events.map((entry) => entry.eventId));
      const commits = new Set(Object.keys(campaign.objects.commits));
      for (const [index, cue] of movie.cues.entries()) {
        if (cue.eventId && !events.has(cue.eventId))
          return { valid:false, reason:`event missing for cue ${index + 1}` };
        if (cue.commitId && !commits.has(cue.commitId))
          return { valid:false, reason:`commit missing for cue ${index + 1}` };
        if (cue.snapshotId && !campaign.objects.snapshots[cue.snapshotId])
          return { valid:false, reason:`snapshot missing for cue ${index + 1}` };
      }
    }
    return { valid:true, reason:null, cues:movie.cues.length };
  } catch (error) { return { valid:false, reason:String(error.message || error) }; }
}

export function expandMovieFrames(movie) {
  const frameDurationMs = 1000 / movie.fps;
  const frames = []; let absoluteFrame = 0, timeMs = 0;
  movie.cues.forEach((cue, cueIndex) => {
    const frameCount = Math.max(1, Math.round(cue.durationMs / frameDurationMs));
    for (let cueFrame = 0; cueFrame < frameCount; cueFrame++) {
      frames.push({ frame:++absoluteFrame, timeMs:Number(timeMs.toFixed(6)), cueIndex,
        cueFrame, cueProgress:frameCount === 1 ? 1 : cueFrame / (frameCount - 1),
        eventId:cue.eventId || null, commitId:cue.commitId || null });
      timeMs += frameDurationMs;
    }
  });
  return frames;
}
