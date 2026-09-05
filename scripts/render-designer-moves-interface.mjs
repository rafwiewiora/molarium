import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionScriptSha256, validateActionScript } from '../design-history/replay.mjs';
import { acceptedCheckpointReviewScript } from
  '../design-history/accepted-checkpoint-review.mjs';
import { buildPocketInterfaceStory } from '../design-history/interface-story.mjs';
import { promoteCompletedRender } from './atomic-render-output.mjs';
import { DESIGNER_MOVIE_PRESENTATION, designerMoviePressFrames,
  designerMovieResultFrames, readBlankInterfaceSnapshot, verifyBlankInterfaceSnapshot,
  verifyCompletedInterfaceSnapshot, verifyHighlightCameraAudit,
  verifyMovieViewport, verifyPresentationCameraContract,
} from './designer-movie-presentation.mjs';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';
import { verifySos1AwwReceptorOnlyRun } from './sos1-aww-receptor-only-publication.mjs';
import { verifyAxhContinuation } from './sos1-axh-continuation.mjs';
import { verifySos1ExecutableScience } from './sos1-executable-science.mjs';
import { createNativeAuditCollector } from './native-audit-collector.mjs';
import { verifyBrowserLocalLabCapture } from './local-lab-capture.mjs';
import { buildAcceptedSos1ReplayScript, buildFrozenSos1ReplayScript,
  requireExplicitRunDirectory, verifyAcceptedSos1Run,
  verifyCompleteFrozenSos1Run, SOS1_STEP_IDS } from './sos1-accepted-run.mjs';
import { SOS1_PREDICTION_CAMPAIGN_DIRECTORY, SOS1_PREDICTION_REVIEW } from
  './publish-sos1-frozen-browser-replays.mjs';

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
const runDirectory = requireExplicitRunDirectory(args, { root });
const output = resolve(root, valueFor('--output')
  || join(relative(root, runDirectory), 'interface-movie'));
const width = Number(valueFor('--width') || 1600);
const height = Number(valueFor('--height') || 1000);
const fps = Number(valueFor('--fps') || 12);
const smoke = has('--smoke');
const viewport = verifyMovieViewport({ width, height, deviceScaleFactor:1 });
const sourceActionLimit = Number(valueFor('--source-actions') || 0);
const resultClass = valueFor('--result-class') || 'accepted';
if (!['accepted','complete-frozen','designer-intent','designer-intent-frozen'].includes(resultClass))
  throw new Error('--result-class must be accepted, complete-frozen, designer-intent, or designer-intent-frozen');
const designerIntent = resultClass.startsWith('designer-intent');
for (const executable of ['ffmpeg', 'ffprobe'])
  if (!Bun.which(executable)) throw new Error(`Required movie executable is unavailable: ${executable}`);
const replayKind = valueFor('--replay-kind') || 'executable';
if (!['executable','checkpoint-review'].includes(replayKind))
  throw new Error('--replay-kind must be executable or checkpoint-review');
// The accepted path remains the default and retains the independent holdout
// gate.  An honest complete-frozen render must be explicitly requested; it
// verifies the same immutable pre-holdout science but never claims acceptance.
const designerRun = designerIntent ? await verifySos1AwwReceptorOnlyRun(runDirectory,
  { requireAccepted:resultClass !== 'designer-intent-frozen' }) : null;
const verifiedRun = designerRun ? { ...designerRun,
  evaluation:designerRun.validation, evaluationBytes:designerRun.validationBytes }
  : resultClass === 'accepted'
  ? await verifyAcceptedSos1Run(runDirectory)
  : await verifyCompleteFrozenSos1Run(runDirectory);
const reviewCheckpoint = (stepId) => {
  const frozen = verifiedRun.checkpoints.get(stepId);
  const fullSystem = frozen.fullSystemCampaign;
  return { accepted:resultClass === 'accepted', completeFrozenPrediction:true,
    frozenBeforeHoldoutAccess:true, checkpointSha256:frozen.entry.sha256,
    campaignSha256:fullSystem.record.sha256,
    ...(resultClass === 'complete-frozen'
      ? { campaignPath:`./${SOS1_PREDICTION_CAMPAIGN_DIRECTORY}/${stepId}-campaign.json` }
      : { serializedCampaign:fullSystem.serializedCampaign }),
    campaignId:fullSystem.record.campaignId,
    branch:fullSystem.record.branch, commitId:fullSystem.record.commitId,
    snapshotId:fullSystem.record.snapshotId, label:`${stepId} prediction checkpoint` };
};
let verifiedReplay;
let designerReplayPath = null;
if (designerIntent) {
  const publicationDirectory = valueFor('--publication-directory') || 'publication';
  if (!/^publication(?:-[a-z0-9]+)*$/.test(publicationDirectory))
    throw new Error('Unknown staged publication directory');
  const declaration = JSON.parse(await readFile(join(runDirectory, publicationDirectory, 'declaration.json'), 'utf8'));
  if (declaration.sourceContinuation) {
    const continuation = await verifyAxhContinuation(resolve(root, declaration.sourceContinuation.directory), designerRun);
    if (digest(continuation.manifestBytes) !== declaration.sourceContinuation.manifestSha256
      || digest(continuation.comparisonBytes) !== declaration.sourceContinuation.comparisonSha256)
      throw new Error('AXH continuation provenance changed');
  }
  if (declaration.resultClass !== resultClass)
    throw new Error('Staged publication result class differs from the explicit render request');
  if (declaration.sourceRun?.id !== verifiedRun.runId
    || declaration.sourceRun?.manifestSha256 !== digest(verifiedRun.manifestBytes))
    throw new Error('Designer-intent publication does not bind the verified frozen run');
  const descriptor = replayKind === 'checkpoint-review'
    ? declaration.checkpointReview : declaration.executableReplay;
  designerReplayPath = descriptor.path;
  const scriptPath = resolve(root, designerReplayPath);
  if (!scriptPath.startsWith(`${root}/`)) throw new Error('Staged replay path escapes the repository');
  const scriptBytes = await readFile(scriptPath);
  if (digest(scriptBytes) !== descriptor.sha256)
    throw new Error('Staged designer-intent script bytes changed');
  const script = JSON.parse(scriptBytes);
  validateActionScript(script);
  if (await actionScriptSha256(script) !== descriptor.actionScriptSha256)
    throw new Error('Staged designer-intent action-script fingerprint changed');
  for (const checkpoint of declaration.checkpoints) {
    const path = resolve(root, checkpoint.path);
    if (!path.startsWith(`${root}/`) || digest(await readFile(path)) !== checkpoint.sha256)
      throw new Error('Staged designer-intent checkpoint changed');
  }
  verifiedReplay = { script,
    sourceAuditSha256:replayKind === 'executable' ? digest(verifiedRun.auditBytes) : null,
    sourceAuditRecords:verifiedRun.records.length,
    selectedAuditSequences:verifiedRun.records.map((record) => record.sequence) };
} else if (replayKind === 'checkpoint-review') {
  let script;
  if (resultClass === 'complete-frozen') {
    const declaration = JSON.parse(await readFile(resolve(root,
      'design-history/publications/sos1/browser-replay-declaration.json'), 'utf8'));
    if (declaration.sourceRun?.id !== verifiedRun.runId)
      throw new Error('Published checkpoint review does not belong to the selected run');
    script = JSON.parse(await readFile(resolve(root, SOS1_PREDICTION_REVIEW), 'utf8'));
    validateActionScript(script);
    if (script.actions.length !== SOS1_STEP_IDS.length + 1
      || script.actions[0]?.review?.registeredStartingHit !== true)
      throw new Error('Published checkpoint review lacks the exact registered starting hit');
  } else {
    const checkpoints = SOS1_STEP_IDS.map(reviewCheckpoint);
    script = await acceptedCheckpointReviewScript({
      label:`SOS1 accepted checkpoint review ${verifiedRun.runId}`, checkpoints });
  }
  verifiedReplay = { script, sourceAuditSha256:null, sourceAuditRecords:null,
    selectedAuditSequences:[] };
} else verifiedReplay = resultClass === 'accepted'
  ? await buildAcceptedSos1ReplayScript(verifiedRun)
  : await buildFrozenSos1ReplayScript(verifiedRun);
const sourceScript = verifiedReplay.script;
const sourceScriptBytes = Buffer.from(`${JSON.stringify(sourceScript, null, 2)}\n`);
const sourceScriptArtifactPath = designerReplayPath || (resultClass === 'complete-frozen'
  && replayKind === 'checkpoint-review' ? SOS1_PREDICTION_REVIEW
  : `${relative(root, runDirectory)}/${resultClass === 'accepted'
    ? 'accepted' : 'complete-frozen'}-${replayKind === 'executable'
    ? 'selected-route' : 'checkpoint-review'}.action-script.json`);
const sourceActions = smoke ? sourceScript.actions.slice(0, 4)
  : sourceActionLimit > 0 ? sourceScript.actions.slice(0, sourceActionLimit)
    : sourceScript.actions;
const presentationScript = buildPocketInterfaceStory({
  schema:sourceScript.schema,
  label:sourceScript.label,
  actions:sourceActions,
}, { sourcePath:sourceScriptArtifactPath, sourceSha256:digest(sourceScriptBytes) });
const presentationScriptSha256 = await actionScriptSha256(presentationScript);
const presentationBytes = Buffer.from(`${JSON.stringify(presentationScript, null, 2)}\n`);
const cameraContract = verifyPresentationCameraContract(presentationScript);
// A checkpoint review starts from a genuinely blank canvas.  Its first
// campaign therefore has to exist before the public focus action can resolve a
// ligand.  Keep those public setup actions in the audit, but do not present the
// transient whole-protein import as a settled prediction checkpoint.  The
// first visible molecular frame is the result of the one allowed focus action;
// every later campaign import preserves that camera.
const checkpointReviewBootstrapEnd = replayKind === 'checkpoint-review'
  ? presentationScript.actions.findIndex((step) => step.action === 'view.focusComponent') + 1
  : 0;
if (replayKind === 'checkpoint-review' && checkpointReviewBootstrapEnd < 1)
  throw new Error('Checkpoint review is missing its initial public pocket-focus action');

await mkdir(dirname(output), { recursive:true });
const temporary = await mkdtemp(join(tmpdir(), 'molarium-interface-movie-'));
const publicationStaging = await mkdtemp(join(dirname(output),
  `.${basename(output)}.pending-`));
const sourceScriptPath = join(publicationStaging, 'source.action-script.json');
const presentationPath = join(publicationStaging, 'presentation.action-script.json');
const frameDirectory = join(temporary, 'frames');
const qaDirectory = join(publicationStaging, 'qa');
let browser = null;
let browserVersion = null;
let networkPolicy = null;
let initialInterface = null;
let completedInterface = null;
let highlightCameraAudit = null;
const captured = [];
const depictionChecks = [];
let frameIndex = 0;
let publicationPromoted = false;
const auditCollector = createNativeAuditCollector();

async function collectNativeAudit() {
  const chunk = await browser.evaluate(`window.MolariumChemistActions.history()
    .filter((record) => record.sequence > ${auditCollector.throughSequence}
      && record.status !== 'running')`);
  auditCollector.append(chunk);
}

const TWO_D_SETTLED_ACTIONS = new Set([
  'designRoute.load', 'protein.prepare', 'designRoute.applyStep', 'pose.apply',
  'pose.applySidechainRotamer', 'optimization.run', 'campaign.import',
]);

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

async function waitForVisibleResult(actionNumber, step, timeoutMs = 5000) {
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
  if (TWO_D_SETTLED_ACTIONS.has(step.action)
    || step.action === 'view.focusComponent' && checkpointReviewBootstrapEnd > 0) {
    const depiction = await browser.evaluate(`(async () => {
      const started = performance.now();
      let panel = null, svg = null;
      while (performance.now() - started < 30000) {
        panel = document.querySelector('#structure-2d-panel');
        svg = document.querySelector('#structure-2d-drawing svg');
        if (panel?.dataset?.error) throw new Error(panel.dataset.error);
        if (panel && !panel.classList.contains('hidden') && !panel.dataset.pending && svg) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (!svg) throw new Error('Timed out waiting for the visible 2D depiction');
      return { label:document.querySelector('#structure-2d-label')?.textContent?.trim() || '',
        hasSvg:Boolean(svg), error:panel?.dataset?.error || null,
        atomGraphics:svg?.querySelectorAll('[class*="atom-"]').length || 0,
        bondGraphics:svg?.querySelectorAll('[class*="bond-"]').length || 0,
        viewBoxWidth:svg?.viewBox?.baseVal?.width || 0,
        viewBoxHeight:svg?.viewBox?.baseVal?.height || 0,
        visibleWidth:svg?.getBoundingClientRect().width || 0,
        visibleHeight:svg?.getBoundingClientRect().height || 0 };
    })()`);
    if (!depiction.hasSvg || depiction.error || depiction.atomGraphics < 1
      || depiction.bondGraphics < 1
      || depiction.visibleWidth < 40 || depiction.visibleHeight < 40
      || depiction.viewBoxWidth <= 0 || depiction.viewBoxHeight <= 0)
      throw new Error(`Incomplete 2D depiction after action ${actionNumber}: ${JSON.stringify(depiction)}`);
    depictionChecks.push({ actionNumber, action:step.action, ...depiction });
  }
}

try {
  await mkdir(frameDirectory);
  await mkdir(qaDirectory, { recursive:true });
  await writeFile(sourceScriptPath, sourceScriptBytes);
  await writeFile(presentationPath, presentationBytes);
  browser = await startMolariumBrowser({ root,
    appPath:'index.html?blank=1&designer-moves-movie=1', width, height, localOnly:true });
  browserVersion = await browser.client.call('Browser.getVersion');
  await waitFor(async () => browser.evaluate(`(async () => {
    if (document.readyState !== 'complete' || !window.MolariumChemistActionsReady
      || !document.querySelector('#designer-move-file')) return false;
    await window.MolariumChemistActionsReady;
    return true;
  })()`), 30000, 'ready Molarium Chemist Actions and Designer moves UI');
  networkPolicy = await verifyBrowserLocalLabCapture(browser);
  await browser.evaluate(`document.querySelector('.mode-bar button[data-mode="build"]').click();
    document.querySelector('#designer-move-tools').scrollIntoView({block:'center'}); true`);
  await delay(400);
  initialInterface = verifyBlankInterfaceSnapshot(await readBlankInterfaceSnapshot(browser));
  await appendFrame('Molarium Design interface before import', Math.round(fps
    * DESIGNER_MOVIE_PRESENTATION.seconds.blankCanvas));

  const importEnvelope = await browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({
    requestId:`renderer-import-${presentationScriptSha256.slice(0, 12)}`,
    action:'designerScript.load', args:{ script:presentationScript },
  })})`);
  if (importEnvelope?.status !== 'completed')
    throw new Error(`Public designerScript.load failed: ${importEnvelope?.error || importEnvelope?.status || 'unknown status'}`);
  await waitFor(async () => browser.evaluate(`document.querySelector('#designer-move-status')
    .textContent.includes('replayable move')`), 10000, 'visible imported designer moves');
  await appendFrame('Imported JSON action script', Math.round(fps
    * DESIGNER_MOVIE_PRESENTATION.seconds.importedStory));

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
      const checkpointBootstrap = checkpointReviewBootstrapEnd > 0
        && actionNumber <= checkpointReviewBootstrapEnd;
      if (!checkpointBootstrap)
        await appendFrame(`${actionNumber}. Press ${step.caption || step.action}`,
          designerMoviePressFrames(step, fps), actionNumber - 1);
      const outcome = await waitForInterfaceAction(actionNumber, actionNumber - 1, step,
        Math.max(1000, timeout - (Date.now() - started)));
      if (outcome.status !== 'completed')
        throw new Error(`Molarium replay action ${actionNumber} failed: ${outcome.error || outcome.status}`);
      await waitForVisibleResult(actionNumber, step);
      await collectNativeAudit();
      if (!checkpointBootstrap)
        await appendFrame(`${actionNumber}. Result ${step.caption || step.action}`,
          designerMovieResultFrames(step, fps), actionNumber - 1);
      else if (actionNumber === checkpointReviewBootstrapEnd)
        await appendFrame('First frozen prediction checkpoint in fixed local pocket',
          designerMovieResultFrames(step, fps), actionNumber - 1);
      console.log(`${checkpointBootstrap ? 'Executed checkpoint-review bootstrap' : 'Captured interface action'} ${actionNumber}/${presentationScript.actions.length} · ${step.action}`);
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
  completedInterface = verifyCompletedInterfaceSnapshot(await browser.evaluate(`(async () => {
    const inspected = await window.MolariumChemistActions.execute({
      requestId:'renderer-terminal-review-${presentationScriptSha256.slice(0, 12)}',
      action:'designerScript.inspect', args:{}
    });
    const state = inspected?.result?.designerScript || {};
    return {
      replayStatus:document.querySelector('#designer-move-tools')?.dataset.replayStatus || null,
      progress:document.querySelector('#designer-move-progress-label')?.textContent?.trim() || '',
      previousEnabled:!document.querySelector('#previous-designer-move')?.disabled,
      nextEnabled:!document.querySelector('#next-designer-move')?.disabled,
      playLabel:document.querySelector('#replay-designer-moves')?.textContent?.trim() || '',
      cueCount:document.querySelectorAll('.designer-move-cue').length,
      demoActive:document.body.classList.contains('designer-move-demo-active'),
      review:{ ...(state.review || {}), index:state.index, frontier:state.frontier },
    };
  })()`), presentationScript.actions.length);
  await appendFrame('Replay completed in Molarium', Math.round(fps
    * DESIGNER_MOVIE_PRESENTATION.seconds.completedStory));

  await collectNativeAudit();
  const audit = auditCollector.snapshot();
  const recomputedScience = designerIntent && replayKind === 'executable'
    && sourceActions.some((step) => step.args?.stepId === 'finish-bay-293')
    ? verifySos1ExecutableScience(audit) : null;

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
  highlightCameraAudit = verifyHighlightCameraAudit(audit, cameraContract.highlightCount);
  const auditBytes = Buffer.from(`${JSON.stringify({ schema:'molarium.chemist-actions/v1',
    sourceScript:sourceScriptArtifactPath, records:audit }, null, 2)}\n`);
  await writeFile(join(publicationStaging, 'chemist-action-audit.json'), auditBytes);
  const rendererBytes = await readFile(fileURLToPath(import.meta.url));
  const manifest = {
    schema:'molarium.designer-moves-interface-render/v1',
    generatedAt:new Date().toISOString(),
    operationBoundary:'The renderer imports JSON and presses visible Molarium controls; all molecular operations execute through window.MolariumChemistActions.',
    sourceRun:{ id:verifiedRun.runId, resultClass, replayKind,
      predictionManifestSha256:digest(verifiedRun.manifestBytes),
      evaluationSummarySha256:digest(verifiedRun.evaluationBytes),
      ...(designerIntent ? { designerIntentReferenceInformed:verifiedRun.referenceInformed,
        receptorPredictionScope:'fixed ligand; Phe890 side-chain response' } : {}),
      holdoutAccepted:verifiedRun.evaluation.accepted === true },
    ...(resultClass === 'accepted' ? { acceptedRun:{ id:verifiedRun.runId,
      predictionManifestSha256:digest(verifiedRun.manifestBytes),
      evaluationSummarySha256:digest(verifiedRun.evaluationBytes), accepted:true } } : {}),
    sourceScript:{ path:'source.action-script.json', provenancePath:sourceScriptArtifactPath,
      fileSha256:digest(sourceScriptBytes),
      actionScriptSha256:await actionScriptSha256(sourceScript), actions:sourceScript.actions.length,
      ...(verifiedReplay.sourceAuditSha256 ? {
        sourceAuditSha256:verifiedReplay.sourceAuditSha256,
        sourceAuditRecords:verifiedReplay.sourceAuditRecords,
        selectedAuditSequences:verifiedReplay.selectedAuditSequences,
      } : { calculationPolicy:'none', exactFullSystemCheckpoints:designerIntent
        ? sourceScript.actions.filter((step) => step.action === 'campaign.import').length
        : SOS1_STEP_IDS.length }) },
    presentationScript:{ path:'presentation.action-script.json',
      fileSha256:digest(presentationBytes), actionScriptSha256:presentationScriptSha256,
      actions:presentationScript.actions.length, insertedViewActions:
        presentationScript.actions.length - sourceActions.length,
      timeline:presentationScript.actions.map((step, index) => ({
        actionNumber:index + 1, action:step.action, caption:step.caption || null,
        auditSequence:step.auditSequence || null,
        auditRequestId:step.auditRequestId || null,
      })) },
    renderer:{ path:relative(root, fileURLToPath(import.meta.url)), sha256:digest(rendererBytes),
      browserProduct:browserVersion.product, userAgent:browserVersion.userAgent },
    viewport,
    networkPolicy,
    presentation:{ ...DESIGNER_MOVIE_PRESENTATION, initialInterface,
      completedInterface, cameraContract, highlightCameraAudit,
      depictionChecks,
      checkpointReviewBootstrap:checkpointReviewBootstrapEnd > 0 ? {
        publicActionCount:checkpointReviewBootstrapEnd,
        firstVisibleMolecularFrame:'result of view.focusComponent',
        transientWholeProteinFramePublished:false,
      } : null },
    replay:{ status:replayStatus,
      exactExpectationCount:presentationScript.actions.filter((step) => step.expect).length },
    ...(recomputedScience ? { recomputedScience } : {}),
    audit:{ path:'chemist-action-audit.json', sha256:digest(auditBytes), records:audit.length,
      collection:'incremental unmodified public API history; contiguous native sequence numbers' },
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
  publicationPromoted = true;
  console.log(`Wrote ${relative(root, join(output, basename(videoPath)))} · ${manifest.video.durationSeconds.toFixed(2)} s · ${manifest.video.sha256}`);
} catch (error) {
  if (browser) {
    try {
      await collectNativeAudit();
      const records = auditCollector.snapshot();
      await writeFile(join(publicationStaging, 'failed-chemist-action-audit.json'),
        `${JSON.stringify({ records }, null, 2)}\n`);
    } catch (auditError) { console.error(`Could not retrieve failed browser audit: ${auditError}`); }
  }
  await writeFile(join(publicationStaging, 'failed-render.json'), `${JSON.stringify({
    complete:false, error:String(error.stack || error), frameDirectory,
    sourceScript:sourceScriptArtifactPath, captures:captured,
    sourceRun:{ id:verifiedRun.runId, resultClass, replayKind },
  }, null, 2)}\n`);
  console.error(`Unpublished capture evidence preserved at ${publicationStaging}`);
  throw error;
} finally {
  await browser?.close();
  if (publicationPromoted) await Promise.all([
    rm(temporary, { recursive:true, force:true }),
    rm(publicationStaging, { recursive:true, force:true }),
  ]);
}
