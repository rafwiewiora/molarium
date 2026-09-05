import assert from 'node:assert/strict';
import { finalDiagnosticGate } from './sos1-final-step-checkpoint.mjs';
import { fixedAtomRelaxationGate } from './recover-sos1-final-from-full-system-checkpoint.mjs';

function ligandState(inspection) {
  assert.equal(inspection.truncated, false);
  assert(inspection.atoms.length > 0);
  return {
    atoms:inspection.atoms.map((atom) => ({ atomId:atom.atomId, element:atom.element,
      formalCharge:Number(atom.formalCharge || 0), aromatic:Boolean(atom.aromatic),
      coordinatesAngstrom:atom.coordinatesAngstrom,
    })).sort((a, b) => a.atomId.localeCompare(b.atomId)),
    bonds:inspection.bonds.map((bond) => ({ atomIds:[...bond.atomIds].sort(),
      order:Number(bond.order), aromatic:Boolean(bond.aromatic),
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

// A portable replay recomputes coordinates and energies. Its recorded final
// choice must still win under the new energies, not merely be executable.
// This checks native audit results only; no later crystal is read or fitted.
export function verifySos1ExecutableScience(audit) {
  const records = Array.isArray(audit) ? audit : audit.records;
  const start = records.findIndex((record) => record.action === 'geometry.alignBranchToContact');
  const finish = records.findIndex((record, index) => index > start
    && record.action === 'designRoute.applyStep' && record.args.stepId === 'finish-bay-293');
  assert(start >= 0 && finish > start, 'Full AWW-to-AXH executable evidence is required');
  const segment = records.slice(start, finish);
  assert(segment.every((record) => record.status === 'completed'));
  const placement = segment[0].result.designerBranchContact;
  assert.equal(placement.externalReferenceCoordinatesUsed, false);
  assert.equal(placement.selected.internalSevereContactCount, 0);
  assert.equal(placement.selected.contacts.outsideAllowedResponseContactCount, 0);
  const lock = segment.find((record) => record.action === 'pose.setDesignerLigandPoseFixed'
    && record.args.fixed === true)?.result.designerFixedLigandPose;
  assert.equal(lock?.active, true);
  assert.equal(lock.externalReferenceCoordinatesUsed, false);
  const enumerations = segment.filter((record) => record.action === 'pose.enumerateSidechainRotamers');
  const initial = enumerations[0]?.result.sidechainRotamers;
  assert.equal(initial?.generatedCandidateCount, 13);
  const hashes = initial.candidates.map((candidate) => candidate.coordinateSha256).sort();
  assert.equal(new Set(hashes).size, 13);
  for (const record of enumerations) {
    const ensemble = record.result.sidechainRotamers;
    assert.equal(ensemble.designerFixedLigandPose.lockId, lock.lockId);
    assert.deepEqual(ensemble.candidates.map((candidate) => candidate.coordinateSha256).sort(), hashes);
  }
  const ligandInspections = segment.filter((record) => record.action === 'session.inspect'
    && record.result.scope === 'ligand').map((record) => ligandState(record.result));
  assert(ligandInspections.length >= 28, 'Every candidate and restoration needs a ligand inspection');
  for (const state of ligandInspections)
    assert.deepEqual(state, ligandInspections[0], 'Receptor response changed the fixed ligand');
  let applied = null;
  const evaluated = [];
  const applications = [];
  for (const record of segment) {
    if (record.action === 'pose.applySidechainRotamer') {
      applied = record.result.sidechainRotamer;
      assert.equal(applied.designerFixedLigandPose.lockId, lock.lockId);
      assert(hashes.includes(applied.selectedCoordinateSha256));
      applications.push(applied);
    } else if (record.action === 'calculation.run') {
      assert(applied, 'Energy evaluation has no current Phe890 candidate');
      assert.equal(record.args.job, 'energy');
      assert.equal(record.args.method, 'openmm');
      assert.deepEqual(record.args.options,
        { constraintMode:'none', implicitSolvent:'obc2', nonbondedCutoffNm:1 });
      const result = record.result.calculation;
      assert.equal(result.movedHeavyAtomCount, 0);
      assert.equal(result.maximumDisplacementAngstrom, 0);
      assert.equal(result.unit, 'kcal/mol');
      const energy = result.finalEnergy ?? result.initialEnergy;
      assert(Number.isFinite(energy), 'Recomputed candidate energy must be finite');
      evaluated.push({ coordinateSha256:applied.selectedCoordinateSha256,
        chiDegrees:applied.chiDegrees, severeClashes:applied.severeClashes,
        energyKcalMol:energy });
    } else if (record.action === 'history.undo') applied = null;
  }
  assert.equal(applications.length, 14);
  assert.equal(evaluated.length, 13);
  assert.deepEqual(evaluated.map((candidate) => candidate.coordinateSha256).sort(), hashes);
  const eligible = evaluated.filter((candidate) => candidate.severeClashes === 0)
    .sort((a, b) => a.energyKcalMol - b.energyKcalMol);
  assert(eligible.length > 0);
  assert.equal(applications.at(-1).selectedCoordinateSha256, eligible[0].coordinateSha256,
    'The recorded response is not the fresh energy winner; do not publish this replay as energy-selected');

  const suffix = records.slice(finish);
  const featureIds = suffix[0].result.designStep.poseTransferPlan.featureCorrespondences
    .filter((feature) => feature.required).map((feature) => feature.id);
  assert(featureIds.length > 0);
  const refinement = suffix.find((record) => record.action === 'pose.refine')?.result.refinement;
  assert.equal(finalDiagnosticGate(refinement, featureIds).passed, true);
  const relaxIndex = suffix.findIndex((record) => record.action === 'optimization.run');
  assert(relaxIndex >= 0);
  const optimization = suffix[relaxIndex].result.optimization;
  assert.equal(optimization.accepted, true);
  assert.equal(optimization.valenceSafeguard.accepted, true);
  assert.equal(optimization.valenceSafeguard.complete, true);
  assert.equal(optimization.registeredPoseRetention.accepted, true);
  const pocket = (record) => record.action === 'session.inspect' && record.result.scope === 'pocket';
  const before = suffix.slice(0, relaxIndex).findLast(pocket)?.result;
  const after = suffix.slice(relaxIndex + 1).find(pocket)?.result;
  const fixed = fixedAtomRelaxationGate({ before, after,
    fixedAtomIds:optimization.registeredPoseRetention.before.fixedAtomIds });
  assert.equal(fixed.passed, true);
  return { schema:'molarium.sos1-executable-science-check/v1', passed:true,
    externalReferenceCoordinatesUsed:false, fixedLigandExactEquality:true,
    generatedCandidateCount:13, evaluatedCandidateCount:evaluated.length,
    recomputedEnergyWinner:eligible[0], candidates:evaluated,
    axh:{ refinementAccepted:true, relaxationAccepted:true, valenceAccepted:true,
      registeredFeatureRetentionAccepted:true, fixedAtomMotionAccepted:fixed.passed } };
}
