import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionScriptSha256, validateActionScript } from '../design-history/replay.mjs';
import { buildPocketInterfaceStory } from '../design-history/interface-story.mjs';
import { promoteCompletedRender } from './atomic-render-output.mjs';
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
const presentationScriptSha256 = await actionScriptSha256(presentationScript);

await mkdir(dirname(output), { recursive:true });
const temporary = await mkdtemp(join(tmpdir(), 'molarium-interface-movie-'));
const publicationStaging = await mkdtemp(join(dirname(output),
  `.${basename(output)}.pending-`));
const presentationPath = join(temporary, 'presentation.action-script.json');
const frameDirectory = join(temporary, 'frames');
const qaDirectory = join(publicationStaging, 'qa');
let browser = null;
let browserVersion = null;
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
  const step = actionIndex == null ? null : presentationScript.actions[actionIndex] || null;
  captured.push({ label, actionIndex, action:step?.action || null,
    caption:step?.caption || null, repeats, sha256, bytes:bytes.length, qaFilename:`qa/${qaFilename}`,
    firstFrame:frameIndex - repeats, lastFrame:frameIndex - 1 });
}

function holdFrames(step) {
  if (!step) return fps;
  if (step.action === 'view.setDisplay') return Math.round(fps * 1.1);
  if (step.action === 'view.focusComponent') return Math.round(fps * 2.4);
  if (step.action === 'designRoute.applyStep') return Math.round(fps * 1.8);
  if (step.action === 'pose.applySidechainRotamer') return Math.round(fps * 2.2);
  if (step.action === 'view.highlightAtoms') return Math.round(fps * 1.8);
  if (['designRoute.load', 'pose.enumerateSidechainRotamers',
    'pose.updateReceptorReference', 'pose.apply', 'optimization.run'].includes(step.action))
    return Math.round(fps * 1.5);
  return Math.max(5, Math.round(fps * .75));
}

async function waitForInterfaceAction(actionNumber, actionIndex, step, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let nextProgressCapture = Date.now() + 700;
  let lastProgressStatus = '';
  let progressCaptures = 0;
  let nextRotamerCapture = Date.now();
  let rotamerCaptures = 0;
  while (Date.now() < deadline) {
    const state = await browser.evaluate(`(() => {
      const records = window.MolariumChemistActions.history();
      // Runtime presentation and transport controls are also public API calls,
      // so array offsets are intentionally not stable. Constituent replay
      // actions have deterministic request IDs derived from the script hash.
      const record = records.find((entry) =>
        entry.requestId === 'story-${presentationScriptSha256.slice(0, 12)}-${actionNumber}') || null;
      return {
        record:record && record.status !== 'running'
          ? { status:record.status, error:record.error || null } : null,
        dockingStatus:document.querySelector('#docking-status')?.textContent || '',
      };
    })()`);
    if (state.record) return state.record;
    if (step.action === 'pose.applySidechainRotamer'
      && Date.now() >= nextRotamerCapture && rotamerCaptures < 30) {
      rotamerCaptures += 1;
      await appendFrame(`${actionNumber}. Phe890 motion ${rotamerCaptures}`, 1, actionIndex);
      nextRotamerCapture = Date.now() + Math.round(1000 / fps);
    }
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

async function waitForVisibleResult(actionNumber, timeoutMs = 5000) {
  await waitFor(async () => browser.evaluate(`(() => {
    const progress = document.querySelector('#designer-move-progress-label')?.textContent || '';
    const completed = Number(progress.split('/')[0]?.trim());
    const status = document.querySelector('#designer-move-status')?.textContent || '';
    return completed === ${actionNumber}
      && status.startsWith('Completed move ${actionNumber} of ');
  })()`), timeoutMs, `visible result checkpoint ${actionNumber}`);
  // Let the result caption, demo layout, and WebGL draw scheduled by the
  // checkpoint settle before taking the evidence frame.
  await delay(100);
}

try {
  await mkdir(frameDirectory);
  await mkdir(qaDirectory, { recursive:true });
  await writeFile(presentationPath, `${JSON.stringify(presentationScript, null, 2)}\n`);
  browser = await startMolariumBrowser({ root,
    appPath:'index.html?blank=1&designer-moves-movie=1', width, height, localOnly:true });
  browserVersion = await browser.client.call('Browser.getVersion');
  await waitFor(async () => browser.evaluate(`(async () => {
    if (document.readyState !== 'complete' || !window.MolariumChemistActionsReady
      || !document.querySelector('#designer-move-file')) return false;
    await window.MolariumChemistActionsReady;
    return true;
  })()`), 30000, 'ready Molarium Chemist Actions and Designer moves UI');
  await browser.evaluate(`document.querySelector('.mode-bar button[data-mode="build"]').click();
    document.querySelector('#designer-move-tools').scrollIntoView({block:'center'}); true`);
  await delay(400);
  await appendFrame('Molarium Design interface before import', Math.round(fps * 1.5));

  const documentNode = await browser.client.call('DOM.getDocument', { depth:1 });
  const fileNode = await browser.client.call('DOM.querySelector', {
    nodeId:documentNode.root.nodeId, selector:'#designer-move-file',
  });
  await browser.client.call('DOM.setFileInputFiles', {
    nodeId:fileNode.nodeId, files:[presentationPath],
  });
  await browser.evaluate(`document.querySelector('#designer-move-file')
    .dispatchEvent(new Event('change', {bubbles:true})); true`);
  try {
    await waitFor(async () => browser.evaluate(`document.querySelector('#designer-move-status')
      .textContent.includes('replayable move')`), 30000, 'imported designer moves');
  } catch (error) {
    const diagnostic = await browser.evaluate(`(() => ({
      status:document.querySelector('#designer-move-status')?.textContent || '',
      notice:document.querySelector('#notice')?.classList.contains('hidden')
        ? '' : document.querySelector('#notice')?.textContent || '',
    }))()`);
    throw new Error(`${error.message}; status=${JSON.stringify(diagnostic.status)}; notice=${JSON.stringify(diagnostic.notice)}`);
  }
  await appendFrame('Imported JSON action script', Math.round(fps * 1.5));

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
      replayStatus:document.querySelector('#designer-move-tools')?.dataset.replayStatus || 'unknown',
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
        Math.max(3, Math.round(fps * (['designRoute.applyStep',
          'pose.applySidechainRotamer'].includes(step.action) ? .7 : .35))), actionNumber - 1);
      const outcome = await waitForInterfaceAction(actionNumber, actionNumber - 1, step,
        Math.max(1000, timeout - (Date.now() - started)));
      if (outcome.status !== 'completed')
        throw new Error(`Molarium replay action ${actionNumber} failed: ${outcome.error || outcome.status}`);
      await waitForVisibleResult(actionNumber);
      await appendFrame(`${actionNumber}. Result ${step.caption || step.action}`,
        holdFrames(step), actionNumber - 1);
      console.log(`Captured interface action ${actionNumber}/${presentationScript.actions.length} · ${step.action}`);
    }
    if (status.notice) throw new Error(`Molarium replay notice: ${status.notice}`);
    if (status.replayStatus === 'failed')
      throw new Error('Molarium interface replay failed its action or result expectations');
    if (status.replayStatus === 'completed' && !status.exportReplayDisabled
      && status.replayLabel.includes('Replay story')) break;
    await delay(35);
  }
  if (lastActionNumber !== presentationScript.actions.length)
    throw new Error(`Interface replay stopped after action ${lastActionNumber}/${presentationScript.actions.length}`);
  const replayStatus = await browser.evaluate(
    `document.querySelector('#designer-move-tools')?.dataset.replayStatus || 'unknown'`);
  if (replayStatus !== 'completed')
    throw new Error(`Refusing to render an interface replay with status ${replayStatus}`);
  await delay(250);
  await appendFrame('Replay completed in Molarium', Math.round(fps * 2.5));

  const videoPath = join(publicationStaging, 'sos1-designer-moves-molarium-interface.mp4');
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
  await writeFile(join(publicationStaging, 'chemist-action-audit.json'), auditBytes);
  const rendererBytes = await readFile(fileURLToPath(import.meta.url));
  const manifest = {
    schema:'molarium.designer-moves-interface-render/v1',
    generatedAt:new Date().toISOString(),
    operationBoundary:'The renderer imports JSON and presses visible Molarium controls; all molecular operations execute through window.MolariumChemistActions.',
    sourceScript:{ path:relative(root, scriptPath), fileSha256:digest(sourceScriptBytes),
      actionScriptSha256:await actionScriptSha256(sourceScript), actions:sourceScript.actions.length },
    presentationScript:{ actionScriptSha256:presentationScriptSha256,
      actions:presentationScript.actions.length, insertedViewActions:
        presentationScript.actions.length - sourceActions.length,
      timeline:presentationScript.actions.map((step, index) => ({
        actionNumber:index + 1, action:step.action, caption:step.caption || null,
      })) },
    renderer:{ path:relative(root, fileURLToPath(import.meta.url)), sha256:digest(rendererBytes),
      browserProduct:browserVersion.product, userAgent:browserVersion.userAgent },
    viewport:{ width, height, deviceScaleFactor:1 },
    replay:{ status:replayStatus,
      exactExpectationCount:presentationScript.actions.filter((step) => step.expect).length },
    audit:{ path:'chemist-action-audit.json', sha256:digest(auditBytes), records:audit.length },
    captures:captured,
    video:{ filename:basename(videoPath), sha256:digest(videoBytes), bytes:videoBytes.length,
      width:Number(stream.width), height:Number(stream.height), fps,
      frames:Number(stream.nb_read_frames), durationSeconds:Number(stream.duration) },
    complete:true,
  };
  await writeFile(join(publicationStaging, 'render-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`);
  await promoteCompletedRender({ stagingDirectory:publicationStaging,
    outputDirectory:output, complete:manifest.complete && replayStatus === 'completed' });
  console.log(`Wrote ${relative(root, join(output, basename(videoPath)))} · ${manifest.video.durationSeconds.toFixed(2)} s · ${manifest.video.sha256}`);
} finally {
  await browser?.close();
  await Promise.all([
    rm(temporary, { recursive:true, force:true }),
    rm(publicationStaging, { recursive:true, force:true }),
  ]);
}
