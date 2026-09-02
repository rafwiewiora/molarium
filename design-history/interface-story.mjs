import { validateActionScript } from './replay.mjs';

const INITIAL_FOCUS_STEP = Object.freeze({ action:'view.focusComponent',
  args:Object.freeze({ kind:'ligand', ordinal:0, isolate:false }),
  caption:'Center the hit and the local pocket where every design decision will be made' });
const DISPLAY_STEP = Object.freeze({ action:'view.setDisplay', args:Object.freeze({
  representation:'cartoon', showHydrogens:false, showInteractions:false,
  showPocketAtoms:true, showHulls:false,
}), caption:'Strip away visual noise so the hit and its binding pocket are easy to read' });
const CHANGED_ATOM_RESULT_PATH = Object.freeze({
  'designRoute.applyStep':'designStep.changedAtomIds',
  'pose.applySidechainRotamer':'sidechainRotamer.changedAtomIds',
  'pose.apply':'appliedPose.changedAtomIds',
  'optimization.run':'optimization.changedAtomIds',
});

function changedRegionCaption(action, stepId = null) {
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
  const actions = sourceScript.actions.flatMap((step, index) => {
    if (step.action === 'designRoute.applyStep') activeStepId = step.args?.stepId || null;
    const capturedStep = structuredClone(step);
    const resultPath = CHANGED_ATOM_RESULT_PATH[step.action];
    const binding = resultPath ? `changed-atoms-${index + 1}` : null;
    if (binding) capturedStep.capture = { ...(capturedStep.capture || {}),
      [binding]:resultPath };
    const presentationAction = step.action === 'pose.apply'
      || step.action === 'optimization.run' ? 'view.highlightAtoms' : 'view.focusAtoms';
    return [capturedStep,
      ...(step.action === 'protein.prepare'
        ? [structuredClone(DISPLAY_STEP), structuredClone(INITIAL_FOCUS_STEP)] : []),
      ...(binding ? [{ action:presentationAction, args:{
        atomIds:{ $binding:binding },
        ...(presentationAction === 'view.focusAtoms'
          ? { contextRadiusAngstrom:3.8, highlight:true,
            ...(activeStepId === 'scaffold-rewrite' ? { residueLabels:[
              { chain:'A', residueIndex:890, label:'Phe890' },
              { chain:'A', residueIndex:898, label:'Lys898' },
            ] } : {}) } : {}),
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
      transformation:'Capture each public mutation result; focus once on a newly edited region, then highlight pose and relaxation changes without changing the comparison camera or displayed context. No scientific action request removed or altered.',
    },
  });
}
