import assert from 'node:assert/strict';

export const DESIGNER_MOVIE_PRESENTATION = Object.freeze({
  schema:'molarium.designer-moves-interface-presentation/v1',
  minimumViewport:Object.freeze({ width:1280, height:800 }),
  seconds:Object.freeze({
    blankCanvas:2.2,
    importedStory:2.0,
    pressDefault:.8,
    pressMolecularChange:1.2,
    resultDefault:1.5,
    completedStory:3.0,
  }),
  resultSeconds:Object.freeze({
    'designRoute.load':2.0,
    'protein.prepare':2.0,
    'view.setDisplay':1.6,
    'view.focusComponent':2.8,
    'designRoute.applyStep':2.8,
    'pose.refine':3.5,
    'pose.apply':2.8,
    'pose.enumerateSidechainRotamers':3.2,
    'pose.applySidechainRotamer':3.2,
    'pose.updateReceptorReference':2.2,
    'optimization.run':3.0,
    'campaign.import':2.8,
    'view.highlightAtoms':2.6,
  }),
});

const framesForSeconds = (fps, seconds) => Math.max(1, Math.round(fps * seconds));

export function designerMoviePressFrames(step, fps) {
  const molecularChange = ['designRoute.applyStep', 'pose.applySidechainRotamer',
    'pose.apply', 'optimization.run', 'campaign.import'].includes(step?.action);
  return framesForSeconds(fps, molecularChange
    ? DESIGNER_MOVIE_PRESENTATION.seconds.pressMolecularChange
    : DESIGNER_MOVIE_PRESENTATION.seconds.pressDefault);
}

export function designerMovieResultFrames(step, fps) {
  const seconds = DESIGNER_MOVIE_PRESENTATION.resultSeconds[step?.action]
    ?? DESIGNER_MOVIE_PRESENTATION.seconds.resultDefault;
  return framesForSeconds(fps, seconds);
}

export function verifyMovieViewport(viewport) {
  assert.ok(Number(viewport?.width) >= DESIGNER_MOVIE_PRESENTATION.minimumViewport.width,
    `Publication movie width must be at least ${DESIGNER_MOVIE_PRESENTATION.minimumViewport.width}px`);
  assert.ok(Number(viewport?.height) >= DESIGNER_MOVIE_PRESENTATION.minimumViewport.height,
    `Publication movie height must be at least ${DESIGNER_MOVIE_PRESENTATION.minimumViewport.height}px`);
  return Object.freeze({ ...viewport, verified:true });
}

export function verifyBlankInterfaceSnapshot(snapshot) {
  assert.equal(snapshot?.brand, 'MOLARIUM', 'Full Molarium header is not visible');
  assert.deepEqual(snapshot?.modeLabels, ['View', 'Design', 'Simulate'],
    'Publication capture does not show the real mode bar');
  assert.equal(snapshot?.activeMode, 'build', 'Publication story must open in Design mode');
  assert.equal(snapshot?.viewerHintVisible, true,
    'Publication story must begin on the blank-canvas loader');
  assert.equal(snapshot?.moleculeInfoHidden, true,
    'Publication story begins with molecule state already visible');
  assert.equal(snapshot?.sceneHidden, true,
    'Publication story begins with a populated Scene card');
  for (const region of ['header', 'leftPanel', 'viewer', 'rightPanel'])
    assert.equal(snapshot?.visibleRegions?.[region], true,
      `Publication capture is missing the full ${region} interface region`);
  return Object.freeze({ ...snapshot, verified:true });
}

export async function readBlankInterfaceSnapshot(browser) {
  return browser.evaluate(`(() => {
    const visible = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0 && style.display !== 'none'
        && style.visibility !== 'hidden';
    };
    return {
      brand:document.querySelector('.app-brand-name')?.textContent?.trim() || '',
      modeLabels:[...document.querySelectorAll('.mode-bar button')]
        .map((button) => button.textContent.trim()),
      activeMode:document.querySelector('.mode-bar button.active')?.dataset.mode || null,
      viewerHintVisible:visible('#viewer-hint'),
      moleculeInfoHidden:document.querySelector('#molecule-info')?.classList.contains('hidden'),
      sceneHidden:document.querySelector('.scene-card')?.classList.contains('hidden'),
      visibleRegions:{ header:visible('.app-header'), leftPanel:visible('.panel-left'),
        viewer:visible('.viewer-stage'), rightPanel:visible('.panel-right') },
    };
  })()`);
}

export function verifyPresentationCameraContract(script) {
  const actions = script?.actions || [];
  const focusComponents = actions.filter((step) => step.action === 'view.focusComponent');
  const focusAtoms = actions.filter((step) => step.action === 'view.focusAtoms');
  const setCameras = actions.filter((step) => step.action === 'view.setCamera');
  const highlights = actions.filter((step) => step.action === 'view.highlightAtoms');
  assert.ok(focusComponents.length <= 1,
    'The story may establish the pocket camera only once');
  if (actions.some((step) => step.action === 'protein.prepare'))
    assert.equal(focusComponents.length, 1,
      'A prepared story must establish exactly one initial pocket camera');
  assert.equal(focusAtoms.length, 0,
    'Atom highlights must not refit the publication camera');
  assert.equal(setCameras.length, 0,
    'The presentation layer must not inject camera jumps');
  assert.equal(highlights.some((step) => Object.hasOwn(step.args || {},
    'contextRadiusAngstrom')), false,
  'Highlight steps must retain the established pocket context');
  return Object.freeze({ verified:true, focusComponentCount:focusComponents.length,
    focusAtomsCount:focusAtoms.length, setCameraCount:setCameras.length,
    highlightCount:highlights.length });
}

export function verifyCompletedInterfaceSnapshot(snapshot, actionCount) {
  assert.equal(snapshot?.replayStatus, 'completed',
    'Publication replay did not reach its terminal completed state');
  assert.equal(snapshot?.progress, `${actionCount} / ${actionCount}`,
    'Terminal Designer Moves progress is incomplete');
  assert.equal(snapshot?.previousEnabled, true,
    'The completed story cannot be reviewed backward');
  assert.equal(snapshot?.nextEnabled, false,
    'The completed story incorrectly offers a checkpoint beyond the final state');
  assert.match(String(snapshot?.playLabel || ''), /Replay story/,
    'The completed story transport is not ready for replay');
  assert.equal(snapshot?.cueCount, 0,
    'A transient button highlight remains in the terminal publication frame');
  assert.equal(snapshot?.demoActive, false,
    'The terminal publication frame retained a transient demo layout');
  assert.equal(snapshot?.review?.completed, true,
    'The public Designer Script API does not expose completed review state');
  assert.equal(snapshot?.review?.index, actionCount,
    'The public Designer Script API is not at the final checkpoint');
  assert.equal(snapshot?.review?.frontier, actionCount,
    'The completed review frontier does not cover every story action');
  assert.equal(snapshot?.review?.checkpointCount, actionCount + 1,
    'The completed story did not retain the blank canvas and every result checkpoint');
  return Object.freeze({ ...snapshot, verified:true });
}

export function verifyHighlightCameraAudit(records, expectedCount = null) {
  const highlights = (records || []).filter((record) =>
    record.action === 'view.highlightAtoms' && /^story-[a-f0-9]+-\d+$/.test(record.requestId || ''));
  for (const record of highlights) {
    assert.equal(record.status, 'completed',
      `Highlight action ${record.requestId} did not complete`);
    assert.equal(record.result?.highlightedAtoms?.cameraPreserved, true,
      `Highlight action ${record.requestId} changed the camera`);
    assert.equal(record.result?.highlightedAtoms?.displayContextPreserved, true,
      `Highlight action ${record.requestId} changed the pocket display context`);
  }
  if (expectedCount != null) assert.equal(highlights.length, expectedCount,
    'Runtime camera audit does not cover every presentation highlight');
  return Object.freeze({ verified:true, auditedHighlightCount:highlights.length });
}
