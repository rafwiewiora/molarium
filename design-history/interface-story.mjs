import { validateActionScript } from './replay.mjs';

const INITIAL_FOCUS_STEP = Object.freeze({ action:'view.focusComponent',
  args:Object.freeze({ kind:'ligand', ordinal:0, isolate:false }),
  caption:'Zoom to the active ligand pocket' });
const DISPLAY_STEP = Object.freeze({ action:'view.setDisplay', args:Object.freeze({
  representation:'cartoon', showHydrogens:false, showInteractions:false,
  showPocketAtoms:true, showHulls:false,
}), caption:'Use the chemist pocket view and hide prepared hydrogens' });
const CHANGED_ATOM_RESULT_PATH = Object.freeze({
  'designRoute.applyStep':'designStep.changedAtomIds',
  'pose.applySidechainRotamer':'sidechainRotamer.changedAtomIds',
  'pose.apply':'appliedPose.changedAtomIds',
  'optimization.run':'optimization.changedAtomIds',
});

function changedRegionCaption(action) {
  if (action === 'designRoute.applyStep') return 'Inspect the graph edit in its local pocket';
  if (action === 'pose.applySidechainRotamer') return 'Inspect the applied side-chain movement';
  if (action === 'pose.apply') return 'Inspect atoms moved by the applied pose';
  return 'Inspect atoms moved by the accepted relaxation';
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
