// Presentation only: never rewrite the hash-pinned action script or its arguments.
export function sos1StoryCaption(script, step) {
  if (!step) return '';
  if (script?.sourceAudit?.schema !== 'molarium.sos1-aww-receptor-only-browser-publication/v1'
    && script?.sourceScript?.sha256 !== '7eed2dff0bf3fa127f87b2322aaea4b615d458ad6d8ef3af3c5b5886dc8fe9c3')
    return step.caption || step.action;
  const args = step.args || {};
  const captions = {
    'designRoute.load':'Start from the SOS1-bound hit, AXE',
    'view.setMode':'Open the molecular design workspace',
    'protein.prepare':'Prepare the hit complex and assign its force field',
    'protein.parameterize':'Assign force-field parameters without moving the atoms',
    'pose.captureReference':'Keep the current binding pose as the reference for the next edit',
    'designRoute.inspect':'Check the current compound and the next planned design step',
    'pose.refine':'Search for a binding pose that preserves the intended contacts',
    'pose.apply':'Apply the best-ranked refined binding pose',
    'optimization.run':'Relax the ligand and nearby pocket around the new design',
    'pose.enumerateSidechainRotamers':'Generate alternative orientations of the Phe890 side chain',
    'history.undo':'Restore the starting Phe890 orientation before the next comparison',
    'calculation.run':'Measure the energy with both ligand and receptor coordinates held fixed',
  };
  if (step.action === 'session.inspect') return args.scope === 'ligand'
    ? 'Record the ligand geometry for comparison'
    : args.scope === 'pocket' ? 'Record the surrounding pocket geometry for comparison'
      : 'Inspect the current molecular state';
  if (step.action === 'designRoute.resume') return `Continue the design from ${args.stateId}`;
  if (step.action === 'designRoute.applyStep') return ({
    'scaffold-rewrite':'Reshape the hit scaffold while retaining its binding anchor',
    'fragment-merge':'Combine the fragment features into the next ligand',
    'open-phe890-pocket':'Build compound 21 and its extended aromatic group',
    'finish-bay-293':'Make the final chemical changes to reach BAY-293',
  })[args.stepId] || step.caption || 'Apply the next planned chemical change';
  if (step.action === 'pose.setDesignerLigandPoseFixed') return args.fixed
    ? 'Hold the chosen ligand pose fixed while testing the Phe890 response'
    : 'Release the ligand pose for the final BAY-293 refinement';
  if (step.action === 'pose.applySidechainRotamer') return step.caption?.startsWith('Apply the energy-selected')
    ? 'Apply the lowest-energy Phe890 orientation from the fixed-ligand comparison'
    : args.source === 'input' ? 'Test the original Phe890 orientation'
      : `Test Phe890 at side-chain angles ${args.chiDegrees?.join('° / ')}°`;
  return captions[step.action] || step.caption || step.action;
}
