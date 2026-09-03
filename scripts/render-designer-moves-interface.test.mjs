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

  const paperBuilder = await readFile(new URL('../paper/scripts/build-sos1-paper-figure.py',
    import.meta.url), 'utf8');
  assert.match(paperBuilder, /manifest\.get\("complete"\) is not True/);
  assert.match(paperBuilder, /manifest\.get\("replay", \{\}\)\.get\("status"\) != "completed"/);
  assert.match(paperBuilder, /failed its render-manifest hash/);
} finally {
  await rm(scratch, { recursive:true, force:true });
}

console.log('Designer-moves renderer publication boundary: PASS');
