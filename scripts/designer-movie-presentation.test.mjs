import assert from 'node:assert/strict';
import { DESIGNER_MOVIE_PRESENTATION, designerMoviePressFrames,
  designerMovieResultFrames, verifyBlankInterfaceSnapshot,
  verifyCompletedInterfaceSnapshot, verifyHighlightCameraAudit,
  verifyMovieViewport, verifyPresentationCameraContract,
} from './designer-movie-presentation.mjs';

assert.equal(DESIGNER_MOVIE_PRESENTATION.schema,
  'molarium.designer-moves-interface-presentation/v1');
assert.equal(designerMoviePressFrames({ action:'session.inspect' }, 10), 8);
assert.equal(designerMoviePressFrames({ action:'designRoute.applyStep' }, 10), 12);
assert.equal(designerMovieResultFrames({ action:'session.inspect' }, 10), 15);
assert.equal(designerMovieResultFrames({ action:'pose.refine' }, 10), 35);
assert.deepEqual(verifyMovieViewport({ width:1600, height:1000, deviceScaleFactor:1 }),
  { width:1600, height:1000, deviceScaleFactor:1, verified:true });
assert.throws(() => verifyMovieViewport({ width:1200, height:1000 }), /at least 1280px/);

const blank = {
  brand:'MOLARIUM', modeLabels:['View', 'Design', 'Simulate'], activeMode:'build',
  viewerHintVisible:true, moleculeInfoHidden:true, sceneHidden:true,
  visibleRegions:{ header:true, leftPanel:true, viewer:true, rightPanel:true },
};
assert.equal(verifyBlankInterfaceSnapshot(blank).verified, true);
assert.throws(() => verifyBlankInterfaceSnapshot({ ...blank, viewerHintVisible:false }),
  /blank-canvas loader/);

const stableCameraScript = { actions:[
  { action:'protein.prepare', args:{} },
  { action:'view.focusComponent', args:{ kind:'ligand', ordinal:0 } },
  { action:'view.highlightAtoms', args:{ atomIds:['atom-1'] } },
] };
assert.deepEqual(verifyPresentationCameraContract(stableCameraScript), {
  verified:true, focusComponentCount:1, focusAtomsCount:0, setCameraCount:0,
  highlightCount:1,
});
assert.throws(() => verifyPresentationCameraContract({ actions:[
  ...stableCameraScript.actions, { action:'view.focusAtoms', args:{ atomIds:['atom-1'] } },
] }), /must not refit/);
assert.throws(() => verifyPresentationCameraContract({ actions:[
  ...stableCameraScript.actions, { action:'view.setCamera', args:{} },
] }), /camera jumps/);

const completed = {
  replayStatus:'completed', progress:'3 / 3', previousEnabled:true, nextEnabled:false,
  playLabel:'↻ Replay story', cueCount:0, demoActive:false,
  review:{ completed:true, index:3, frontier:3, checkpointCount:4 },
};
assert.equal(verifyCompletedInterfaceSnapshot(completed, 3).verified, true);
assert.throws(() => verifyCompletedInterfaceSnapshot({ ...completed, previousEnabled:false }, 3),
  /cannot be reviewed backward/);
assert.throws(() => verifyCompletedInterfaceSnapshot({ ...completed,
  review:{ ...completed.review, checkpointCount:3 } }, 3), /blank canvas and every result/);

const cameraAudit = [{ requestId:'story-abc123-7', action:'view.highlightAtoms',
  status:'completed', result:{ highlightedAtoms:{ cameraPreserved:true,
    displayContextPreserved:true } } }];
assert.deepEqual(verifyHighlightCameraAudit(cameraAudit, 1), {
  verified:true, auditedHighlightCount:1,
});
assert.throws(() => verifyHighlightCameraAudit([{ ...cameraAudit[0],
  result:{ highlightedAtoms:{ cameraPreserved:false, displayContextPreserved:true } } }]),
/changed the camera/);
assert.throws(() => verifyHighlightCameraAudit(cameraAudit, 2),
  /does not cover every presentation highlight/);

console.log('Designer movie presentation contract: PASS');
