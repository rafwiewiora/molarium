import assert from 'node:assert/strict';
import { verifySos1ExecutableScience } from './sos1-executable-science.mjs';

const record = (action, result, args = {}) => ({ action, args, result, status:'completed' });
const ligand = () => record('session.inspect', { scope:'ligand', truncated:false,
  atoms:[{ atomId:'ligand', element:'C', coordinatesAngstrom:[1,2,3] }], bonds:[] });
const pocket = () => record('session.inspect', { scope:'pocket', truncated:false,
  totalAtomCount:1, atoms:[{ atomId:'fixed', coordinatesAngstrom:[1,2,3] }] });
const lock = { active:true, lockId:'test-lock', externalReferenceCoordinatesUsed:false };
const candidates = Array.from({ length:13 }, (_, i) => ({ coordinateSha256:`candidate-${i}` }));
const enumeration = () => record('pose.enumerateSidechainRotamers', {
  sidechainRotamers:{ generatedCandidateCount:13, candidates,
    designerFixedLigandPose:lock } });
const application = (i) => record('pose.applySidechainRotamer', { sidechainRotamer:{
  selectedCoordinateSha256:`candidate-${i}`, chiDegrees:[i,90], severeClashes:0,
  designerFixedLigandPose:lock } });
const fixture = [record('geometry.alignBranchToContact', { designerBranchContact:{
  externalReferenceCoordinatesUsed:false, selected:{ internalSevereContactCount:0,
    contacts:{ outsideAllowedResponseContactCount:0 } } } }), ligand(),
record('pose.setDesignerLigandPoseFixed', { designerFixedLigandPose:lock }, { fixed:true }),
...candidates.flatMap((_, i) => [enumeration(), application(i), ligand(),
  record('calculation.run', { calculation:{ movedHeavyAtomCount:0,
    maximumDisplacementAngstrom:0, unit:'kcal/mol', finalEnergy:i - 10 } },
  { job:'energy', method:'openmm', options:{ constraintMode:'none',
    implicitSolvent:'obc2', nonbondedCutoffNm:1 } }),
  record('history.undo', {}), ligand()]), enumeration(), application(0), ligand(),
record('designRoute.applyStep', { designStep:{ poseTransferPlan:{
  featureCorrespondences:[{ id:'distal', required:true }] } } }, { stepId:'finish-bay-293' }),
record('pose.refine', { refinement:{ coverageComplete:true,
  coverage:{ allRequiredStrataCovered:true }, selectedFeasible:true,
  selectedSpatialFeatures:[{ id:'distal', satisfied:true }], candidateGateSummary:[{}] } }),
pocket(), record('optimization.run', { optimization:{ accepted:true,
  valenceSafeguard:{ accepted:true, complete:true }, registeredPoseRetention:{ accepted:true,
    before:{ fixedAtomIds:['fixed'] } } } }), pocket()];
assert.equal(verifySos1ExecutableScience(fixture).passed, true);
for (const mutate of [
  (records) => { records.find((r) => r.action === 'calculation.run').result.calculation.finalEnergy = Infinity; },
  (records) => { records.filter((r) => r.action === 'calculation.run')[1].result.calculation.finalEnergy = -100; },
  (records) => { records.find((r) => r.action === 'calculation.run').result.calculation.maximumDisplacementAngstrom = .1; },
  (records) => { records.filter((r) => r.result.scope === 'ligand')[1].result.atoms[0].coordinatesAngstrom[0] += 1; },
  (records) => { records.at(-1).result.atoms[0].coordinatesAngstrom[0] += 1; },
  (records) => { records.find((r) => r.action === 'pose.refine').result.refinement.selectedSpatialFeatures[0].satisfied = false; },
]) {
  const changed = structuredClone(fixture);
  mutate(changed);
  assert.throws(() => verifySos1ExecutableScience(changed));
}
console.log('SOS1 recomputed science gate: PASS (energy, coordinate, feature, and fixed-atom negative controls)');
