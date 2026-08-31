import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandStructureTimeline } from '../design-history/structure-viewer/timeline.mjs';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const valueFor = (name) => {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const storyPath = resolve(root, valueFor('--story')
  || 'design-history/structure-viewer/moonshot-dndi-6510.json');
const story = JSON.parse(await readFile(storyPath, 'utf8'));
const frames = expandStructureTimeline(story);
const output = resolve(root, valueFor('--output')
  || `outputs/design-history/${story.id}-structure`);
await mkdir(output, { recursive:true });

const browser = await startMolariumBrowser({ root,
  appPath:`design-history/structure-viewer/?render=1&frame=0&story=${encodeURIComponent(story.id)}`,
  width:story.width, height:story.height });
const browserVersion = await browser.client.call('Browser.getVersion');
const temporaryFrames = await mkdtemp(join(tmpdir(), 'molarium-structure-movie-'));
const selectedFrames = has('--smoke')
  ? [...new Set([0, ...story.cues.map((_, cueIndex) =>
    frames.find((frame) => frame.cueIndex === cueIndex)?.frame).filter(Number.isInteger)])]
  : frames.map((frame) => frame.frame);
const rendered = [];

try {
  await waitFor(async () => browser.evaluate(`document.body.dataset.ready==='1'
    && document.body.dataset.renderReady==='1'`), 90000, 'structure-story viewer');
  for (const [position, frameIndex] of selectedFrames.entries()) {
    await browser.evaluate(`window.__molariumStructureStory.selectFrame(${frameIndex})`);
    await waitFor(async () => browser.evaluate(`document.body.dataset.frame==='${frameIndex}'
      && document.body.dataset.renderReady==='1'`), 90000, `structure frame ${frameIndex}`);
    const bytes = await browser.capturePng();
    const filename = `frame-${String(frameIndex).padStart(5, '0')}.png`;
    const destination = has('--smoke') ? join(output, filename) : join(temporaryFrames, filename);
    await writeFile(destination, bytes);
    rendered.push({ frame:frameIndex, filename, sha256:digest(bytes), bytes:bytes.length,
      cueIndex:frames[frameIndex].cueIndex, cueProgress:frames[frameIndex].cueProgress });
    if ((position + 1) % 30 === 0 || position === selectedFrames.length - 1)
      console.log(`Rendered ${position + 1}/${selectedFrames.length} molecular frames`);
  }

  let video = null;
  if (!has('--smoke')) {
    const videoPath = join(output, `${story.id}-structure.mp4`);
    const ffmpeg = Bun.spawn(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
      '-framerate', String(story.fps), '-i', join(temporaryFrames, 'frame-%05d.png'),
      '-r', String(story.fps), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
      '-threads', '1', '-pix_fmt', 'yuv420p', '-map_metadata', '-1', '-fflags', '+bitexact',
      '-flags:v', '+bitexact', '-movflags', '+faststart', videoPath],
    { stdout:'pipe', stderr:'pipe' });
    const exitCode = await ffmpeg.exited;
    if (exitCode !== 0) throw Error(`FFmpeg failed (${exitCode}): ${await new Response(ffmpeg.stderr).text()}`);
    const bytes = await readFile(videoPath);
    const probe = Bun.spawn(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames',
      '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames,duration', '-of', 'json', videoPath],
    { stdout:'pipe', stderr:'pipe' });
    if (await probe.exited !== 0) throw Error(await new Response(probe.stderr).text());
    const stream = JSON.parse(await new Response(probe.stdout).text()).streams?.[0];
    if (Number(stream?.nb_read_frames) !== frames.length)
      throw Error(`Video has ${stream?.nb_read_frames} frames; story requires ${frames.length}`);
    video = { filename:basename(videoPath), sha256:digest(bytes), bytes:bytes.length,
      width:Number(stream.width), height:Number(stream.height), fps:story.fps,
      frames:Number(stream.nb_read_frames), durationSeconds:Number(stream.duration) };
    console.log(`Assembled ${video.filename} · ${video.frames} frames · ${video.sha256.slice(0, 12)}`);
  }

  const [rendererBytes, assetManifestBytes] = await Promise.all([
    readFile(fileURLToPath(import.meta.url)),
    readFile(join(root, 'design-history/structures/generated/manifest.json')),
  ]);
  const manifest = { schema:'molarium.structure-story-render/v1', generatedAt:new Date().toISOString(),
    story:{ path:relative(root, storyPath), id:story.id, sha256:digest(await readFile(storyPath)) },
    assets:{ path:'design-history/structures/generated/manifest.json', sha256:digest(assetManifestBytes) },
    renderer:{ path:relative(root, fileURLToPath(import.meta.url)), sha256:digest(rendererBytes),
      browserProduct:browserVersion.product, userAgent:browserVersion.userAgent },
    viewport:{ width:story.width, height:story.height, deviceScaleFactor:1 }, fps:story.fps,
    complete:!has('--smoke'), expectedFrames:frames.length, renderedFrames:rendered, video };
  await writeFile(join(output, 'render-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${relative(root, join(output, 'render-manifest.json'))}`);
} finally {
  await browser.close();
  await rm(temporaryFrames, { recursive:true, force:true });
}
