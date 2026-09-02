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

function changedRegionCaption(action) {
  if (action === 'designRoute.applyStep') return 'See exactly where the ligand graph changed';
  if (action === 'pose.applySidechainRotamer') return 'See Phe890 move out of the ligand growth path';
  if (action === 'pose.apply') return 'See which ligand atoms moved into the selected pose';
  return 'See how the ligand and pocket responded during relaxation';
}

export function buildPocketInterfaceStory(sourceScript, { sourcePath = null,
  sourceSha256 = null } = {}) {
  validateActionScript(sourceScript);
  const actions = sourceScript.actions.flatMap((step, index) => {
    const capturedStep = structuredClone(step);
    const resultPath = CHANGED_ATOM_RESULT_PATH[step.action];
    const binding = resultPath ? `changed-atoms-${index + 1}` : null;
    if (binding) capturedStep.capture = { ...(capturedStep.capture || {}),
      [binding]:resultPath };
    return [capturedStep,
      ...(step.action === 'protein.prepare'
        ? [structuredClone(DISPLAY_STEP), structuredClone(INITIAL_FOCUS_STEP)] : []),
      ...(binding ? [{ action:'view.focusAtoms', args:{
        atomIds:{ $binding:binding }, contextRadiusAngstrom:4.5, highlight:true,
      }, caption:changedRegionCaption(step.action) }] : []),
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
      transformation:'Capture each public mutation result and insert view.focusAtoms for its reported changed atom IDs; no scientific action request removed or altered.',
    },
  });
}
