import { validateActionScript } from './replay.mjs';

const INITIAL_FOCUS_STEP = Object.freeze({ action:'view.focusComponent',
  args:Object.freeze({ kind:'ligand', ordinal:0, isolate:false }),
  caption:'Center the hit and the local pocket where every design decision will be made' });
const DISPLAY_STEP = Object.freeze({ action:'view.setDisplay', args:Object.freeze({
  representation:'cartoon', showHydrogens:false, showInteractions:false,
  showPocketAtoms:true, showHulls:false, showStericClashes:false,
  colorTheme:'design-hit', changeMarkers:'halo',
}), caption:'Strip away visual noise so the hit and its binding pocket are easy to read' });
const PREDICTION_DISPLAY_STEP = Object.freeze({ action:'view.setDisplay',
  args:Object.freeze({ colorTheme:'design-prediction' }),
  caption:'Mark the transition from experimental hit to prospective prediction' });
const CLASH_DISPLAY_STEP = Object.freeze({ action:'view.setDisplay',
  args:Object.freeze({ showStericClashes:true }),
  caption:'Show the severe ligand–protein contacts created by compound 21 growth' });
const CLASH_CLEAR_STEP = Object.freeze({ action:'view.setDisplay',
  args:Object.freeze({ showStericClashes:false }),
  caption:'The selected Phe890-out branch clears the severe contacts' });
const PHE890_LABEL = Object.freeze({ chain:'A', residueIndex:890,
  label:'Phe890', tone:'gold' });
const LYS898_LABEL = Object.freeze({ chain:'A', residueIndex:898,
  label:'Lys898', tone:'blue' });
const CHANGED_ATOM_RESULT_PATH = Object.freeze({
  'designRoute.applyStep':'designStep.changedAtomIds',
  'pose.applySidechainRotamer':'sidechainRotamer.changedAtomIds',
  'pose.apply':'appliedPose.changedAtomIds',
  'optimization.run':'optimization.changedAtomIds',
});

function changedRegionCaption(action, stepId = null) {
  if (action === 'designRoute.applyStep' && stepId === 'finish-bay-293')
    return 'The distal arm moves because AWW and AXH attach it at different thiophene positions';
  if (action === 'designRoute.applyStep') return 'See exactly where the ligand graph changed';
  if (action === 'pose.applySidechainRotamer') return 'See Phe890 move out of the ligand growth path';
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
  const actions = sourceScript.actions.flatMap((step, index) => {
    if (step.action === 'designRoute.applyStep') activeStepId = step.args?.stepId || null;
    if (step.action === 'designRoute.applyStep' && activeStepId === 'open-phe890-pocket')
      phe890ContextActive = true;
    const capturedStep = structuredClone(step);
    const resultPath = CHANGED_ATOM_RESULT_PATH[step.action];
    const binding = resultPath ? `changed-atoms-${index + 1}` : null;
    if (binding) capturedStep.capture = { ...(capturedStep.capture || {}),
      [binding]:resultPath };
    const clearRelaxationMarkers = step.action === 'optimization.run';
    const residueLabels = phe890ContextActive
      ? [PHE890_LABEL]
      : step.action === 'pose.apply' && activeStepId === 'scaffold-rewrite'
        ? [PHE890_LABEL, LYS898_LABEL] : [];
    const switchToPrediction = step.action === 'designRoute.applyStep'
      && !predictionThemeApplied;
    if (switchToPrediction) predictionThemeApplied = true;
    return [capturedStep,
      ...(step.action === 'protein.prepare'
        ? [structuredClone(DISPLAY_STEP), structuredClone(INITIAL_FOCUS_STEP)] : []),
      ...(switchToPrediction ? [structuredClone(PREDICTION_DISPLAY_STEP)] : []),
      ...(step.action === 'designRoute.applyStep' && activeStepId === 'open-phe890-pocket'
        ? [structuredClone(CLASH_DISPLAY_STEP)] : []),
      ...(step.action === 'pose.applySidechainRotamer'
        ? [structuredClone(CLASH_CLEAR_STEP)] : []),
      ...(binding ? [{ action:'view.highlightAtoms', args:{
        atomIds:clearRelaxationMarkers ? [] : { $binding:binding },
        ...(residueLabels.length ? { residueLabels:structuredClone(residueLabels) } : {}),
      }, caption:changedRegionCaption(step.action, activeStepId) }] : []),
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
