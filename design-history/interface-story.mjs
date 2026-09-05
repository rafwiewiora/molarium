import { validateActionScript } from './replay.mjs';

const INITIAL_FOCUS_STEP = Object.freeze({ action:'view.focusComponent',
  args:Object.freeze({ kind:'ligand', ordinal:0, isolate:false }),
  caption:'Center the hit and the local pocket where every design decision will be made' });
const DISPLAY_STEP = Object.freeze({ action:'view.setDisplay', args:Object.freeze({
  representation:'cartoon', showHydrogens:false, showInteractions:false,
  showPocketAtoms:true, showHulls:false, showStericClashes:false,
  colorTheme:'design-hit', changeMarkers:'halo',
}), caption:'Strip away visual noise so the hit and its binding pocket are easy to read' });
const CHECKPOINT_DISPLAY_STEP = Object.freeze({ action:'view.setDisplay', args:Object.freeze({
  representation:'cartoon', showHydrogens:false, showInteractions:false,
  showPocketAtoms:true, showHulls:false, showStericClashes:false,
  colorTheme:'design-prediction', changeMarkers:'halo',
}), caption:'Show each frozen prediction in the same local pocket view' });
const PREDICTION_DISPLAY_STEP = Object.freeze({ action:'view.setDisplay',
  args:Object.freeze({ colorTheme:'design-prediction' }),
  caption:'Mark the transition from experimental hit to prospective prediction' });
const CLASH_DISPLAY_STEP = Object.freeze({ action:'view.setDisplay',
  args:Object.freeze({ showStericClashes:true }),
  caption:'Show the severe ligand–protein contacts created by compound 21 growth' });
const CLASH_CLEAR_STEP = Object.freeze({ action:'view.setDisplay',
  args:Object.freeze({ showStericClashes:false }),
  caption:'The selected Phe890-out branch clears the severe contacts' });
const CANDIDATE_CLASH_STEP = Object.freeze({ action:'view.setDisplay',
  args:Object.freeze({ showStericClashes:true }),
  caption:'Inspect this Phe890 candidate for clashes while the ligand stays fixed' });
const PHE890_LABEL = Object.freeze({ chain:'A', residueIndex:890,
  label:'Phe890', tone:'gold' });
const TYR884_LABEL = Object.freeze({ chain:'A', residueIndex:884,
  label:'Tyr884 · backbone contact', tone:'blue' });
const LYS898_LABEL = Object.freeze({ chain:'A', residueIndex:898,
  label:'Lys898', tone:'blue' });
const CHANGED_ATOM_RESULT_PATH = Object.freeze({
  'designRoute.applyStep':'designStep.changedAtomIds',
  'pose.applySidechainRotamer':'sidechainRotamer.changedAtomIds',
  'pose.apply':'appliedPose.changedAtomIds',
  'optimization.run':'optimization.changedAtomIds',
  'geometry.alignBranchToContact':'changedAtomIds',
});
const CHECKPOINT_CAPTIONS = Object.freeze({
  'starting-hit':'Start from the experimental hit and its Phe890-in pocket',
  'scaffold-rewrite':'Rewrite the scaffold while retaining the original pocket context',
  'fragment-merge':'AWZ precursor: the distal arm has not yet opened the Phe890 pocket',
  'aww-graph':'AWW graph edit: inspect the inherited arm direction before designer placement',
  'aww-designer-intent':'Rotate the AWW arm toward the Tyr884 backbone contact; only the movable Phe890 ring overlaps',
  'aww-phe890-response':'The energy-selected Phe890 flip clears the fixed ligand; Tyr884 supplies the backbone contact',
  'finish-bay-293':'BAY-293: rewire the thiophene attachment while retaining the distal spatial feature',
});

function changedRegionCaption(action, stepId = null, trialResponse = false) {
  if (action === 'designRoute.applyStep' && stepId === 'finish-bay-293')
    return 'Compare the thiophene attachment change and the resulting distal-arm position in the same view';
  if (action === 'geometry.alignBranchToContact')
    return 'Orient the ligand arm toward the Tyr884 backbone contact and the Phe890-occupied pocket';
  if (action === 'designRoute.applyStep') return 'See exactly where the ligand graph changed';
  if (action === 'pose.applySidechainRotamer') return trialResponse
    ? 'Inspect a trial Phe890 conformation before its fixed-coordinate energy calculation'
    : 'See the selected Phe890 response in the same fixed view';
  if (action === 'pose.apply' && stepId === 'scaffold-rewrite')
    return 'Keep the same view: the predicted pyrazole packs between Phe890 and Lys898; no direct H-bond is detected';
  if (action === 'pose.apply') return 'Compare the selected ligand pose without moving the camera';
  return 'Compare the relaxed ligand–pocket geometry in the same fixed view';
}

export function buildPocketInterfaceStory(sourceScript, { sourcePath = null,
  sourceSha256 = null } = {}) {
  validateActionScript(sourceScript);
  let activeStepId = null;
  let predictionThemeApplied = false;
  let phe890ContextActive = false;
  let cameraEstablished = false;
  const hasDesignerIntent = sourceScript.actions.some((step) =>
    step.action === 'geometry.alignBranchToContact' || step.review?.designStage === 'aww-designer-intent');
  const actions = sourceScript.actions.flatMap((step, index) => {
    if (step.action === 'designRoute.applyStep') activeStepId = step.args?.stepId || null;
    if (step.action === 'designRoute.applyStep' && activeStepId === 'open-phe890-pocket')
      phe890ContextActive = true;
    const intentStep = step.action === 'geometry.alignBranchToContact'
      || step.review?.designStage === 'aww-designer-intent';
    const responseStep = step.action === 'pose.applySidechainRotamer'
      || step.review?.designStage === 'aww-phe890-response';
    // Audited candidate trials are undone before the next candidate is applied.
    // Do not label each trial as the selected response or hide its clashes.
    const followingResponse = sourceScript.actions.findIndex((entry, nextIndex) =>
      nextIndex > index && entry.action === 'pose.applySidechainRotamer');
    const trialResponse = step.action === 'pose.applySidechainRotamer'
      && sourceScript.actions.slice(index + 1, followingResponse < 0 ? undefined : followingResponse)
        .some((entry) => entry.action === 'history.undo');
    if (intentStep || responseStep) phe890ContextActive = true;
    const capturedStep = structuredClone(step);
    const resultPath = CHANGED_ATOM_RESULT_PATH[step.action];
    const binding = resultPath ? `changed-atoms-${index + 1}` : null;
    if (binding) capturedStep.capture = { ...(capturedStep.capture || {}),
      [binding]:resultPath };
    const clearRelaxationMarkers = step.action === 'optimization.run';
    const residueLabels = phe890ContextActive
      ? hasDesignerIntent ? [PHE890_LABEL, TYR884_LABEL] : [PHE890_LABEL]
      : step.action === 'pose.apply' && activeStepId === 'scaffold-rewrite'
        ? [PHE890_LABEL, LYS898_LABEL] : [];
    const switchToPrediction = step.action === 'designRoute.applyStep'
      && !predictionThemeApplied;
    if (switchToPrediction) predictionThemeApplied = true;
    const establishPreparedCamera = step.action === 'protein.prepare' && !cameraEstablished;
    const establishCheckpointCamera = step.action === 'campaign.import' && !cameraEstablished;
    if (establishPreparedCamera || establishCheckpointCamera) cameraEstablished = true;
    if (establishCheckpointCamera) predictionThemeApplied = true;
    return [capturedStep,
      ...(establishPreparedCamera
        ? [structuredClone(DISPLAY_STEP), structuredClone(INITIAL_FOCUS_STEP)] : []),
      ...(establishCheckpointCamera
        ? [structuredClone(CHECKPOINT_DISPLAY_STEP), structuredClone(INITIAL_FOCUS_STEP)] : []),
      ...(switchToPrediction ? [structuredClone(PREDICTION_DISPLAY_STEP)] : []),
      ...(intentStep || (!hasDesignerIntent && step.action === 'designRoute.applyStep'
        && activeStepId === 'open-phe890-pocket')
        ? [structuredClone(CLASH_DISPLAY_STEP)] : []),
      ...(responseStep
        ? [structuredClone(trialResponse ? CANDIDATE_CLASH_STEP : CLASH_CLEAR_STEP)] : []),
      ...(step.action === 'campaign.import' ? [{ action:'view.highlightAtoms', args:{
        atomIds:[], residueLabels:structuredClone(phe890ContextActive && hasDesignerIntent
          ? [PHE890_LABEL, TYR884_LABEL] : [PHE890_LABEL]),
      }, caption:CHECKPOINT_CAPTIONS[step.review?.designStage]
        || 'Keep Phe890 labeled while the frozen prediction changes in place' }] : []),
      ...(binding ? [{ action:'view.highlightAtoms', args:{
        atomIds:clearRelaxationMarkers ? [] : { $binding:binding },
        ...(residueLabels.length ? { residueLabels:structuredClone(residueLabels) } : {}),
      }, caption:changedRegionCaption(step.action, activeStepId, trialResponse) }] : []),
    ];
  });
  return validateActionScript({
    schema:sourceScript.schema,
    label:`${sourceScript.label} · visible Molarium interface`,
    actions,
    sourceScript:{
      ...(sourcePath ? { path:sourcePath } : { schema:sourceScript.schema,
        label:sourceScript.label, actionCount:sourceScript.actions.length }),
      ...(sourceSha256 ? { sha256:sourceSha256 } : {}),
      transformation:'Capture each public mutation result; focus once on the starting ligand and retain that pocket camera for all later highlights. Phe890 stays labeled with its flanking peptide context; severe clashes are shown only from compound-21 growth until the Phe890-out branch is selected. Relaxation markers are cleared because before/after geometry is compared in place. No scientific action request removed or altered.',
    },
  });
}
