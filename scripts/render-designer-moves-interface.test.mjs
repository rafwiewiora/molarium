import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHEMIST_ACTIONS_SCHEMA } from '../chemist-actions.mjs';
import { replayActionScript } from '../design-history/replay.mjs';
import { promoteCompletedRender } from './atomic-render-output.mjs';

const scratch = await mkdtemp(join(tmpdir(), 'molarium-render-publication-test-'));
try {
  const output = join(scratch, 'published');
  const rejectedStage = join(scratch, 'rejected-stage');
  await mkdir(output); await mkdir(rejectedStage);
  await writeFile(join(output, 'movie.mp4'), 'reviewed movie');
  await writeFile(join(output, 'paper-frame.png'), 'reviewed frame');
  await writeFile(join(rejectedStage, 'movie.mp4'), 'failed replay movie');
  await writeFile(join(rejectedStage, 'paper-frame.png'), 'failed replay frame');
  const failedReplay = await replayActionScript(Object.freeze({
    schema:CHEMIST_ACTIONS_SCHEMA,
    async execute() { return { result:{ checkpoint:{ feasible:false } } }; },
  }), { schema:'molarium.chemist-action-script/v1', label:'Expectation failure fixture',
    actions:[{ action:'session.inspect', args:{ scope:'ligand' },
      expect:{ 'checkpoint.feasible':true } }] });
  assert.equal(failedReplay.status, 'failed');
  assert.match(failedReplay.steps[0].error, /expectation failed/);
  await assert.rejects(() => promoteCompletedRender({ stagingDirectory:rejectedStage,
    outputDirectory:output, complete:failedReplay.status === 'completed' }),
  /Refusing to publish an incomplete/);
  assert.equal(await readFile(join(output, 'movie.mp4'), 'utf8'), 'reviewed movie');
  assert.equal(await readFile(join(output, 'paper-frame.png'), 'utf8'), 'reviewed frame');

  const acceptedStage = join(scratch, 'accepted-stage');
  await mkdir(acceptedStage);
  await writeFile(join(acceptedStage, 'movie.mp4'), 'verified movie');
  await writeFile(join(acceptedStage, 'paper-frame.png'), 'verified frame');
  await promoteCompletedRender({ stagingDirectory:acceptedStage,
    outputDirectory:output, complete:true });
  assert.equal(await readFile(join(output, 'movie.mp4'), 'utf8'), 'verified movie');
  assert.equal(await readFile(join(output, 'paper-frame.png'), 'utf8'), 'verified frame');

  const renderer = await readFile(new URL('./render-designer-moves-interface.mjs', import.meta.url),
    'utf8');
  assert.match(renderer, /replayStatus !== 'completed'/);
  assert.match(renderer, /promoteCompletedRender\(\{ stagingDirectory:publicationStaging/);
  assert.match(renderer, /await window\.MolariumChemistActionsReady/,
    'the renderer must await API installation before loading the replay');
  assert.match(renderer, /document\.readyState !== 'complete'/,
    'the renderer must not race the application module and its UI listeners');
  assert.match(renderer, /action:'designerScript\.load'/,
    'the renderer imports the exact JSON through the public Agent API');
  assert.match(renderer, /requireExplicitRunDirectory\(args/,
    'the renderer must never select an SOS1 run implicitly');
  assert.match(renderer, /verifyAcceptedSos1Run\(runDirectory\)/,
    'accepted rendering must retain the independent holdout gate');
  assert.match(renderer, /const resultClass = valueFor\('--result-class'\) \|\| 'accepted'/,
    'accepted rendering must remain the default');
  assert.match(renderer, /\['accepted','complete-frozen'\]\.includes\(resultClass\)/,
    'the renderer must expose only the two explicit scientific result classes');
  assert.match(renderer, /verifyCompleteFrozenSos1Run\(runDirectory\)/,
    'an explicitly requested complete-frozen result must verify all immutable checkpoints');
  assert.match(renderer, /buildFrozenSos1ReplayScript\(verifiedRun\)/,
    'a complete-frozen render must use provenance that does not claim acceptance');
  assert.match(renderer, /const replayKind = valueFor\('--replay-kind'\) \|\| 'executable'/,
    'the executable public-action replay must remain the default');
  assert.match(renderer, /\['executable','checkpoint-review'\]\.includes\(replayKind\)/,
    'the renderer must expose only executable and exact-checkpoint replay modes');
  assert.match(renderer, /frozenCheckpointReviewScript\(/,
    'complete-frozen calculation-free review must use the verified checkpoint builder');
  assert.match(renderer, /campaignPath:`\.\/\$\{SOS1_PREDICTION_CAMPAIGN_DIRECTORY\}/,
    'complete-frozen checkpoint review must reference published campaigns instead of inlining them');
  assert.match(renderer, /replayKind === 'checkpoint-review' \? SOS1_PREDICTION_REVIEW/,
    'checkpoint-review render provenance must name the published action script');
  assert.match(renderer, /calculationPolicy:'none', exactFullSystemCheckpoints:SOS1_STEP_IDS\.length/,
    'checkpoint-review renders must declare their calculation-free boundary');
  assert.match(renderer, /resultClass === 'accepted' \? \{ acceptedRun:/,
    'only the strict accepted path may emit acceptedRun manifest provenance');
  assert.match(renderer, /holdoutAccepted:verifiedRun\.evaluation\.accepted === true/,
    'every render must state the attached post-freeze evaluation outcome honestly');
  assert.match(renderer, /verifyBrowserLocalLabCapture\(browser\)/,
    'the renderer must prove that publication assets use the real Local Lab policy');
  assert.match(renderer, /localOnly:true/,
    'the renderer must start the network-locked Local Lab server');
  assert.match(renderer, /appPath:'index\.html\?blank=1&designer-moves-movie=1'/,
    'the renderer must begin on the real blank Molarium canvas');
  assert.match(renderer, /verifyBlankInterfaceSnapshot/,
    'the renderer must fail if the blank full-interface frame is missing');
  assert.match(renderer, /verifyPresentationCameraContract/,
    'the renderer must reject presentation scripts that refit the camera');
  assert.match(renderer, /verifyHighlightCameraAudit/,
    'the renderer must verify runtime camera preservation for every highlight');
  assert.match(renderer, /action:'designerScript\.inspect'/,
    'the renderer must inspect terminal review state through the public API');
  assert.match(renderer, /verifyCompletedInterfaceSnapshot/,
    'the renderer must reject a completed story whose arrows no longer work');
  assert.match(renderer, /presentation:\{ \.\.\.DESIGNER_MOVIE_PRESENTATION/,
    'the renderer manifest must retain its pacing and interface evidence');
  assert.match(renderer, /path:'source\.action-script\.json'/,
    'the selected public source actions must be retained with the render');
  assert.doesNotMatch(renderer, /DOM\.setFileInputFiles/,
    'the renderer must not depend on a synthetic operating-system file event');
  assert.match(renderer, /path:'presentation\.action-script\.json'/,
    'the exact public API replay JSON must be retained with the render artifact');
  assert.match(renderer, /auditRequestId:step\.auditRequestId \|\| null/,
    'paper checkpoints must retain immutable source-audit request IDs');
  assert.match(renderer, /entry\.requestId === 'story-/,
    'the renderer must identify constituent moves by public request ID, not audit-array position');
  assert.doesNotMatch(renderer, /records\[\$\{auditBaseline \+ actionNumber\}\]/,
    'public presentation and transport actions make audit-array offsets intentionally unstable');
  assert.doesNotMatch(renderer, /join\(output, 'qa'\)/,
    'QA/paper frames must never be written directly to the published directory');
  assert.doesNotMatch(renderer, /join\(output, 'sos1-designer-moves-molarium-interface\.mp4'\)/,
    'the MP4 must never be written directly to the published directory');

  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /tools\.dataset\.replayStatus = state\.designerMoveReplaying/,
    'the interface must expose final replay success or failure to the renderer');

  const browserHelper = await readFile(new URL('./headless-chrome.mjs', import.meta.url), 'utf8');
  assert.match(browserHelper, /MOLARIUM_HEADLESS_SOFTWARE_WEBGPU/,
    'the remote render must explicitly opt in to the Linux software WebGPU adapter');
  assert.match(browserHelper, /--enable-unsafe-webgpu/);
  assert.match(browserHelper, /--enable-features=UseSkiaRenderer,Vulkan/);
  assert.match(browserHelper, /--use-angle=swiftshader/);
  assert.match(browserHelper, /--use-vulkan=swiftshader/);
  assert.match(browserHelper, /--use-webgpu-adapter=swiftshader/);
  assert.match(browserHelper, /--disable-vulkan-surface/);
  assert.match(browserHelper, /--headless=new/);
  assert.match(app, /action:'designerScript\.loadRegistered', args:\{ storyId \}/,
    'story deep links must use the one public registered-story loader');
  assert.match(app, /action:'session\.clear', args:\{\}/,
    'blank deep links must clear through the public session route');
  assert.match(app, /await api\.execute\(\{ action:'interface\.presentDesignerStep'/,
    'visible replay presentation must be routed through the public API');
  assert.match(app, /runChemistUiAction\('designerScript\.export', \{ kind \}/,
    'human export buttons and agents must share the same serializer route');
  assert.match(app, /designerMoveReplayScheduled/,
    'scheduled playback must use an explicit single-flight guard');
  assert.match(app, /if \(!ownsDesignerMoveStatus\) updateDesignerMoveControls\(\)/,
    'the generic audit callback must not overwrite public replay presentation checkpoints');
  assert.doesNotMatch(app, /catch \{ return null; \}\s*finally \{ button\.disabled = false/,
    'build optimization must preserve the engine error in the public action audit');

  const paperBuilder = await readFile(new URL('../paper/scripts/build-sos1-paper-figure.py',
    import.meta.url), 'utf8');
  assert.match(paperBuilder, /manifest\.get\("complete"\) is not True/);
  assert.match(paperBuilder, /manifest\.get\("replay", \{\}\)\.get\("status"\) != "completed"/);
  assert.match(paperBuilder, /failed its render-manifest hash/);
  assert.match(paperBuilder, /"--run"[\s\S]*required=True/,
    'Figure 2 must require an explicit accepted run directory');
  assert.match(paperBuilder, /evaluation\.get\("accepted"\) is not True/,
    'Figure 2 must reject a failed holdout evaluation');
  assert.match(paperBuilder, /timeline_request_ids != source_request_ids/,
    'Figure 2 must reject a reordered or substituted presentation timeline');
} finally {
  await rm(scratch, { recursive:true, force:true });
}

console.log('Designer-moves renderer publication boundary: PASS');
