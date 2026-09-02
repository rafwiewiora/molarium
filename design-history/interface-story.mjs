import { validateActionScript } from './replay.mjs';

const FOCUS_STEP = Object.freeze({ action:'view.focusComponent',
  args:Object.freeze({ kind:'ligand', ordinal:0, isolate:false }),
  caption:'Zoom to the active ligand pocket' });
const DISPLAY_STEP = Object.freeze({ action:'view.setDisplay', args:Object.freeze({
  representation:'ball-stick', showHydrogens:false, showInteractions:false,
  showPocketAtoms:true, showHulls:false,
}), caption:'Use the chemist pocket view and hide prepared hydrogens' });
const FOCUS_AFTER = new Set([
  'designCampaign.applyStep', 'pose.applySidechainRotamer', 'pose.apply', 'optimization.run',
]);

export function buildPocketInterfaceStory(sourceScript, { sourcePath = null,
  sourceSha256 = null } = {}) {
  validateActionScript(sourceScript);
  const actions = sourceScript.actions.flatMap((step) => [structuredClone(step),
    ...(step.action === 'protein.prepare'
      ? [structuredClone(DISPLAY_STEP), structuredClone(FOCUS_STEP)] : []),
    ...(FOCUS_AFTER.has(step.action) ? [structuredClone(FOCUS_STEP)] : []),
  ]);
  return validateActionScript({
    schema:sourceScript.schema,
    label:`${sourceScript.label} · visible Molarium interface`,
    actions,
    sourceScript:{
      ...(sourcePath ? { path:sourcePath } : { schema:sourceScript.schema,
        label:sourceScript.label, actionCount:sourceScript.actions.length }),
      ...(sourceSha256 ? { sha256:sourceSha256 } : {}),
      transformation:'Insert view.focusComponent after state-changing actions; no scientific action removed or altered.',
    },
  });
}
