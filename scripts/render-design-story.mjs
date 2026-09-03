import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandMovieFrames, verifyMovieManifest } from '../design-history/movie.mjs';
import { verifyCampaign } from '../design-history/ledger.mjs';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generated = join(root, 'design-history/stories/generated');
const args = process.argv.slice(2);
const valueFor = (name) => {
  const exact = args.indexOf(name);
  if (exact >= 0) return args[exact + 1];
  return args.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
};
const has = (name) => args.includes(name);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => readFile(path, 'utf8').then(JSON.parse);

if (has('--help')) {
  console.log(`Usage: bun scripts/render-design-story.mjs [options]

  --story ID       generated story ID (default: first story)
  --output DIR     output directory (default: outputs/design-history/ID)
  --cues LIST      comma-separated zero-based cue indices
  --smoke          render only the first two cues
  --video          assemble an MP4 with FFmpeg

Each unique cue is rendered once. The manifest maps its PNG to the exact movie
frame range, avoiding hundreds of duplicate still files.`);
  process.exit(0);
}

const index = await json(join(generated, 'index.json'));
const storyId = valueFor('--story') || index.stories[0]?.id;
const entry = index.stories.find((story) => story.id === storyId);
if (!entry) throw new Error(`Unknown story ${storyId}`);
const campaignPath = join(generated, entry.campaign.replace(/^\.\//, ''));
const moviePath = join(generated, entry.movie.replace(/^\.\//, ''));
const [campaign, movie] = await Promise.all([json(campaignPath), json(moviePath)]);
const [campaignAudit, movieAudit] = await Promise.all([
  verifyCampaign(campaign), verifyMovieManifest(movie, campaign),
]);
if (!campaignAudit.valid) throw new Error(`Campaign integrity failed: ${campaignAudit.reason}`);
if (!movieAudit.valid) throw new Error(`Movie integrity failed: ${movieAudit.reason}`);

const requested = valueFor('--cues')?.split(',').map(Number)
  .filter((index) => Number.isInteger(index) && index >= 0 && index < movie.cues.length);
const cueIndices = requested?.length ? [...new Set(requested)]
  : has('--smoke') ? movie.cues.slice(0, 2).map((_, index) => index)
  : movie.cues.map((_, index) => index);
const output = resolve(root, valueFor('--output') || `outputs/design-history/${storyId}`);
await mkdir(output, { recursive:true });

const browser = await startMolariumBrowser({ root,
  appPath:`design-history/viewer/?story=${encodeURIComponent(storyId)}&cue=0&render=1`,
  width:movie.width, height:movie.height });
const frameSchedule = expandMovieFrames(movie);
const browserVersion = await browser.client.call('Browser.getVersion');
const renderedCues = [];

try {
  await waitFor(async () => browser.evaluate(
    `document.body.dataset.ready === '1' && document.body.dataset.depictionReady !== 'pending'`),
  30000, 'design-history viewer');
  for (const cueIndex of cueIndices) {
    await browser.evaluate(`window.__molariumDesignHistory.selectCue(${cueIndex})`);
    await waitFor(async () => browser.evaluate(
      `document.body.dataset.cue === '${cueIndex}' && document.body.dataset.depictionReady !== 'pending'`),
    30000, `cue ${cueIndex}`);
    await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const bytes = await browser.capturePng();
    const filename = `cue-${String(cueIndex + 1).padStart(3, '0')}.png`;
    await writeFile(join(output, filename), bytes);
    const cueFrames = frameSchedule.filter((frame) => frame.cueIndex === cueIndex);
    renderedCues.push({ cueIndex, title:movie.cues[cueIndex].title, filename,
      pngSha256:digest(bytes), bytes:bytes.length,
      firstFrame:cueFrames[0]?.frame ?? null, lastFrame:cueFrames.at(-1)?.frame ?? null,
      frameCount:cueFrames.length, durationMs:movie.cues[cueIndex].durationMs,
      eventId:movie.cues[cueIndex].eventId || null,
      commitId:movie.cues[cueIndex].commitId || null,
      snapshotId:movie.cues[cueIndex].snapshotId || null });
    console.log(`Rendered ${filename} · ${digest(bytes).slice(0, 12)} · ${movie.cues[cueIndex].title}`);
  }
} finally {
  await browser.close();
}

let video = null;
if (has('--video')) {
  if (cueIndices.length !== movie.cues.length)
    throw new Error('--video requires the complete cue set (omit --smoke and --cues)');
  const videoPath = join(output, `${storyId}.mp4`);
  const inputArgs = renderedCues.flatMap((cue) => ['-loop', '1', '-framerate', String(movie.fps),
    '-t', (cue.frameCount / movie.fps).toFixed(9), '-i', join(output, cue.filename)]);
  const streams = renderedCues.map((_, index) => `[${index}:v]setpts=PTS-STARTPTS[v${index}]`).join(';');
  const inputs = renderedCues.map((_, index) => `[v${index}]`).join('');
  const filter = `${streams};${inputs}concat=n=${renderedCues.length}:v=1:a=0,format=yuv420p[v]`;
  const ffmpeg = Bun.spawn(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', ...inputArgs,
    '-filter_complex', filter, '-map', '[v]', '-r', String(movie.fps),
    '-c:v', 'libx264', '-preset', 'slow',
    '-threads', '1', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact',
    '-movflags', '+faststart', videoPath], { stdout:'pipe', stderr:'pipe' });
  const exitCode = await ffmpeg.exited;
  if (exitCode !== 0) throw new Error(`FFmpeg failed (${exitCode}): ${await new Response(ffmpeg.stderr).text()}`);
  const bytes = await readFile(videoPath);
  const probe = Bun.spawn(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames,duration',
    '-of', 'json', videoPath], { stdout:'pipe', stderr:'pipe' });
  const probeExit = await probe.exited;
  if (probeExit !== 0) throw new Error(`FFprobe failed (${probeExit}): ${await new Response(probe.stderr).text()}`);
  const stream = JSON.parse(await new Response(probe.stdout).text()).streams?.[0];
  const actualFrames = Number(stream?.nb_read_frames);
  if (actualFrames !== frameSchedule.length)
    throw new Error(`Rendered video has ${actualFrames} frames; manifest requires ${frameSchedule.length}`);
  video = { filename:basename(videoPath), bytes:bytes.length, sha256:digest(bytes),
    fps:movie.fps, frames:actualFrames, durationSeconds:Number(stream.duration),
    width:Number(stream.width), height:Number(stream.height) };
  console.log(`Assembled ${video.filename} · ${video.sha256.slice(0, 12)}`);
}

const rendererBytes = await readFile(fileURLToPath(import.meta.url));
const manifest = {
  schema:'molarium.design-story-render/v1', generatedAt:new Date().toISOString(),
  storyId, title:movie.title, campaignId:campaign.campaignId,
  campaignSha256:campaign.campaignSha256, movieSha256:movie.movieSha256,
  sourceFiles:{ campaign:relative(root, campaignPath), movie:relative(root, moviePath) },
  renderer:{ path:relative(root, fileURLToPath(import.meta.url)), sha256:digest(rendererBytes),
    browserProduct:browserVersion.product, browserRevision:browserVersion.revision,
    userAgent:browserVersion.userAgent },
  viewport:{ width:movie.width, height:movie.height, deviceScaleFactor:1 },
  fps:movie.fps, totalMovieFrames:frameSchedule.length,
  complete:cueIndices.length === movie.cues.length, renderedCues, video,
};
const manifestPath = join(output, 'render-manifest.json');
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${relative(root, manifestPath)}`);
