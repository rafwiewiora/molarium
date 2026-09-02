import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionScriptSha256, validateActionScript } from '../design-history/replay.mjs';
import { buildPocketInterfaceStory } from '../design-history/interface-story.mjs';
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
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const scriptPath = resolve(root, valueFor('--script')
  || 'design-history/examples/sos1-growth-clash-v7.selected-route.action-script.json');
const output = resolve(root, valueFor('--output')
  || 'outputs/design-history/sos1-hit-only-growth-clash-v7/interface-movie');
const width = Number(valueFor('--width') || 1600);
const height = Number(valueFor('--height') || 1000);
const fps = Number(valueFor('--fps') || 12);
const smoke = has('--smoke');
const sourceActionLimit = Number(valueFor('--source-actions') || 0);
const sourceScriptBytes = await readFile(scriptPath);
const sourceScript = validateActionScript(JSON.parse(sourceScriptBytes));
const sourceActions = smoke ? sourceScript.actions.slice(0, 4)
  : sourceActionLimit > 0 ? sourceScript.actions.slice(0, sourceActionLimit)
    : sourceScript.actions;
const presentationScript = buildPocketInterfaceStory({
  schema:sourceScript.schema,
  label:sourceScript.label,
  actions:sourceActions,
}, { sourcePath:relative(root, scriptPath), sourceSha256:digest(sourceScriptBytes) });

await mkdir(output, { recursive:true });
const temporary = await mkdtemp(join(tmpdir(), 'molarium-interface-movie-'));
const presentationPath = join(temporary, 'presentation.action-script.json');
const frameDirectory = join(temporary, 'frames');
const qaDirectory = join(output, 'qa');
await mkdir(frameDirectory);
await mkdir(qaDirectory, { recursive:true });
await writeFile(presentationPath, `${JSON.stringify(presentationScript, null, 2)}\n`);

const browser = await startMolariumBrowser({ root,
  appPath:'index.html?blank=1&designer-moves-movie=1', width, height, localOnly:true });
const browserVersion = await browser.client.call('Browser.getVersion');
const captured = [];
let frameIndex = 0;

async function appendFrame(label, repeats = 1, actionIndex = null) {
  const bytes = await browser.capturePng();
  const sha256 = digest(bytes);
  const qaFilename = `${String(captured.length + 1).padStart(2, '0')}-${label
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72)}.png`;
  await writeFile(join(qaDirectory, qaFilename), bytes);
  for (let repeat = 0; repeat < repeats; repeat++) {
    const filename = `frame-${String(frameIndex++).padStart(5, '0')}.png`;
    await writeFile(join(frameDirectory, filename), bytes);
  }
  captured.push({ label, actionIndex, repeats, sha256, bytes:bytes.length, qaFilename:`qa/${qaFilename}`,
    firstFrame:frameIndex - repeats, lastFrame:frameIndex - 1 });
}

function holdFrames(step) {
  if (!step) return fps;
  if (step.action === 'view.setDisplay') return Math.max(3, Math.round(fps * .3));
  if (['designRoute.load', 'designRoute.applyStep', 'pose.applySidechainRotamer',
    'pose.enumerateSidechainRotamers', 'pose.updateReceptorReference', 'optimization.run',
    'view.focusComponent', 'view.focusAtoms', 'view.highlightAtoms'].includes(step.action))
    return Math.round(fps * 1.25);
  return Math.max(4, Math.round(fps * .55));
}

async function waitForInterfaceAction(actionNumber, actionIndex, step, auditBaseline, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let nextProgressCapture = Date.now() + 700;
  let lastProgressStatus = '';
  let progressCaptures = 0;
  while (Date.now() < deadline) {
    const state = await browser.evaluate(`(() => {
      const records = window.MolariumChemistActions.history();
      const record = records[${auditBaseline + actionNumber - 1}] || null;
      return {
        record:record && record.status !== 'running'
          ? { status:record.status, error:record.error || null } : null,
        dockingStatus:document.querySelector('#docking-status')?.textContent || '',
      };
    })()`);
    if (state.record) return state.record;
    if (step.action === 'pose.refine' && Date.now() >= nextProgressCapture
      && progressCaptures < 10 && state.dockingStatus !== lastProgressStatus
      && /worker ensemble|Pose ensemble/.test(state.dockingStatus)) {
      lastProgressStatus = state.dockingStatus;
      progressCaptures += 1;
      await appendFrame(`${actionNumber}. Ensemble ${state.dockingStatus}`,
        Math.max(2, Math.round(fps * .2)), actionIndex);
      nextProgressCapture = Date.now() + 700;
    }
    await delay(60);
  }
  throw new Error(`Timed out waiting for completed interface action ${actionNumber}`);
}

try {
  await waitFor(async () => browser.evaluate(`Boolean(window.MolariumChemistActionsReady)
    && document.querySelector('#designer-move-file')`), 30000, 'Molarium Designer moves UI');
  await browser.evaluate(`document.querySelector('.mode-bar button[data-mode="build"]').click();
    document.querySelector('#designer-move-tools').scrollIntoView({block:'center'}); true`);
  await delay(400);
  await appendFrame('Molarium Build interface before import', Math.round(fps * 1.5));

  const documentNode = await browser.client.call('DOM.getDocument', { depth:1 });
  const fileNode = await browser.client.call('DOM.querySelector', {
    nodeId:documentNode.root.nodeId, selector:'#designer-move-file',
  });
  await browser.client.call('DOM.setFileInputFiles', {
    nodeId:fileNode.nodeId, files:[presentationPath],
  });
  await browser.evaluate(`document.querySelector('#designer-move-file')
    .dispatchEvent(new Event('change', {bubbles:true})); true`);
  await waitFor(async () => browser.evaluate(`document.querySelector('#designer-move-status')
    .textContent.includes('replayable move')`), 10000, 'imported designer moves');
  await appendFrame('Imported JSON action script', Math.round(fps * 1.5));

  const replayAuditBaseline = await browser.evaluate(
    `window.MolariumChemistActions.history().length`);
  await browser.evaluate(`document.querySelector('#replay-designer-moves').click(); true`);
  let lastActionNumber = 0;
  const started = Date.now();
  const timeout = smoke ? 120000 : 45 * 60 * 1000;
  while (Date.now() - started < timeout) {
    const status = await browser.evaluate(`(() => ({
      text:document.querySelector('#designer-move-status').textContent,
      replayDisabled:document.querySelector('#replay-designer-moves').disabled,
      replayLabel:document.querySelector('#replay-designer-moves').textContent,
      exportReplayDisabled:document.querySelector('#export-designer-replay').disabled,
      notice:document.querySelector('#notice').classList.contains('hidden')
        ? '' : document.querySelector('#notice').textContent,
    }))()`);
    const match = /^Move (\d+) of (\d+)/.exec(status.text);
    const actionNumber = match ? Number(match[1]) : 0;
    if (actionNumber && actionNumber !== lastActionNumber) {
      lastActionNumber = actionNumber;
      await delay(70);
      const step = presentationScript.actions[actionNumber - 1];
      await appendFrame(`${actionNumber}. Press ${step.caption || step.action}`,
        Math.max(2, Math.round(fps * .25)), actionNumber - 1);
      const outcome = await waitForInterfaceAction(actionNumber, actionNumber - 1, step,
        replayAuditBaseline, Math.max(1000, timeout - (Date.now() - started)));
      if (outcome.status !== 'completed')
        throw new Error(`Molarium replay action ${actionNumber} failed: ${outcome.error || outcome.status}`);
      await delay(120);
      await appendFrame(`${actionNumber}. Result ${step.caption || step.action}`,
        holdFrames(step), actionNumber - 1);
      console.log(`Captured interface action ${actionNumber}/${presentationScript.actions.length} · ${step.action}`);
    }
    if (status.notice) throw new Error(`Molarium replay notice: ${status.notice}`);
    if (!status.exportReplayDisabled && status.replayLabel.includes('Replay story')) break;
    await delay(35);
  }
  if (lastActionNumber !== presentationScript.actions.length)
    throw new Error(`Interface replay stopped after action ${lastActionNumber}/${presentationScript.actions.length}`);
  await delay(250);
  await appendFrame('Replay completed in Molarium', Math.round(fps * 2.5));

  const videoPath = join(output, 'sos1-designer-moves-molarium-interface.mp4');
  const ffmpeg = Bun.spawn(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
    '-framerate', String(fps), '-i', join(frameDirectory, 'frame-%05d.png'),
    '-r', String(fps), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
    '-threads', '1', '-pix_fmt', 'yuv420p', '-map_metadata', '-1', '-fflags', '+bitexact',
    '-flags:v', '+bitexact', '-movflags', '+faststart', videoPath],
  { stdout:'pipe', stderr:'pipe' });
  if (await ffmpeg.exited !== 0)
    throw new Error(`FFmpeg failed: ${await new Response(ffmpeg.stderr).text()}`);
  const videoBytes = await readFile(videoPath);
  const probe = Bun.spawn(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames,duration',
    '-of', 'json', videoPath], { stdout:'pipe', stderr:'pipe' });
  if (await probe.exited !== 0) throw new Error(await new Response(probe.stderr).text());
  const stream = JSON.parse(await new Response(probe.stdout).text()).streams?.[0];
  const audit = await browser.evaluate(`window.MolariumChemistActions.history()`);
  const auditBytes = Buffer.from(`${JSON.stringify({ schema:'molarium.chemist-actions/v1',
    sourceScript:relative(root, scriptPath), records:audit }, null, 2)}\n`);
  await writeFile(join(output, 'chemist-action-audit.json'), auditBytes);
  const rendererBytes = await readFile(fileURLToPath(import.meta.url));
  const manifest = {
    schema:'molarium.designer-moves-interface-render/v1',
    generatedAt:new Date().toISOString(),
    operationBoundary:'The renderer imports JSON and presses visible Molarium controls; all molecular operations execute through window.MolariumChemistActions.',
    sourceScript:{ path:relative(root, scriptPath), fileSha256:digest(sourceScriptBytes),
      actionScriptSha256:await actionScriptSha256(sourceScript), actions:sourceScript.actions.length },
    presentationScript:{ actionScriptSha256:await actionScriptSha256(presentationScript),
      actions:presentationScript.actions.length, insertedViewActions:
        presentationScript.actions.length - sourceActions.length },
    renderer:{ path:relative(root, fileURLToPath(import.meta.url)), sha256:digest(rendererBytes),
      browserProduct:browserVersion.product, userAgent:browserVersion.userAgent },
    viewport:{ width, height, deviceScaleFactor:1 },
    audit:{ path:'chemist-action-audit.json', sha256:digest(auditBytes), records:audit.length },
    captures:captured,
    video:{ filename:basename(videoPath), sha256:digest(videoBytes), bytes:videoBytes.length,
      width:Number(stream.width), height:Number(stream.height), fps,
      frames:Number(stream.nb_read_frames), durationSeconds:Number(stream.duration) },
    complete:true,
  };
  await writeFile(join(output, 'render-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${relative(root, videoPath)} · ${manifest.video.durationSeconds.toFixed(2)} s · ${manifest.video.sha256}`);
} finally {
  await browser.close();
  await rm(temporary, { recursive:true, force:true });
}
