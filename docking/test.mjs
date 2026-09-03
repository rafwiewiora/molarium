import assert from 'node:assert/strict';
import { MOLARIUM_CONSTRAINT_DOCK_PROTOCOL, MOLARIUM_POSE_PROPAGATION_PROTOCOL } from './protocol.mjs';
import { applyCoreTransform, evaluateCoreConstraint, evaluateHydrogenBondConstraint,
  evaluateSpatialFeatureConstraint,
  fittedCoreTransform, hydrogenBondGeometry, restoreCapturedLigandDonorHydrogens,
  rankConstrainedPoses, scoreConstrainedPose, snapCorePositions } from './constraints.mjs';
import { appendLabbookEvent, completeLabbook, createLabbook, inputProvenance,
  renderLabbookMarkdown, verifyLabbook } from './labbook.mjs';
import { captureReferenceLigand, ensureStableAtomIds, mapReferenceCore,
  mapSurvivingReferenceAtoms } from './reference-core.mjs';
import { evaluatePoseHydrogenBonds, runConstrainedDocking } from './workflow.mjs';
import { buildReceptorSite, pairInteractionKcalMol, receptorSiteIntegrity,
  scoreReceptorLigand } from './receptor-score.mjs';
import { applyLigandPositions, captureCrossHydrogenBonds, createLigandPlan, dockingInputText,
  capturedHydrogenBondAvailability, capturedReceptorContactIntegrity, dockingTopologyText,
  mapCapturedHydrogenBonds,
  unpackConformerStack } from './browser-adapter.mjs';
import { identifyFreeRotors, packPositions4, refinePoseByTorsionMonteCarlo,
  rotateAroundBond } from './torsion-search.mjs';
import { attachNonCoreRegionsToSnappedCore, featureGuidedPoseSeeds } from './feature-seeding.mjs';
import { applyLigandHydrogenBondFeatureRemap, hydrogenBondFeatureSignature,
  proposeLigandHydrogenBondFeatureRemaps,
  retainOriginatingHydrogenBondRemapCandidates } from './contact-remap.mjs';
import { cumulativeReleasedAtomIds, recordTransformedRingRegion,
  transformedRingRegion } from './transformed-ring-region.mjs';
import { buildParameterizedSystem, cpuEnergies, mulberry32 } from '../stormm/core.mjs';

const reference = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
const candidate = Float64Array.from([4, -2, 3, 4, -1, 3, 3, -2, 3, 4, -2, 4]);
const pairs = [[0, 0], [1, 1], [2, 2], [3, 3]];
const transform = fittedCoreTransform(reference, candidate, pairs);
const aligned = applyCoreTransform(candidate, transform);
assert.ok(transform.fittedRmsdAngstrom < 1e-7);
assert.ok(Array.from(aligned).every((value, index) => Math.abs(value - reference[index]) < 1e-7));
const driftedAligned = Float64Array.from(aligned, (value, index) => value + (index % 3 + 1) * 0.01);
const snappedAligned = snapCorePositions(reference, driftedAligned, pairs);
assert.deepEqual(Array.from(snappedAligned), Array.from(reference));

const core = evaluateCoreConstraint(reference, aligned, pairs, MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.coreConstraint);
assert.equal(core.satisfied, true);
assert.equal(core.penaltyKcalMol, 0);
aligned[0] += 2;
const displacedCore = evaluateCoreConstraint(reference, aligned, pairs, MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.coreConstraint);
assert.equal(displacedCore.satisfied, false);
assert.ok(displacedCore.penaltyKcalMol > 0);

const hbondGeometry = hydrogenBondGeometry({
  donor:{ x:0, y:0, z:0 }, hydrogen:{ x:1, y:0, z:0 }, acceptor:{ x:2.8, y:0, z:0 },
});
assert.equal(hbondGeometry.dhaAngleDegrees, 180);
const goodHbond = evaluateHydrogenBondConstraint(hbondGeometry, MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.hydrogenBondConstraint);
assert.equal(goodHbond.satisfied, true);
assert.equal(goodHbond.penaltyKcalMol, 0);
const badHbond = evaluateHydrogenBondConstraint({ ...hbondGeometry, dhaAngleDegrees:90 },
  MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.hydrogenBondConstraint);
assert.equal(badHbond.satisfied, false);
assert.ok(badHbond.penaltyKcalMol > 0);

const spatialReference = Float64Array.from([
  0,0,0, 1,0,0, 0,1,0,
]);
const spatialCandidate = Float64Array.from([
  1,0,0, 0,0,0, 0,1,0,
]);
const spatialFeature = evaluateSpatialFeatureConstraint(
  spatialReference, spatialCandidate, {
    id:'symmetric-ring-fragment', kind:'conserved-fragment-rmsd',
    atomPairVariants:[[[0,0],[1,1],[2,2]], [[0,1],[1,0],[2,2]]],
    restraint:{ toleranceAngstrom:0.1, weightKcalMolPerAngstrom2:20, required:true },
  });
assert.equal(spatialFeature.selectedVariantIndex, 1,
  'graph-symmetric fragment variants must be ranked by spatial fit');
assert.equal(spatialFeature.satisfied, true);
const displacedSpatialFeature = evaluateSpatialFeatureConstraint(
  spatialReference, Float64Array.from(spatialCandidate, (value, index) =>
    value + (index % 3 === 2 ? 2 : 0)), {
    id:'symmetric-ring-fragment', kind:'conserved-fragment-rmsd',
    atomPairVariants:[[[0,0],[1,1],[2,2]], [[0,1],[1,0],[2,2]]],
    restraint:{ toleranceAngstrom:0.1, weightKcalMolPerAngstrom2:20, required:true },
  });
assert.equal(displacedSpatialFeature.satisfied, false);
assert.ok(displacedSpatialFeature.penaltyKcalMol > 0);

const donorHydrogenStart = Float64Array.from([0,0,0, 0,1,0]);
const donorHydrogenRestored = restoreCapturedLigandDonorHydrogens(donorHydrogenStart, [{
  id:'ligand-donor', required:true,
  donor:{ scope:'ligand', atomIndex:0 },
  hydrogen:{ scope:'ligand', atomIndex:1, referencePoint:{ x:0.95,y:0.1,z:0 } },
  acceptor:{ scope:'receptor', point:{ x:2.8, y:0, z:0 } },
}]);
assert.deepEqual(Array.from(donorHydrogenRestored.positions), [0,0,0, 0.95,0.1,0]);
assert.equal(donorHydrogenRestored.restored.length, 1);
assert.deepEqual(Array.from(donorHydrogenStart), [0,0,0, 0,1,0]);
const duplicateHydrogenRestoration = restoreCapturedLigandDonorHydrogens(donorHydrogenStart, [{
  id:'first', donor:{ scope:'ligand', atomIndex:0 },
  hydrogen:{ scope:'ligand', atomIndex:1, referencePoint:{ x:1,y:0,z:0 } },
  acceptor:{ scope:'receptor', point:{ x:2.8,y:0,z:0 } },
}, {
  id:'second', donor:{ scope:'ligand', atomIndex:0 },
  hydrogen:{ scope:'ligand', atomIndex:1, referencePoint:{ x:0,y:0,z:1 } },
  acceptor:{ scope:'receptor', point:{ x:0,y:0,z:2.8 } },
}]);
assert.equal(duplicateHydrogenRestoration.restored.length, 1);
assert.deepEqual(duplicateHydrogenRestoration.skipped,
  [{ id:'second', hydrogenAtomIndex:1, reason:'hydrogen-already-restored' }]);
const alternativeHydrogenRestoration = restoreCapturedLigandDonorHydrogens(donorHydrogenStart, [{
  id:'donor-group', required:true, alternatives:[{
    alternativeId:'donor-group:surviving-h',
    donor:{ scope:'ligand', atomIndex:0 },
    hydrogen:{ scope:'ligand', atomIndex:1, referencePoint:{ x:.95,y:.1,z:0 } },
    acceptor:{ scope:'receptor', point:{ x:2.8,y:0,z:0 } },
  }],
}]);
assert.equal(alternativeHydrogenRestoration.restored[0].id, 'donor-group:surviving-h');
const receptorDonorUnchanged = restoreCapturedLigandDonorHydrogens(donorHydrogenStart, [{
  donor:{ scope:'receptor', point:{ x:0,y:0,z:0 } },
  hydrogen:{ scope:'receptor', point:{ x:1,y:0,z:0 } },
  acceptor:{ scope:'ligand', atomIndex:0 },
}]);
assert.deepEqual(Array.from(receptorDonorUnchanged.positions), Array.from(donorHydrogenStart));
assert.equal(receptorDonorUnchanged.restored.length, 0);

const feasible = scoreConstrainedPose({ physicalEnergyKcalMol:-10, core,
  hydrogenBonds:[{ ...goodHbond, required:true }] });
const infeasible = scoreConstrainedPose({ physicalEnergyKcalMol:-100, core,
  hydrogenBonds:[{ ...badHbond, required:true }] });
const spatiallyInfeasible = scoreConstrainedPose({ physicalEnergyKcalMol:-100, core,
  spatialFeatures:[displacedSpatialFeature] });
assert.equal(spatiallyInfeasible.feasible, false);
const ranked = rankConstrainedPoses([infeasible, feasible]);
assert.equal(ranked[0].feasible, true);
assert.equal(ranked[0].inputIndex, 1);

const inputs = await inputProvenance({ receptorText:'ATOM receptor', ligandText:'ligand molblock',
  receptorLabel:'test receptor', ligandLabel:'test ligand', receptorAtoms:10, ligandAtoms:4 });
const labbook = await createLabbook({
  runId:'constraint-dock-test-1', startedAt:'2026-08-19T12:00:00.000Z', inputs,
  selections:{ coreAtomPairs:pairs, hydrogenBonds:[{ receptorAtom:7, ligandAtom:2, required:true }] },
  environment:{ execution:'browser', network:'disabled' }, application:{ version:'test' },
});
await appendLabbookEvent(labbook, { at:'2026-08-19T12:00:01.000Z', stage:'core-alignment',
  status:'passed', details:{ fittedRmsdAngstrom:transform.fittedRmsdAngstrom } });
await assert.rejects(() => appendLabbookEvent(labbook, {
  at:'2026-08-19T12:00:00.500Z', stage:'out-of-order', status:'invalid', details:{},
}), /chronological order/);
await completeLabbook(labbook, { completedAt:'2026-08-19T12:00:02.000Z',
  outcome:{ candidates:2, feasible:1, selectedRank:1 } });
assert.deepEqual(await verifyLabbook(labbook), { valid:true, reason:null, events:2 });
const markdown = renderLabbookMarkdown(labbook);
assert.match(markdown, /Molarium ConstraintDock-1 labbook/);
assert.match(markdown, /10\.1021\/jm0306430/);
assert.match(markdown, /does not include proprietary coordinates/);
const tampered = structuredClone(labbook);
tampered.events[0].details.fittedRmsdAngstrom = 9;
assert.equal((await verifyLabbook(tampered)).valid, false);

const designMolecule = { name:'design ligand', atoms:[
  { element:'C', x:0, y:0, z:0 }, { element:'C', x:1, y:0, z:0 },
  { element:'N', x:0, y:1, z:0 }, { element:'O', x:2.8, y:0, z:0 },
], bonds:[{ a:0, b:1, order:1 }, { a:0, b:2, order:1 }, { a:1, b:3, order:1 }] };
ensureStableAtomIds(designMolecule, 'test');
const replacementIdentityMolecule = { atoms:[
  { element:'C', designAtomId:'reuse:design:1' }, { element:'O' },
], bonds:[{ a:0, b:1, order:1 }] };
ensureStableAtomIds(replacementIdentityMolecule, 'reuse',
  ['reuse:design:1', 'reuse:design:2']);
assert.notEqual(replacementIdentityMolecule.atoms[1].designAtomId, 'reuse:design:2');
assert.equal(replacementIdentityMolecule.atoms[1].designAtomId, 'reuse:design:2:2');
const firstReplacementId = replacementIdentityMolecule.atoms[1].designAtomId;
replacementIdentityMolecule.atoms.splice(1, 1, { element:'O' });
ensureStableAtomIds(replacementIdentityMolecule, 'reuse');
assert.notEqual(replacementIdentityMolecule.atoms[1].designAtomId, firstReplacementId);
assert.ok(replacementIdentityMolecule.source.designAtomIdLedger.includes(firstReplacementId));
const captured = captureReferenceLigand(designMolecule, [0, 1, 2, 3], [0, 1, 2], 'test');
assert.ok(captured.coreMaximumTriangleDoubleAreaAngstrom2 > 0.99);
const ringCoreMolecule = { name:'six-atom core', atoms:Array.from({ length:6 }, (_, index) => ({
  element:'C', x:Math.cos(index * Math.PI / 3), y:Math.sin(index * Math.PI / 3), z:0,
})), bonds:Array.from({ length:6 }, (_, index) => ({ a:index, b:(index + 1) % 6, order:1 })) };
const ringCaptured = captureReferenceLigand(ringCoreMolecule, [0, 1, 2, 3, 4, 5],
  [0, 1, 2, 3, 4, 5], 'large-core');
assert.equal(ringCaptured.coreAtomIds.length, 6);
assert.equal(mapReferenceCore(ringCaptured, ringCoreMolecule.atoms).atomPairs.length, 6);
const disconnectedCoreMolecule = structuredClone(designMolecule);
disconnectedCoreMolecule.atoms.push({ element:'C', x:0, y:0, z:2 });
assert.throws(() => captureReferenceLigand(disconnectedCoreMolecule, [0, 1, 2, 3, 4],
  [0, 1, 2, 4], 'disconnected'), /connected set/);
const collinear = { name:'collinear', atoms:[
  { element:'C', x:0, y:0, z:0 }, { element:'C', x:1, y:0, z:0 },
  { element:'C', x:2, y:0, z:0 },
], bonds:[{ a:0, b:1, order:1 }, { a:1, b:2, order:1 }] };
assert.throws(() => captureReferenceLigand(collinear, [0, 1, 2], [0, 1, 2], 'test'), /collinear/);
const editedAtoms = designMolecule.atoms.map((atom) => ({ ...atom }));
editedAtoms.push({ element:'C', x:3.8, y:0, z:0 });
const mappedCore = mapReferenceCore(captured, editedAtoms);
assert.equal(mappedCore.complete, true);
assert.deepEqual(mappedCore.atomPairs, [[0, 0], [1, 1], [2, 2]]);
const reorderedCore = mapReferenceCore(captured, [editedAtoms[3], editedAtoms[2], editedAtoms[0], editedAtoms[1]]);
assert.equal(reorderedCore.complete, true);
assert.deepEqual(reorderedCore.atomPairs, [[0, 2], [1, 3], [2, 1]]);
const deletedCore = mapReferenceCore(captured,
  editedAtoms.filter((atom) => atom.designAtomId !== captured.coreAtomIds[1]));
assert.equal(deletedCore.complete, false);
assert.deepEqual(deletedCore.missingAtomIds, [captured.coreAtomIds[1]]);
const automaticReference = captureReferenceLigand(designMolecule, [0, 1, 2, 3], null, 'test');
const replacedGroupAtoms = designMolecule.atoms.map((atom) => ({ ...atom }))
  .filter((atom) => atom.designAtomId !== automaticReference.atomIds[3]);
replacedGroupAtoms.push({ element:'F', designAtomId:'test:new:F', x:3.2, y:0, z:0 });
const propagationMap = mapSurvivingReferenceAtoms(automaticReference, replacedGroupAtoms);
assert.equal(propagationMap.usable, true);
assert.equal(propagationMap.atomPairs.length, 3);
assert.deepEqual(propagationMap.removedAtomIds, [automaticReference.atomIds[3]]);
assert.deepEqual(propagationMap.addedAtomIds, ['test:new:F']);
assert.ok(propagationMap.maximumTriangleDoubleAreaAngstrom2 > 0.99);
const releasedPropagationMap = mapSurvivingReferenceAtoms(automaticReference,
  designMolecule.atoms, { releasedAtomIds:[automaticReference.atomIds[3]] });
assert.equal(releasedPropagationMap.usable, true);
assert.deepEqual(releasedPropagationMap.releasedReferenceAtomIds,
  [automaticReference.atomIds[3]]);
assert.equal(releasedPropagationMap.atomPairs.length, 3,
  'registered transformed atoms are released without weakening the remaining hard scaffold');

const transformedRingBefore = { name:'pyridone-like edit', atoms:[
  { element:'C',designAtomId:'scaffold' },
  { element:'C',designAtomId:'r1' }, { element:'N',designAtomId:'r2' },
  { element:'C',designAtomId:'r3' }, { element:'C',designAtomId:'r4' },
  { element:'C',designAtomId:'r5' }, { element:'C',designAtomId:'r6' },
  { element:'O',designAtomId:'carbonyl-o' }, { element:'H',designAtomId:'ring-h' },
], bonds:[
  { a:0,b:1,order:1 }, { a:1,b:2,order:1 }, { a:2,b:3,order:2 },
  { a:3,b:4,order:1 }, { a:4,b:5,order:2 }, { a:5,b:6,order:1 },
  { a:6,b:1,order:1 }, { a:3,b:7,order:2 }, { a:5,b:8,order:1 },
] };
const saturatedLactam = structuredClone(transformedRingBefore);
saturatedLactam.bonds.find((bond) => bond.a === 2 && bond.b === 3).order = 1;
saturatedLactam.bonds.find((bond) => bond.a === 4 && bond.b === 5).order = 1;
const lactamRelease = transformedRingRegion(transformedRingBefore, saturatedLactam);
assert.equal(lactamRelease.touchedRingCount, 1);
assert.deepEqual(lactamRelease.boundaryAtomIds, ['scaffold']);
assert.deepEqual(lactamRelease.releasedHeavyAtomIds,
  ['carbonyl-o','r1','r2','r3','r4','r5','r6']);
assert.ok(lactamRelease.releasedAtomIds.includes('ring-h'),
  'ring hydrogens move with a transformed ring');
assert.ok(!lactamRelease.releasedAtomIds.includes('scaffold'),
  'the external attachment remains a fixed boundary');
const cyclohexanoneGraph = structuredClone(saturatedLactam);
cyclohexanoneGraph.atoms[2].element = 'C';
const cyclohexanoneRelease = transformedRingRegion(saturatedLactam, cyclohexanoneGraph);
assert.equal(cyclohexanoneRelease.reason, 'existing-ring-chemistry-changed');
assert.ok(cyclohexanoneRelease.releasedHeavyAtomIds.includes('carbonyl-o')
  && cyclohexanoneRelease.releasedHeavyAtomIds.includes('r2'));
const methylAddition = structuredClone(transformedRingBefore);
methylAddition.atoms.push({ element:'C',designAtomId:'new-methyl' });
methylAddition.bonds.push({ a:1,b:9,order:1 });
const methylRelease = transformedRingRegion(transformedRingBefore, methylAddition);
assert.equal(methylRelease.touchedRingCount, 0);
assert.deepEqual(methylRelease.releasedHeavyAtomIds, [],
  'attaching a new substituent does not release an otherwise unchanged reference ring');
const ringHeteroatomReplacement = structuredClone(transformedRingBefore);
ringHeteroatomReplacement.atoms.splice(2, 1, {
  element:'C', designAtomId:'new-ring-carbon', x:0, y:0, z:0,
});
const pyridineReplacementRelease = transformedRingRegion(
  transformedRingBefore, ringHeteroatomReplacement);
assert.equal(pyridineReplacementRelease.touchedReferenceRingCount, 1);
assert.equal(pyridineReplacementRelease.touchedRingCount, 1);
assert.ok(pyridineReplacementRelease.removedReferenceAtomIds.includes('r2'));
assert.ok(pyridineReplacementRelease.addedProductAtomIds.includes('new-ring-carbon'));
assert.deepEqual(pyridineReplacementRelease.boundaryAtomIds, ['scaffold']);
assert.deepEqual(pyridineReplacementRelease.releasedHeavyAtomIds,
  ['carbonyl-o','new-ring-carbon','r1','r3','r4','r5','r6'],
  'an element-changing ring replacement releases the complete product ring and its exocyclic carbonyl');
const ringBondDeletion = structuredClone(transformedRingBefore);
ringBondDeletion.bonds = ringBondDeletion.bonds.filter((bond) =>
  !(bond.a === 2 && bond.b === 3));
const ringBondDeletionRelease = transformedRingRegion(transformedRingBefore, ringBondDeletion);
assert.ok(ringBondDeletionRelease.changedBondKeys.length > 0,
  'deleting a bond between surviving ring atoms is recorded as a topology change');
assert.ok(ringBondDeletionRelease.releasedHeavyAtomIds.includes('r2')
  && ringBondDeletionRelease.releasedHeavyAtomIds.includes('r3'));
const releaseLedgerMolecule = structuredClone(cyclohexanoneGraph);
recordTransformedRingRegion(releaseLedgerMolecule, lactamRelease,
  { editId:'saturate-ring', committedAt:'2026-08-22T00:00:00.000Z' });
recordTransformedRingRegion(releaseLedgerMolecule, cyclohexanoneRelease,
  { editId:'nitrogen-to-carbon', committedAt:'2026-08-22T00:01:00.000Z' });
assert.deepEqual(cumulativeReleasedAtomIds(releaseLedgerMolecule),
  ['carbonyl-o','r1','r2','r3','r4','r5','r6']);
assert.equal(MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.version, '0.4.0');
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.id, 'molarium-pose-propagation-1');
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.version, '0.9.0');
assert.match(MOLARIUM_POSE_PROPAGATION_PROTOCOL.coordinateMapping.transformedRingRule,
  /complete ring system/);
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.coordinateMapping.minimumSurvivingHeavyAtoms, 3);
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.coordinateMapping
  .minimumMaximumTriangleDoubleAreaAngstrom2, 1e-3);
assert.match(MOLARIUM_POSE_PROPAGATION_PROTOCOL.candidateInitialization
  .ligandDonorHydrogenRestoration, /captured reference coordinate/);
assert.deepEqual(MOLARIUM_POSE_PROPAGATION_PROTOCOL.candidateInitialization
  .featureGuidedAxialAnglesDegrees, [0, 60, -60, 120, -120, 180]);
assert.deepEqual(MOLARIUM_POSE_PROPAGATION_PROTOCOL.torsionMonteCarlo.proposalAnglesDegrees,
  [-180, -120, -90, -60, -30, -15, 15, 30, 60, 90, 120, 180]);
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.torsionMonteCarlo.metropolisBoltzmannKcalMolKelvin,
  0.00198720425864083);
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.restraintBiasedGeneration.method,
  'molarium-restraint-biased-internal-coordinate-search/v3');
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.restraintBiasedGeneration
  .captureStepsDefault, 96);
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.restraintBiasedGeneration
  .capturePolishSweeps, 3);
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.restraintBiasedGeneration
  .captureMaximumRelativeLigandStrainKcalMol, 100);
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.restraintBiasedGeneration
  .captureMaximumAdditionalStericClashes, 2);
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.restraintBiasedGeneration
  .captureMaximumAdditionalLennardJonesKcalMol, 100);
assert.match(MOLARIUM_POSE_PROPAGATION_PROTOCOL.restraintBiasedGeneration
  .captureObjective, /cannot outweigh pharmacophore capture/);
assert.match(MOLARIUM_POSE_PROPAGATION_PROTOCOL.restraintBiasedGeneration
  .acceptance, /not equilibrium Metropolis\/Hastings or ICM BPMC/);
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.sampling.pharmacophoreCaptureSteps, 96);
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.sampling.exhaustiveCapturePolishSweeps, 3);
assert.ok(MOLARIUM_POSE_PROPAGATION_PROTOCOL.restraintBiasedGeneration
  .ringCrankshaftAnglesDegrees.includes(60));
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.fixedScaffoldRelaxation.stepScale, 1e-4);
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.fixedScaffoldRelaxation
  .maximumDisplacementAngstromPerIteration, 0.01);
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.scoring.coulombConstantKcalAngstromPerMolE2,
  332.063713299);
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.contactFeatureMapping.uniqueCandidateAction,
  'map automatically');
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.contactFeatureMapping.algorithm,
  'role-compatible-edit-boundary/v3');
assert.match(MOLARIUM_POSE_PROPAGATION_PROTOCOL.contactFeatureMapping.geometryRule,
  /never use current coordinates/);
const protocolRandom = mulberry32(20260819);
assert.deepEqual(Array.from({ length:6 }, () => protocolRandom()), [
  0.27264824602752924, 0.39473715308122337, 0.958696351153776,
  0.34869390120729804, 0.6816380517557263, 0.09626693837344646,
]);
assert.deepEqual(Array.from({ length:4 }, (_, index) => (20260819 ^ Math.imul(index + 1,
  MOLARIUM_POSE_PROPAGATION_PROTOCOL.candidateInitialization
    .candidateSeedXorMultiplierUint32)) >>> 0),
[2667732586, 1029428385, 3683863288, 2045296951]);
const underdeterminedPropagation = mapSurvivingReferenceAtoms(automaticReference,
  replacedGroupAtoms.filter((atom) => ![automaticReference.atomIds[2], 'test:new:F']
    .includes(atom.designAtomId)));
assert.equal(underdeterminedPropagation.usable, false);
assert.match(underdeterminedPropagation.reason, /at least three/);

const translatedGood = Float64Array.from([4, -2, 3, 5, -2, 3, 4, -1, 3, 6.8, -2, 3]);
const translatedBad = Float64Array.from([4, -2, 3, 5, -2, 3, 4, -1, 3, 4, -2, 5.8]);
const workflowLabbook = await createLabbook({
  runId:'constraint-dock-workflow-1', startedAt:'2026-08-19T12:00:03.000Z', inputs,
  selections:{ coreAtomPairs:mappedCore.atomPairs,
    hydrogenBonds:[{ id:'receptor-donor-to-ligand-acceptor', required:true }] },
  environment:{ execution:'unit-test' }, application:{ version:'test' },
});
const workflowYieldEvents = [];
const dockingRun = await runConstrainedDocking({
  referencePositions:captured.positions,
  candidateConformers:[translatedBad, translatedGood],
  coreAtomPairs:mappedCore.atomPairs,
  hydrogenBondConstraints:[{
    id:'receptor-donor-to-ligand-acceptor', required:true, receptorRole:'donor',
    donor:{ scope:'receptor', point:{ x:0, y:0, z:0 } },
    hydrogen:{ scope:'receptor', point:{ x:1, y:0, z:0 } },
    acceptor:{ scope:'ligand', atomIndex:3 },
  }],
  protocol:MOLARIUM_CONSTRAINT_DOCK_PROTOCOL,
  physicalScore:({ conformerIndex }) => conformerIndex === 0 ? -100 : -10,
  yieldControl:(progress) => { workflowYieldEvents.push(progress); },
  labbook:workflowLabbook,
  startedAt:'2026-08-19T12:00:03.000Z', completedAt:'2026-08-19T12:00:04.000Z',
});
assert.equal(dockingRun.feasibleCount, 1);
assert.equal(dockingRun.selected.conformerIndex, 1);
assert.equal(dockingRun.selected.feasible, true);
assert.deepEqual(workflowYieldEvents.map((entry) => entry.completed), [1, 2]);
assert.ok(workflowYieldEvents.every((entry) => entry.stage === 'candidate ranking'));
const chemicallyGatedRun = await runConstrainedDocking({
  referencePositions:captured.positions,
  candidateConformers:[translatedGood, translatedGood],
  coreAtomPairs:mappedCore.atomPairs,
  hydrogenBondConstraints:[{
    id:'receptor-donor-to-ligand-acceptor', required:true, receptorRole:'donor',
    donor:{ scope:'receptor', point:{ x:0, y:0, z:0 } },
    hydrogen:{ scope:'receptor', point:{ x:1, y:0, z:0 } },
    acceptor:{ scope:'ligand', atomIndex:3 },
  }], protocol:MOLARIUM_CONSTRAINT_DOCK_PROTOCOL,
  physicalScore:({ conformerIndex }) => ({ energyKcalMol:conformerIndex ? -10 : -100,
    feasible:Boolean(conformerIndex), chemicalValidity:{ valid:Boolean(conformerIndex) } }),
});
assert.equal(chemicallyGatedRun.feasibleCount, 1,
  'a geometrically satisfied contact is not feasible when the physical validity gate fails');
assert.equal(chemicallyGatedRun.selected.conformerIndex, 1);
assert.equal(chemicallyGatedRun.candidates.find((entry) => entry.conformerIndex === 0)
  .physicalFeasible, false);
assert.deepEqual(await verifyLabbook(workflowLabbook), { valid:true, reason:null, events:2 });
await assert.rejects(() => appendLabbookEvent(labbook, {
  at:'2026-08-19T12:00:05.000Z', stage:'late-note', status:'invalid', details:{},
}), /completed labbook is immutable/);

const carbon = { charge_e:0, sigma_nm:0.34, epsilon_kj:0.4 };
const ljMinimum = pairInteractionKcalMol(carbon, carbon, 3.4 * 2 ** (1 / 6));
assert.ok(Math.abs(ljMinimum.lennardJonesKcalMol + 0.4 / 4.184) < 1e-12);
const oppositeCharges = pairInteractionKcalMol({ ...carbon, charge_e:0.5 },
  { ...carbon, charge_e:-0.5 }, 4);
const likeCharges = pairInteractionKcalMol({ ...carbon, charge_e:0.5 },
  { ...carbon, charge_e:0.5 }, 4);
assert.ok(oppositeCharges.coulombKcalMol < 0 && likeCharges.coulombKcalMol > 0);

const siteMolecule = {
  atoms:[
    { element:'C', record:'ATOM', x:0, y:0, z:0 },
    { element:'O', record:'ATOM', x:3, y:0, z:0 },
    { element:'C', record:'ATOM', x:30, y:0, z:0 },
    { element:'N', record:'HETATM', x:5, y:0, z:0 },
  ],
  parameterization:{ forcefield:'test', chargeModel:'test', system:{ nonbonded:[
    { index:0, ...carbon }, { index:1, ...carbon, charge_e:-0.5 },
    { index:2, ...carbon }, { index:3, ...carbon, charge_e:0.5 },
  ] } },
};
const receptorSite = buildReceptorSite(siteMolecule, [3], siteMolecule.parameterization.system,
  { radiusAngstrom:8 });
assert.deepEqual(receptorSite.atoms.map((atom) => atom.globalAtomIndex), [0, 1]);
assert.equal(receptorSiteIntegrity(receptorSite, siteMolecule).valid, true);
const movedReceptor = structuredClone(siteMolecule); movedReceptor.atoms[1].x += 0.01;
const movedReceptorIntegrity = receptorSiteIntegrity(receptorSite, movedReceptor);
assert.equal(movedReceptorIntegrity.valid, false);
assert.equal(movedReceptorIntegrity.changedAtoms, 1);
assert.ok(Math.abs(movedReceptorIntegrity.maximumDisplacementAngstrom - 0.01) < 1e-12);
const receptorScore = scoreReceptorLigand(receptorSite, Float64Array.from([5, 0, 0]),
  [{ ...carbon, charge_e:0.5 }], { ligandStrainKcalMol:2 });
assert.equal(receptorScore.pairCount, 2);
assert.equal(receptorScore.weightedLigandStrainKcalMol, 2);
assert.equal(receptorScore.interpretation, 'pose-ranking score; not a binding free energy');

const singularPair = pairInteractionKcalMol(carbon, carbon, 0);
assert.equal(singularPair.stericClash, true);
assert.equal(singularPair.totalKcalMol, 1e6);
await assert.rejects(async () => scoreReceptorLigand(receptorSite, Float64Array.from([5, 0, 0]),
  [carbon], { cutoffAngstrom:0 }), /cutoff must be positive/);
const reversedSite = { ...receptorSite, atoms:[...receptorSite.atoms].reverse() };
const reversedScore = scoreReceptorLigand(reversedSite, Float64Array.from([5, 0, 0]),
  [{ ...carbon, charge_e:0.5 }], { ligandStrainKcalMol:2 });
assert.ok(Math.abs(receptorScore.energyKcalMol - reversedScore.energyKcalMol) < 1e-12);

const complex = {
  name:'test complex',
  atoms:[
    { element:'N', record:'ATOM', atomName:'NZ', residueName:'LYS', chain:'A', residueIndex:1,
      x:-2, y:0, z:0 },
    { element:'H', record:'ATOM', atomName:'HZ1', residueName:'LYS', chain:'A', residueIndex:1,
      x:-1, y:0, z:0 },
    { element:'O', record:'ATOM', atomName:'OD1', residueName:'ASP', chain:'A', residueIndex:2,
      x:4, y:0, z:0 },
    { element:'O', record:'HETATM', residueName:'LIG', atomName:'O1', x:0.8, y:0, z:0 },
    { element:'N', record:'HETATM', residueName:'LIG', atomName:'N1', x:2, y:0, z:0 },
    { element:'H', record:'HETATM', residueName:'LIG', atomName:'H1', x:3, y:0, z:0 },
    { element:'C', record:'HETATM', residueName:'LIG', atomName:'C1', x:2, y:1, z:0 },
  ],
  bonds:[{ a:0, b:1, order:1 }, { a:4, b:5, order:1 }, { a:4, b:6, order:1 }],
};
const ligandGlobals = [3, 4, 5, 6];
const ligandPlan = createLigandPlan(complex, ligandGlobals, 'adapter-test');
assert.deepEqual(ligandPlan.globalAtomIndices, ligandGlobals);
assert.deepEqual(ligandPlan.molecule.bonds, [{ a:1, b:2, order:1 }, { a:1, b:3, order:1 }]);
assert.equal(new Set(ligandPlan.molecule.atoms.map((atom) => atom.designAtomId)).size, 4);
const capturedHbonds = captureCrossHydrogenBonds(complex, ligandGlobals, [
  { donor:0, hydrogen:1, acceptor:3, distance:1.8, cosine:-1 },
  { donor:4, hydrogen:5, acceptor:2, distance:1, cosine:-1 },
  { donor:0, hydrogen:1, acceptor:2, distance:5, cosine:-1 },
]);
assert.equal(capturedHbonds.length, 2);
assert.deepEqual(capturedHbonds.map((entry) => entry.receptorRole), ['donor', 'acceptor']);
const mappedHbonds = mapCapturedHydrogenBonds(capturedHbonds, ligandPlan.molecule.atoms);
assert.equal(mappedHbonds.complete, true);
assert.equal(mappedHbonds.constraints[0].acceptor.atomIndex, 0);
assert.equal(mappedHbonds.constraints[1].donor.atomIndex, 1);
const completeHbondAvailability = capturedHydrogenBondAvailability(capturedHbonds,
  ligandPlan.molecule.atoms);
assert.deepEqual(completeHbondAvailability.map((entry) => entry.available), [true, true]);
const brokenDonorHydrogenPlan = structuredClone(ligandPlan.molecule);
brokenDonorHydrogenPlan.bonds = brokenDonorHydrogenPlan.bonds.filter((bond) =>
  !([bond.a, bond.b].includes(1) && [bond.a, bond.b].includes(2)));
brokenDonorHydrogenPlan.atoms.push({ element:'H', designAtomId:'adapter-test:replacement:H' });
brokenDonorHydrogenPlan.bonds.push({ a:1, b:brokenDonorHydrogenPlan.atoms.length - 1, order:1 });
const brokenDonorAvailability = capturedHydrogenBondAvailability(capturedHbonds,
  brokenDonorHydrogenPlan);
assert.equal(brokenDonorAvailability[1].available, false);
assert.deepEqual(brokenDonorAvailability[1].incompatibleAtomIds,
  [capturedHbonds[1].hydrogen.designAtomId]);
assert.deepEqual(brokenDonorAvailability[1].reasons,
  ['ligand-donor-hydrogen-bond-missing']);
const noRequiredHbonds = mapCapturedHydrogenBonds(capturedHbonds, ligandPlan.molecule.atoms, []);
assert.equal(noRequiredHbonds.complete, true);
assert.deepEqual(noRequiredHbonds.constraints, []);
const missingHbondAtom = mapCapturedHydrogenBonds(capturedHbonds,
  ligandPlan.molecule.atoms.filter((atom) => atom.atomName !== 'H1'));
assert.equal(missingHbondAtom.complete, false);
assert.equal(missingHbondAtom.missing[0].constraintId, capturedHbonds[1].id);
const hbondAvailability = capturedHydrogenBondAvailability(capturedHbonds,
  ligandPlan.molecule.atoms.filter((atom) => atom.atomName !== 'H1'));
assert.equal(hbondAvailability[0].available, true);
assert.equal(hbondAvailability[1].available, false);
assert.deepEqual(hbondAvailability[1].missingAtomIds,
  [capturedHbonds[1].hydrogen.designAtomId]);

const polarAcceptorComplex = { atoms:[
  { element:'N', designAtomId:'polar:receptor:N', x:-2,y:0,z:0 },
  { element:'H', designAtomId:'polar:receptor:H', x:-1,y:0,z:0 },
  { element:'O', designAtomId:'polar:ligand:OH', x:.8,y:0,z:0 },
  { element:'H', designAtomId:'polar:ligand:HO', x:.8,y:1,z:0 },
  { element:'C', designAtomId:'polar:ligand:C', x:2,y:0,z:0 },
  { element:'F', designAtomId:'polar:ligand:F', x:3.2,y:0,z:0 },
], bonds:[{ a:0,b:1,order:1 }, { a:2,b:3,order:1 }, { a:2,b:4,order:1 },
  { a:4,b:5,order:1 }] };
const polarLigandIndices = [2,3,4,5];
const polarCaptured = captureCrossHydrogenBonds(polarAcceptorComplex, polarLigandIndices, [
  { donor:0, hydrogen:1, acceptor:2, distance:1.8, cosine:-1 },
  { donor:0, hydrogen:1, acceptor:5, distance:2.2, cosine:-1 },
]);
assert.equal(polarCaptured.length, 2);
assert.match(polarCaptured[0].acceptor.featureSignature, /hydroxyl oxygen acceptor/);
assert.match(polarCaptured[1].acceptor.featureSignature, /fluorine acceptor/);
assert.deepEqual(capturedHydrogenBondAvailability(polarCaptured, polarAcceptorComplex)
  .map((entry) => entry.available), [true, true]);
const changedHydroxylComplex = structuredClone(polarAcceptorComplex);
changedHydroxylComplex.bonds = changedHydroxylComplex.bonds
  .filter((bond) => !(bond.a === 2 && bond.b === 3))
  .map((bond) => bond.a === 2 && bond.b === 4 ? { ...bond, order:2 } : bond);
const changedHydroxylAvailability = capturedHydrogenBondAvailability(polarCaptured,
  changedHydroxylComplex);
assert.equal(changedHydroxylAvailability[0].available, false);
assert.deepEqual(changedHydroxylAvailability[0].incompatibleAtomIds,
  [polarCaptured[0].acceptor.designAtomId]);
assert.deepEqual(changedHydroxylAvailability[0].reasons,
  ['ligand-acceptor-signature-changed']);
assert.equal(changedHydroxylAvailability[1].available, true);

const acidHydroxylComplex = { atoms:[
  { element:'N', x:-2,y:0,z:0 }, { element:'H', x:-1,y:0,z:0 },
  { element:'O', x:.8,y:0,z:0 }, { element:'H', x:.8,y:1,z:0 },
  { element:'C', x:2,y:0,z:0 }, { element:'O', x:3.2,y:0,z:0 },
], bonds:[{ a:0,b:1,order:1 }, { a:2,b:3,order:1 }, { a:2,b:4,order:1 },
  { a:4,b:5,order:2 }] };
assert.deepEqual(captureCrossHydrogenBonds(acidHydroxylComplex, [2,3,4,5],
  [{ donor:0, hydrogen:1, acceptor:2, distance:1.8, cosine:-1 }]), []);

const wrongDonorHydrogenComplex = { atoms:[
  { element:'O', x:4,y:0,z:0 },
  { element:'N', x:1,y:0,z:0 }, { element:'H', x:2,y:0,z:0 },
  { element:'H', x:2,y:1,z:0 }, { element:'C', x:0,y:0,z:0 },
], bonds:[{ a:1,b:2,order:1 }, { a:1,b:4,order:1 }] };
assert.deepEqual(captureCrossHydrogenBonds(wrongDonorHydrogenComplex, [1,2,3,4],
  [{ donor:1, hydrogen:3, acceptor:0, distance:2, cosine:-1 }]), []);

const waterContactComplex = structuredClone(complex);
waterContactComplex.atoms.push({ element:'O', record:'HETATM', residueName:'HOH', atomName:'O',
  chain:'W', residueIndex:9, x:4.8, y:0, z:0 });
const waterContact = captureCrossHydrogenBonds(waterContactComplex, ligandGlobals,
  [{ donor:4, hydrogen:5, acceptor:7, distance:1.8, cosine:-1 }]);
assert.equal(waterContact[0].acceptor.element, 'O');
assert.ok(waterContact[0].acceptor.designAtomId);
assert.equal(capturedReceptorContactIntegrity(waterContact, waterContactComplex).valid, true);
const movedWaterContact = structuredClone(waterContactComplex);
movedWaterContact.atoms[7].x += 0.01;
const movedWaterIntegrity = capturedReceptorContactIntegrity(waterContact, movedWaterContact);
assert.equal(movedWaterIntegrity.valid, false);
assert.equal(movedWaterIntegrity.issues[0].reason, 'coordinate-changed');

const remapBefore = { name:'captured carbonyl contact', atoms:[
  { element:'C', designAtomId:'core:1', x:0, y:0, z:0 },
  { element:'C', designAtomId:'core:2', x:1.4, y:0, z:0 },
  { element:'C', designAtomId:'core:3', x:0, y:1.4, z:0 },
  { element:'C', designAtomId:'old:carbonyl', x:2.8, y:0, z:0 },
  { element:'O', designAtomId:'old:oxygen', x:4.0, y:0, z:0 },
], bonds:[
  { a:0,b:1,order:1 }, { a:1,b:2,order:1 }, { a:2,b:0,order:1 },
  { a:1,b:3,order:1 }, { a:3,b:4,order:2 },
] };
const carbonylSignature = hydrogenBondFeatureSignature(remapBefore, 4, 'acceptor');
assert.match(carbonylSignature, /carbonyl oxygen acceptor/);
const remapDefinition = { id:'captured-carbonyl', label:'SER N → ligand O', required:true,
  receptorRole:'donor',
  donor:{ scope:'receptor', designAtomId:'protein:N', element:'N', point:{ x:6.8,y:0,z:0 } },
  hydrogen:{ scope:'receptor', designAtomId:'protein:H', element:'H', point:{ x:5.8,y:0,z:0 } },
  acceptor:{ scope:'ligand', designAtomId:'old:oxygen', element:'O',
    featureSignature:carbonylSignature, referencePoint:{ x:4,y:0,z:0 } } };
const remapAfter = structuredClone(remapBefore);
remapAfter.atoms.splice(3, 2,
  { element:'C', designAtomId:'new:carbonyl', x:2.8, y:0.2, z:0 },
  { element:'O', designAtomId:'new:oxygen', x:4.0, y:0.2, z:0 });
remapAfter.bonds = remapAfter.bonds.slice(0, 3).concat([
  { a:1,b:3,order:1 }, { a:3,b:4,order:2 },
]);
const uniqueRemap = proposeLigandHydrogenBondFeatureRemaps([remapDefinition], remapAfter,
  [0,1,2,3,4], { eligibleAtomIndices:[3,4], beforeMolecule:remapBefore })[0];
assert.equal(uniqueRemap.status, 'unique');
assert.deepEqual(uniqueRemap.boundaryAnchorIds, ['core:2']);
assert.deepEqual(uniqueRemap.candidates[0].atomIds, ['new:oxygen']);
const remapBeforeWithExisting = structuredClone(remapBefore);
remapBeforeWithExisting.atoms.push({ element:'N', designAtomId:'existing:nitrogen',
  x:2.2, y:1.3, z:0 });
remapBeforeWithExisting.bonds.push({ a:1, b:5, order:1 });
const remapAfterWithExisting = structuredClone(remapAfter);
remapAfterWithExisting.atoms.push(structuredClone(remapBeforeWithExisting.atoms[5]));
remapAfterWithExisting.bonds.push({ a:1, b:5, order:1 });
const registeredRegionRemap = proposeLigandHydrogenBondFeatureRemaps([remapDefinition],
  remapAfterWithExisting, [0,1,2,3,4,5], {
    eligibleAtomIndices:[3,4], beforeMolecule:remapBeforeWithExisting,
    editRegionsOverride:{ removedAtomIds:['old:carbonyl', 'old:oxygen'],
      addedAtomIds:['new:carbonyl', 'new:oxygen'], changedAtomIds:[] },
  })[0];
assert.equal(registeredRegionRemap.status, 'unique');
assert.deepEqual(registeredRegionRemap.candidates.map((entry) => entry.atomIds), [['new:oxygen']],
  'a pre-existing role-compatible feature at the same anchor is not part of the registered edit');
const appliedRemap = applyLigandHydrogenBondFeatureRemap(remapDefinition,
  uniqueRemap.candidates[0]);
assert.equal(appliedRemap.acceptor.designAtomId, 'new:oxygen');
assert.equal(appliedRemap.donor.designAtomId, 'protein:N');
assert.deepEqual(appliedRemap.targetLigandFeatureReferencePoint, { x:4,y:0,z:0 });
assert.equal(capturedHydrogenBondAvailability([appliedRemap], remapAfter)[0].available, true);

// Interaction-role transfer deliberately spans medicinal-chemistry feature
// classes. The recorded edit boundary establishes lineage; donor/acceptor
// perception establishes eligibility; the complete pose score decides which
// hypothesis is physically credible.
function acceptorReplacement(atoms, bonds) {
  const molecule = { atoms:[
    ...structuredClone(remapBefore.atoms.slice(0, 3)), ...structuredClone(atoms),
  ], bonds:[
    ...structuredClone(remapBefore.bonds.slice(0, 3)), ...structuredClone(bonds),
  ] };
  return { molecule, proposal:proposeLigandHydrogenBondFeatureRemaps([remapDefinition], molecule,
    molecule.atoms.map((_, index) => index), {
      eligibleAtomIndices:molecule.atoms.map((_, index) => index).slice(3),
      beforeMolecule:remapBefore,
    })[0] };
}

const nitrileReplacement = acceptorReplacement([
  { element:'C', designAtomId:'nitrile:C', x:2.8,y:0,z:0 },
  { element:'N', designAtomId:'nitrile:N', x:4.0,y:0,z:0 },
], [{ a:1,b:3,order:1 }, { a:3,b:4,order:3 }]);
assert.equal(nitrileReplacement.proposal.status, 'unique');
assert.deepEqual(nitrileReplacement.proposal.candidates[0].atomIds, ['nitrile:N']);
assert.equal(nitrileReplacement.proposal.candidates[0].type, 'nitrile nitrogen acceptor');
assert.equal(nitrileReplacement.proposal.candidates[0].matchKind,
  'role-compatible-bioisostere');

const sulfoneReplacement = acceptorReplacement([
  { element:'S', designAtomId:'sulfone:S', x:2.8,y:0,z:0 },
  { element:'O', designAtomId:'sulfone:O1', x:4.0,y:.8,z:0 },
  { element:'O', designAtomId:'sulfone:O2', x:4.0,y:-.8,z:0 },
], [{ a:1,b:3,order:1 }, { a:3,b:4,order:2 }, { a:3,b:5,order:2 }]);
assert.equal(sulfoneReplacement.proposal.status, 'ambiguous');
assert.deepEqual(sulfoneReplacement.proposal.candidates.map((entry) => entry.atomIds),
  [['sulfone:O1'], ['sulfone:O2']]);
assert.ok(sulfoneReplacement.proposal.candidates.every((entry) =>
  entry.type === 'sulfonyl oxygen acceptor'));
assert.ok(sulfoneReplacement.proposal.candidates.every((entry) =>
  entry.matchKind === 'role-compatible-bioisostere'));

// The interactive medicinal-chemistry path often preserves the original
// carbonyl oxygen while changing its centre C -> S and adding the second
// oxygen.  The surviving oxygen was not an explicitly added atom, so its
// feature-class transition must itself put it in the audited edit region.
const inPlaceSulfone = structuredClone(remapBefore);
inPlaceSulfone.atoms[3].element = 'S';
inPlaceSulfone.atoms.push({ element:'O', designAtomId:'sulfone:added-O', x:2.8,y:1.4,z:0 });
inPlaceSulfone.bonds.push({ a:3,b:5,order:2 });
const inPlaceSulfoneProposal = proposeLigandHydrogenBondFeatureRemaps(
  [remapDefinition], inPlaceSulfone, [0,1,2,3,4,5], {
    // Deliberately omit the preserved oxygen: this mirrors the UI's changed
    // atom list and proves feature-signature lineage is inferred from graphs.
    eligibleAtomIndices:[3,5], beforeMolecule:remapBefore,
  })[0];
assert.equal(inPlaceSulfoneProposal.status, 'ambiguous');
assert.deepEqual(inPlaceSulfoneProposal.boundaryAnchorIds, ['core:2']);
assert.deepEqual(inPlaceSulfoneProposal.candidates.map((entry) => entry.atomIds),
  [['old:oxygen'], ['sulfone:added-O']]);
assert.ok(inPlaceSulfoneProposal.candidates.every((entry) =>
  entry.type === 'sulfonyl oxygen acceptor'
    && entry.matchKind === 'role-compatible-bioisostere'));

const inPlacePhosphoryl = structuredClone(remapBefore);
inPlacePhosphoryl.atoms[3].element = 'P';
const inPlacePhosphorylProposal = proposeLigandHydrogenBondFeatureRemaps(
  [remapDefinition], inPlacePhosphoryl, [0,1,2,3,4], {
    eligibleAtomIndices:[3], beforeMolecule:remapBefore,
  })[0];
assert.equal(inPlacePhosphorylProposal.status, 'unique');
assert.deepEqual(inPlacePhosphorylProposal.boundaryAnchorIds, ['core:2']);
assert.deepEqual(inPlacePhosphorylProposal.candidates[0].atomIds, ['old:oxygen']);
assert.equal(inPlacePhosphorylProposal.candidates[0].type,
  'phosphoryl oxygen acceptor');
assert.equal(inPlacePhosphorylProposal.candidates[0].matchKind,
  'role-compatible-bioisostere');

const aromaticNitrogenReplacement = acceptorReplacement([
  { element:'C', aromatic:true, designAtomId:'pyridine:C1', x:2.8,y:0,z:0 },
  { element:'N', aromatic:true, designAtomId:'pyridine:N2', x:3.5,y:1.2,z:0 },
  { element:'C', aromatic:true, designAtomId:'pyridine:C3', x:4.9,y:1.2,z:0 },
  { element:'C', aromatic:true, designAtomId:'pyridine:C4', x:5.6,y:0,z:0 },
  { element:'C', aromatic:true, designAtomId:'pyridine:C5', x:4.9,y:-1.2,z:0 },
  { element:'C', aromatic:true, designAtomId:'pyridine:C6', x:3.5,y:-1.2,z:0 },
], [
  { a:1,b:3,order:1 }, { a:3,b:4,order:1.5 }, { a:4,b:5,order:1.5 },
  { a:5,b:6,order:1.5 }, { a:6,b:7,order:1.5 }, { a:7,b:8,order:1.5 },
  { a:8,b:3,order:1.5 },
]);
assert.equal(aromaticNitrogenReplacement.proposal.status, 'unique');
assert.deepEqual(aromaticNitrogenReplacement.proposal.candidates[0].atomIds,
  ['pyridine:N2']);
assert.equal(aromaticNitrogenReplacement.proposal.candidates[0].matchKind,
  'role-compatible-bioisostere');

const protonatedAromaticReplacement = acceptorReplacement([
  { element:'C', aromatic:true, designAtomId:'pyridinium:C1', x:2.8,y:0,z:0 },
  { element:'N', aromatic:true, formalCharge:1, designAtomId:'pyridinium:N2', x:3.5,y:1.2,z:0 },
  { element:'H', designAtomId:'pyridinium:H', x:3.1,y:2.0,z:0 },
  { element:'C', aromatic:true, designAtomId:'pyridinium:C3', x:4.9,y:1.2,z:0 },
  { element:'C', aromatic:true, designAtomId:'pyridinium:C4', x:5.6,y:0,z:0 },
  { element:'C', aromatic:true, designAtomId:'pyridinium:C5', x:4.9,y:-1.2,z:0 },
  { element:'C', aromatic:true, designAtomId:'pyridinium:C6', x:3.5,y:-1.2,z:0 },
], [
  { a:1,b:3,order:1 }, { a:3,b:4,order:1.5 }, { a:4,b:5,order:1 },
  { a:4,b:6,order:1.5 }, { a:6,b:7,order:1.5 }, { a:7,b:8,order:1.5 },
  { a:8,b:9,order:1.5 }, { a:9,b:3,order:1.5 },
]);
assert.equal(protonatedAromaticReplacement.proposal.status, 'unavailable');

const roleDonorBefore = { atoms:[
  { element:'C', designAtomId:'donor-role:core', x:0,y:0,z:0 },
  { element:'N', designAtomId:'donor-role:N', x:1.4,y:0,z:0 },
  { element:'H', designAtomId:'donor-role:H', x:2.3,y:0,z:0 },
], bonds:[{ a:0,b:1,order:1 }, { a:1,b:2,order:1 }] };
const roleDonorDefinition = { id:'captured-donor-role', required:true, receptorRole:'acceptor',
  donor:{ scope:'ligand', designAtomId:'donor-role:N', element:'N',
    featureSignature:hydrogenBondFeatureSignature(roleDonorBefore, 1, 'donor') },
  hydrogen:{ scope:'ligand', designAtomId:'donor-role:H', element:'H' },
  acceptor:{ scope:'receptor', designAtomId:'protein:O', element:'O', point:{ x:4,y:0,z:0 } },
};
// The explicit H remains part of the same N-H donor when an adjacent
// carbonyl centre becomes a sulfonyl centre. It must not be mistaken for a
// scaffold boundary merely because its own atom identity did not change.
const survivingSultamDonorBefore = { atoms:[
  { element:'C', designAtomId:'sultam:left', x:-1.4,y:0,z:0 },
  { element:'C', designAtomId:'sultam:center', x:0,y:0,z:0 },
  { element:'O', designAtomId:'sultam:old-O', x:0,y:1.3,z:0 },
  { element:'N', designAtomId:'sultam:N', x:1.3,y:0,z:0 },
  { element:'H', designAtomId:'sultam:H', x:1.3,y:-1,z:0 },
  { element:'C', designAtomId:'sultam:right', x:2.6,y:0,z:0 },
], bonds:[
  { a:0,b:1,order:1 }, { a:1,b:2,order:2 }, { a:1,b:3,order:1 },
  { a:3,b:4,order:1 }, { a:3,b:5,order:1 },
] };
const survivingSultamDonorDefinition = { id:'surviving-sultam-donor', required:true,
  receptorRole:'acceptor',
  donor:{ scope:'ligand', designAtomId:'sultam:N', element:'N',
    featureSignature:hydrogenBondFeatureSignature(survivingSultamDonorBefore, 3, 'donor') },
  hydrogen:{ scope:'ligand', designAtomId:'sultam:H', element:'H' },
  acceptor:{ scope:'receptor', designAtomId:'protein:O', element:'O', point:{ x:4,y:0,z:0 } },
};
const survivingSultamDonorAfter = structuredClone(survivingSultamDonorBefore);
survivingSultamDonorAfter.atoms[1].element = 'S';
survivingSultamDonorAfter.atoms.push(
  { element:'O', designAtomId:'sultam:added-O', x:0,y:-1.3,z:0 });
survivingSultamDonorAfter.bonds.push({ a:1,b:6,order:2 });
const survivingSultamDonorProposal = proposeLigandHydrogenBondFeatureRemaps(
  [survivingSultamDonorDefinition], survivingSultamDonorAfter,
  survivingSultamDonorAfter.atoms.map((_, index) => index), {
    eligibleAtomIndices:[1,6], beforeMolecule:survivingSultamDonorBefore,
  })[0];
assert.equal(survivingSultamDonorProposal.status, 'unique');
assert.deepEqual(survivingSultamDonorProposal.boundaryAnchorIds,
  ['sultam:left', 'sultam:right']);
assert.deepEqual(survivingSultamDonorProposal.candidates[0].atomIds,
  ['sultam:N', 'sultam:H']);
assert.equal(survivingSultamDonorProposal.candidates[0].matchKind,
  'role-compatible-bioisostere');
for (const replacement of [
  { label:'hydroxyl', element:'O' },
  { label:'thiol', element:'S' },
]) {
  const molecule = { atoms:[structuredClone(roleDonorBefore.atoms[0]),
    { element:replacement.element, designAtomId:`${replacement.label}:D`, x:1.4,y:0,z:0 },
    { element:'H', designAtomId:`${replacement.label}:H`, x:2.3,y:0,z:0 },
  ], bonds:[{ a:0,b:1,order:1 }, { a:1,b:2,order:1 }] };
  const proposal = proposeLigandHydrogenBondFeatureRemaps([roleDonorDefinition], molecule,
    [0,1,2], { eligibleAtomIndices:[1,2], beforeMolecule:roleDonorBefore })[0];
  assert.equal(proposal.status, 'unique', replacement.label);
  assert.equal(proposal.candidates[0].role, 'donor');
  assert.equal(proposal.candidates[0].matchKind, 'role-compatible-bioisostere');
}

const sulfonamideDonor = { atoms:[structuredClone(roleDonorBefore.atoms[0]),
  { element:'S', designAtomId:'sulfonamide:S', x:1.3,y:0,z:0 },
  { element:'O', designAtomId:'sulfonamide:O1', x:1.5,y:1.3,z:0 },
  { element:'O', designAtomId:'sulfonamide:O2', x:1.5,y:-1.3,z:0 },
  { element:'N', designAtomId:'sulfonamide:N', x:2.7,y:0,z:0 },
  { element:'H', designAtomId:'sulfonamide:H', x:3.6,y:0,z:0 },
], bonds:[
  { a:0,b:1,order:1 }, { a:1,b:2,order:2 }, { a:1,b:3,order:2 },
  { a:1,b:4,order:1 }, { a:4,b:5,order:1 },
] };
const sulfonamideProposal = proposeLigandHydrogenBondFeatureRemaps([roleDonorDefinition],
  sulfonamideDonor, sulfonamideDonor.atoms.map((_, index) => index),
  { eligibleAtomIndices:[1,2,3,4,5], beforeMolecule:roleDonorBefore })[0];
assert.equal(sulfonamideProposal.status, 'unique');
assert.deepEqual(sulfonamideProposal.candidates[0].atomIds,
  ['sulfonamide:N', 'sulfonamide:H']);
assert.equal(sulfonamideProposal.candidates[0].matchKind,
  'role-compatible-bioisostere');

const groupedDefinition = { id:'acceptor-hypothesis', label:'protein N-H → edited group',
  required:true, receptorRole:'donor', alternatives:[
    { ...structuredClone(remapDefinition), alternativeId:'far-carbonyl',
      donor:{ scope:'receptor', designAtomId:'protein:N', element:'N', point:{ x:0,y:0,z:0 } },
      hydrogen:{ scope:'receptor', designAtomId:'protein:H', element:'H', point:{ x:1,y:0,z:0 } },
      acceptor:{ scope:'ligand', designAtomId:'candidate:far', element:'O' } },
    { ...structuredClone(remapDefinition), alternativeId:'near-nitrile',
      donor:{ scope:'receptor', designAtomId:'protein:N', element:'N', point:{ x:0,y:0,z:0 } },
      hydrogen:{ scope:'receptor', designAtomId:'protein:H', element:'H', point:{ x:1,y:0,z:0 } },
      acceptor:{ scope:'ligand', designAtomId:'candidate:near', element:'N' } },
  ] };
const groupedAtoms = [
  { element:'O', designAtomId:'candidate:far', x:6,y:0,z:0 },
  { element:'N', designAtomId:'candidate:near', x:2.8,y:0,z:0 },
];
const groupedMapped = mapCapturedHydrogenBonds([groupedDefinition], groupedAtoms);
assert.equal(groupedMapped.complete, true);
assert.equal(groupedMapped.constraints.length, 1);
assert.equal(groupedMapped.constraints[0].alternatives.length, 2);
const groupedEvaluation = evaluatePoseHydrogenBonds(groupedMapped.constraints,
  Float64Array.from(groupedAtoms.flatMap((atom) => [atom.x, atom.y, atom.z])),
  MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.hydrogenBondConstraint)[0];
assert.equal(groupedEvaluation.selectedAlternativeId, 'near-nitrile');
assert.equal(groupedEvaluation.alternativeCount, 2);
assert.equal(groupedEvaluation.satisfied, true);
assert.ok(groupedEvaluation.alternatives.find((entry) => entry.id === 'far-carbonyl')
  .penaltyKcalMol > groupedEvaluation.penaltyKcalMol);
const groupedScore = scoreConstrainedPose({ physicalEnergyKcalMol:-5, core,
  hydrogenBonds:[groupedEvaluation] });
assert.equal(groupedScore.feasible, true);
assert.equal(groupedScore.totalScoreKcalMol, -5);

const switchedGroupedEvaluation = evaluatePoseHydrogenBonds(groupedMapped.constraints,
  Float64Array.from([2.8,0,0, 6,0,0]),
  MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.hydrogenBondConstraint)[0];
assert.equal(switchedGroupedEvaluation.selectedAlternativeId, 'far-carbonyl');
assert.equal(switchedGroupedEvaluation.satisfied, true);
const tiedGroupedEvaluation = evaluatePoseHydrogenBonds(groupedMapped.constraints,
  Float64Array.from([2.8,0,0, 2.8,0,0]),
  MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.hydrogenBondConstraint)[0];
assert.equal(tiedGroupedEvaluation.selectedAlternativeId, 'far-carbonyl');
const failedGroupedEvaluation = evaluatePoseHydrogenBonds(groupedMapped.constraints,
  Float64Array.from([6,0,0, 7,0,0]),
  MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.hydrogenBondConstraint)[0];
assert.equal(failedGroupedEvaluation.satisfied, false);
assert.equal(scoreConstrainedPose({ physicalEnergyKcalMol:-100, core,
  hydrogenBonds:[failedGroupedEvaluation] }).feasible, false);

const workflowGroupedConstraint = structuredClone(groupedMapped.constraints[0]);
workflowGroupedConstraint.alternatives[0].acceptor.atomIndex = 3;
workflowGroupedConstraint.alternatives[1].acceptor.atomIndex = 4;
const workflowGroupedReference = Float64Array.from([
  10,10,10, 11,10,10, 10,11,10, 2.8,0,0, 6,0,0,
]);
const groupedWorkflowRun = await runConstrainedDocking({
  referencePositions:workflowGroupedReference,
  candidateConformers:[workflowGroupedReference, Float64Array.from([
    10,10,10, 11,10,10, 10,11,10, 6,0,0, 2.8,0,0,
  ])],
  coreAtomPairs:[[0,0],[1,1],[2,2]],
  hydrogenBondConstraints:[workflowGroupedConstraint],
  protocol:MOLARIUM_CONSTRAINT_DOCK_PROTOCOL,
  physicalScore:({ conformerIndex }) => conformerIndex ? -10 : -5,
});
assert.equal(groupedWorkflowRun.feasibleCount, 2);
assert.equal(groupedWorkflowRun.selected.conformerIndex, 1);
assert.equal(groupedWorkflowRun.selected.hydrogenBonds[0].selectedAlternativeId,
  'near-nitrile');
assert.equal(groupedWorkflowRun.selected.hydrogenBonds[0].alternatives.length, 2);

const partiallyMissingGroup = structuredClone(groupedDefinition);
partiallyMissingGroup.alternatives[0].acceptor.designAtomId = 'candidate:missing';
const partiallyMapped = mapCapturedHydrogenBonds([partiallyMissingGroup], groupedAtoms);
assert.equal(partiallyMapped.complete, true);
assert.equal(partiallyMapped.missing.length, 0);
assert.deepEqual(partiallyMapped.droppedAlternatives, [{
  constraintId:'acceptor-hypothesis', alternativeId:'far-carbonyl',
  designAtomId:'candidate:missing',
}]);
assert.equal(partiallyMapped.constraints[0].alternatives.length, 1);

// Replacing a group can span two completed chemistry transactions (delete,
// then add). The deletion transaction is the last graph that can recover the
// captured atom's originating boundary; the addition transaction must combine
// that boundary with its newly eligible role-compatible features.
const pyridoneBefore = { name:'pyridone attached to a common core', atoms:[
  { element:'C', designAtomId:'pyridone:core', x:-1.4,y:0,z:0 },
  { element:'C', designAtomId:'pyridone:C1', x:0,y:0,z:0 },
  { element:'N', designAtomId:'pyridone:N2', x:.7,y:1.2,z:0 },
  { element:'C', designAtomId:'pyridone:C3', x:2.1,y:1.2,z:0 },
  { element:'C', designAtomId:'pyridone:C4', x:2.8,y:0,z:0 },
  { element:'C', designAtomId:'pyridone:C5', x:2.1,y:-1.2,z:0 },
  { element:'C', designAtomId:'pyridone:C6', x:.7,y:-1.2,z:0 },
  { element:'O', designAtomId:'pyridone:O', x:0,y:-1.25,z:0 },
], bonds:[
  { a:0,b:4,order:1 }, { a:1,b:2,order:1 }, { a:2,b:3,order:1 },
  { a:3,b:4,order:2 }, { a:4,b:5,order:1 }, { a:5,b:6,order:2 },
  { a:6,b:1,order:1 }, { a:1,b:7,order:2 },
] };
const pyridoneSignature = hydrogenBondFeatureSignature(pyridoneBefore, 7, 'acceptor');
const pyridoneDefinition = { ...structuredClone(remapDefinition), id:'pyridone-carbonyl',
  acceptor:{ ...structuredClone(remapDefinition.acceptor), designAtomId:'pyridone:O',
    featureSignature:pyridoneSignature } };
const deletedPyridone = { name:'common core after pyridone deletion',
  atoms:[structuredClone(pyridoneBefore.atoms[0])], bonds:[] };
const deletionProposal = proposeLigandHydrogenBondFeatureRemaps([pyridoneDefinition],
  deletedPyridone, [0], { eligibleAtomIndices:[], beforeMolecule:pyridoneBefore })[0];
assert.equal(deletionProposal.status, 'unavailable');
assert.deepEqual(deletionProposal.boundaryAnchorIds, ['pyridone:core']);
const cyclohexanoneAfter = { name:'cyclohexanone replacement on the common core', atoms:[
  structuredClone(deletedPyridone.atoms[0]),
  { element:'C', designAtomId:'cyclohexanone:C1', x:0,y:0,z:0 },
  { element:'C', designAtomId:'cyclohexanone:C2', x:.7,y:1.2,z:0 },
  { element:'C', designAtomId:'cyclohexanone:C3', x:2.1,y:1.2,z:0 },
  { element:'C', designAtomId:'cyclohexanone:C4', x:2.8,y:0,z:0 },
  { element:'C', designAtomId:'cyclohexanone:C5', x:2.1,y:-1.2,z:0 },
  { element:'C', designAtomId:'cyclohexanone:C6', x:.7,y:-1.2,z:0 },
  { element:'O', designAtomId:'cyclohexanone:O', x:0,y:-1.25,z:0 },
], bonds:[
  { a:0,b:4,order:1 }, { a:1,b:2,order:1 }, { a:2,b:3,order:1 },
  { a:3,b:4,order:1 }, { a:4,b:5,order:1 }, { a:5,b:6,order:1 },
  { a:6,b:1,order:1 }, { a:1,b:7,order:2 },
] };
const additionProposal = proposeLigandHydrogenBondFeatureRemaps([pyridoneDefinition],
  cyclohexanoneAfter, cyclohexanoneAfter.atoms.map((_, index) => index),
  { eligibleAtomIndices:[1,2,3,4,5,6,7], beforeMolecule:deletedPyridone })[0];
assert.equal(additionProposal.status, 'unavailable');
assert.deepEqual(additionProposal.editEligibleFeatures.map((entry) => entry.atomIds),
  [['cyclohexanone:O']]);
const sequentialReplacementProposal = retainOriginatingHydrogenBondRemapCandidates(
  { ...deletionProposal, committedEditId:'delete-pyridone' }, additionProposal,
  cyclohexanoneAfter, cyclohexanoneAfter.atoms.map((_, index) => index));
assert.equal(sequentialReplacementProposal.status, 'unique');
assert.deepEqual(sequentialReplacementProposal.boundaryAnchorIds, ['pyridone:core']);
assert.deepEqual(sequentialReplacementProposal.candidates[0].atomIds, ['cyclohexanone:O']);
assert.equal(sequentialReplacementProposal.originatingCommittedEditId, 'delete-pyridone');
const appliedSequentialReplacement = applyLigandHydrogenBondFeatureRemap(pyridoneDefinition,
  sequentialReplacementProposal.candidates[0]);
assert.equal(appliedSequentialReplacement.acceptor.designAtomId, 'cyclohexanone:O');
assert.equal(appliedSequentialReplacement.donor.designAtomId, 'protein:N');
assert.equal(capturedHydrogenBondAvailability([appliedSequentialReplacement],
  cyclohexanoneAfter)[0].available, true);

// The medicinal-chemistry UI can legitimately complete the replacement ring
// before assigning its final carbonyl bond order. Preserve the entire new ring
// as the cumulative edit region: the last C-O -> C=O edit must still resolve
// against the original scaffold anchor, not the immediately adjacent carbon.
const cyclohexanolIntermediate = structuredClone(cyclohexanoneAfter);
cyclohexanolIntermediate.bonds.at(-1).order = 1;
const intermediateAddition = proposeLigandHydrogenBondFeatureRemaps([pyridoneDefinition],
  cyclohexanolIntermediate, cyclohexanolIntermediate.atoms.map((_, index) => index),
  { eligibleAtomIndices:[1,2,3,4,5,6,7], beforeMolecule:deletedPyridone })[0];
const retainedIntermediate = retainOriginatingHydrogenBondRemapCandidates(
  { ...deletionProposal, committedEditId:'delete-pyridone' }, intermediateAddition,
  cyclohexanolIntermediate, cyclohexanolIntermediate.atoms.map((_, index) => index));
assert.equal(retainedIntermediate.status, 'unique');
assert.equal(retainedIntermediate.candidates[0].matchKind, 'role-compatible-bioisostere');
assert.deepEqual(retainedIntermediate.boundaryAnchorIds, ['pyridone:core']);
assert.deepEqual(retainedIntermediate.cumulativeEditRegionAtomIds,
  cyclohexanolIntermediate.atoms.slice(1).map((atom) => atom.designAtomId).sort());
const finalCarbonylEdit = proposeLigandHydrogenBondFeatureRemaps([pyridoneDefinition],
  cyclohexanoneAfter, cyclohexanoneAfter.atoms.map((_, index) => index),
  { eligibleAtomIndices:[1,7], beforeMolecule:cyclohexanolIntermediate })[0];
assert.equal(finalCarbonylEdit.status, 'unavailable');
assert.deepEqual(finalCarbonylEdit.editEligibleFeatures.map((entry) => entry.atomIds),
  [['cyclohexanone:O']]);
assert.deepEqual(finalCarbonylEdit.editEligibleFeatures[0].boundaryAnchorIds,
  ['cyclohexanone:C2', 'cyclohexanone:C6']);
const multiCommitReplacement = retainOriginatingHydrogenBondRemapCandidates(
  { ...retainedIntermediate, committedEditId:'build-cyclohexanol',
    originatingCommittedEditId:'delete-pyridone' }, finalCarbonylEdit,
  cyclohexanoneAfter, cyclohexanoneAfter.atoms.map((_, index) => index));
assert.equal(multiCommitReplacement.status, 'unique');
assert.deepEqual(multiCommitReplacement.boundaryAnchorIds, ['pyridone:core']);
assert.deepEqual(multiCommitReplacement.candidates[0].atomIds, ['cyclohexanone:O']);
assert.deepEqual(multiCommitReplacement.candidates[0].boundaryAnchorIds, ['pyridone:core']);
assert.equal(multiCommitReplacement.candidates[0].matchKind, 'exact-feature');
assert.equal(multiCommitReplacement.originatingCommittedEditId, 'delete-pyridone');
// In real 7KPA, replacing the D84 pyridone preserves the O3 carbonyl-acceptor
// role used by Lys A11, but necessarily removes the N3-H donor used by water
// C307. Do not confuse this with the separate pyrrolidone O2 contact to Ser A60,
// and never reinterpret the new carbonyl oxygen as a donor.
const pyridoneDonorBefore = structuredClone(pyridoneBefore);
pyridoneDonorBefore.atoms.push(
  { element:'H', designAtomId:'pyridone:N-H', x:.35,y:2.05,z:0 });
pyridoneDonorBefore.bonds.push({ a:2,b:pyridoneDonorBefore.atoms.length - 1,order:1 });
const pyridoneDonorSignature = hydrogenBondFeatureSignature(pyridoneDonorBefore, 2, 'donor');
assert.match(pyridoneDonorSignature, /nitrogen donor/);
const pyridoneWaterDefinition = {
  id:'pyridone-donor-to-water', label:'pyridone N-H → water O', required:true,
  receptorRole:'acceptor',
  donor:{ scope:'ligand', designAtomId:'pyridone:N2', element:'N',
    featureSignature:pyridoneDonorSignature, referencePoint:{ x:.7,y:1.2,z:0 } },
  hydrogen:{ scope:'ligand', designAtomId:'pyridone:N-H', element:'H',
    referencePoint:{ x:.35,y:2.05,z:0 } },
  acceptor:{ scope:'receptor', designAtomId:'water:O', element:'O', point:{ x:0,y:3.8,z:0 } },
};
const lostPyridoneDonor = proposeLigandHydrogenBondFeatureRemaps(
  [pyridoneWaterDefinition], cyclohexanoneAfter,
  cyclohexanoneAfter.atoms.map((_, index) => index),
  { eligibleAtomIndices:[1,2,3,4,5,6,7], beforeMolecule:pyridoneDonorBefore })[0];
assert.equal(lostPyridoneDonor.ligandRole, 'donor');
assert.equal(lostPyridoneDonor.status, 'unavailable');
assert.deepEqual(lostPyridoneDonor.candidates, []);
assert.equal(capturedHydrogenBondAvailability([pyridoneWaterDefinition],
  cyclohexanoneAfter)[0].available, false);
const twoCorePyridoneBefore = structuredClone(pyridoneBefore);
twoCorePyridoneBefore.atoms.push(
  { element:'C', designAtomId:'unrelated:core', x:8,y:0,z:0 });
const twoCoreDeletedPyridone = { atoms:[
  structuredClone(twoCorePyridoneBefore.atoms[0]),
  structuredClone(twoCorePyridoneBefore.atoms[8]),
], bonds:[] };
const twoCoreDeletionProposal = proposeLigandHydrogenBondFeatureRemaps(
  [pyridoneDefinition], twoCoreDeletedPyridone, [0,1],
  { eligibleAtomIndices:[], beforeMolecule:twoCorePyridoneBefore })[0];
const wrongBoundaryCarbonyl = { atoms:[
  ...structuredClone(twoCoreDeletedPyridone.atoms),
  { element:'C', designAtomId:'unrelated:carbonyl', x:6.6,y:0,z:0 },
  { element:'O', designAtomId:'unrelated:oxygen', x:5.4,y:0,z:0 },
], bonds:[{ a:1,b:2,order:1 }, { a:2,b:3,order:2 }] };
const wrongBoundaryAddition = proposeLigandHydrogenBondFeatureRemaps(
  [pyridoneDefinition], wrongBoundaryCarbonyl, [0,1,2,3],
  { eligibleAtomIndices:[2,3], beforeMolecule:twoCoreDeletedPyridone })[0];
const rejectedSequentialReplacement = retainOriginatingHydrogenBondRemapCandidates(
  twoCoreDeletionProposal, wrongBoundaryAddition, wrongBoundaryCarbonyl, [0,1,2,3]);
assert.deepEqual(twoCoreDeletionProposal.boundaryAnchorIds, ['pyridone:core']);
assert.deepEqual(wrongBoundaryAddition.editEligibleFeatures[0].boundaryAnchorIds,
  ['unrelated:core']);
assert.equal(rejectedSequentialReplacement.status, 'unavailable');
assert.deepEqual(rejectedSequentialReplacement.cumulativeEditRegionAtomIds, []);
const twoCyclohexanonesAfter = structuredClone(cyclohexanoneAfter);
twoCyclohexanonesAfter.atoms.push(
  { element:'C', designAtomId:'cyclohexanone-2:C1', x:-.2,y:2.8,z:0 },
  { element:'O', designAtomId:'cyclohexanone-2:O', x:.8,y:3.5,z:0 });
twoCyclohexanonesAfter.bonds.push({ a:0,b:8,order:1 }, { a:8,b:9,order:2 });
const ambiguousSequentialAddition = proposeLigandHydrogenBondFeatureRemaps(
  [pyridoneDefinition], twoCyclohexanonesAfter,
  twoCyclohexanonesAfter.atoms.map((_, index) => index),
  { eligibleAtomIndices:[1,2,3,4,5,6,7,8,9], beforeMolecule:deletedPyridone })[0];
const ambiguousSequentialReplacement = retainOriginatingHydrogenBondRemapCandidates(
  { ...deletionProposal, committedEditId:'delete-pyridone' }, ambiguousSequentialAddition,
  twoCyclohexanonesAfter, twoCyclohexanonesAfter.atoms.map((_, index) => index));
assert.equal(ambiguousSequentialReplacement.status, 'ambiguous');
assert.deepEqual(ambiguousSequentialReplacement.candidates.map((entry) => entry.atomIds), [
  ['cyclohexanone-2:O'], ['cyclohexanone:O'],
]);

// Retained ambiguity is not a permanent entitlement. If one candidate is
// deleted and the other is detached from the originating scaffold, neither can
// become a unique match by carrying its old cached boundary forward.
const detachedOnlyCandidate = structuredClone(cyclohexanoneAfter);
detachedOnlyCandidate.atoms.push(
  { element:'C', designAtomId:'detached:core', x:8,y:0,z:0 });
detachedOnlyCandidate.bonds = detachedOnlyCandidate.bonds.map((bond) =>
  bond.a === 0 && bond.b === 4 ? { ...bond, a:8 } : bond);
const detachedFollowup = proposeLigandHydrogenBondFeatureRemaps([pyridoneDefinition],
  detachedOnlyCandidate, detachedOnlyCandidate.atoms.map((_, index) => index),
  { eligibleAtomIndices:detachedOnlyCandidate.atoms.map((_, index) => index),
    beforeMolecule:twoCyclohexanonesAfter })[0];
const rejectedDetachedCandidate = retainOriginatingHydrogenBondRemapCandidates(
  ambiguousSequentialReplacement, detachedFollowup, detachedOnlyCandidate,
  detachedOnlyCandidate.atoms.map((_, index) => index));
assert.equal(rejectedDetachedCandidate.status, 'unavailable');
assert.deepEqual(rejectedDetachedCandidate.candidates, []);
assert.deepEqual(rejectedDetachedCandidate.cumulativeEditRegionAtomIds, []);

// Deleting the originating anchor invalidates the lineage even when an exact
// candidate feature and all of its atom IDs remain live.
const missingOriginBoundary = { atoms:structuredClone(cyclohexanoneAfter.atoms.slice(1)),
  bonds:cyclohexanoneAfter.bonds.flatMap((bond) => bond.a === 0 || bond.b === 0
    ? [] : [{ ...bond, a:bond.a - 1, b:bond.b - 1 }]) };
const missingBoundaryFollowup = proposeLigandHydrogenBondFeatureRemaps([pyridoneDefinition],
  missingOriginBoundary, missingOriginBoundary.atoms.map((_, index) => index),
  { eligibleAtomIndices:missingOriginBoundary.atoms.map((_, index) => index),
    beforeMolecule:twoCyclohexanonesAfter })[0];
const rejectedMissingBoundary = retainOriginatingHydrogenBondRemapCandidates(
  ambiguousSequentialReplacement, missingBoundaryFollowup, missingOriginBoundary,
  missingOriginBoundary.atoms.map((_, index) => index));
assert.equal(rejectedMissingBoundary.status, 'unavailable');
assert.deepEqual(rejectedMissingBoundary.candidates, []);
assert.deepEqual(rejectedMissingBoundary.cumulativeEditRegionAtomIds, []);

const ambiguousRemapMolecule = structuredClone(remapAfter);
ambiguousRemapMolecule.atoms.push(
  { element:'C', designAtomId:'new:carbonyl-2', x:2.8, y:-1.4, z:0 },
  { element:'O', designAtomId:'new:oxygen-2', x:4.0, y:-1.4, z:0 });
ambiguousRemapMolecule.bonds.push({ a:1,b:5,order:1 }, { a:5,b:6,order:2 });
const ambiguousRemap = proposeLigandHydrogenBondFeatureRemaps([remapDefinition],
  ambiguousRemapMolecule, [0,1,2,3,4,5,6],
  { eligibleAtomIndices:[3,4,5,6], beforeMolecule:remapBefore })[0];
assert.equal(ambiguousRemap.status, 'ambiguous');
assert.equal(ambiguousRemap.candidates.length, 2);
const laterRemovalProposal = proposeLigandHydrogenBondFeatureRemaps([remapDefinition],
  remapAfter, [0,1,2,3,4],
  { eligibleAtomIndices:[], beforeMolecule:ambiguousRemapMolecule })[0];
assert.equal(laterRemovalProposal.status, 'unavailable');
const resolvedOriginatingProposal = retainOriginatingHydrogenBondRemapCandidates(
  { ...ambiguousRemap, committedEditId:'edit-ambiguous' }, laterRemovalProposal,
  remapAfter, [0,1,2,3,4]);
assert.equal(resolvedOriginatingProposal.status, 'unique');
assert.deepEqual(resolvedOriginatingProposal.candidates[0].atomIds, ['new:oxygen']);
assert.equal(resolvedOriginatingProposal.originatingCommittedEditId, 'edit-ambiguous');

const incompatibleRemapMolecule = structuredClone(remapAfter);
incompatibleRemapMolecule.bonds.find((bond) => bond.a === 3 && bond.b === 4).order = 1;
const incompatibleRemap = proposeLigandHydrogenBondFeatureRemaps([remapDefinition],
  incompatibleRemapMolecule, [0,1,2,3,4],
  { eligibleAtomIndices:[3,4], beforeMolecule:remapBefore })[0];
assert.equal(incompatibleRemap.status, 'unique');
assert.equal(incompatibleRemap.candidates[0].matchKind, 'role-compatible-bioisostere');

const donorBefore = { atoms:[
  { element:'C', designAtomId:'donor:core', x:0,y:0,z:0 },
  { element:'N', designAtomId:'donor:old:N', x:1.4,y:0,z:0 },
  { element:'H', designAtomId:'donor:old:H', x:2.3,y:0,z:0 },
], bonds:[{ a:0,b:1,order:1 }, { a:1,b:2,order:1 }] };
const donorSignature = hydrogenBondFeatureSignature(donorBefore, 1, 'donor');
const donorDefinition = { id:'captured-donor', receptorRole:'acceptor',
  donor:{ scope:'ligand', designAtomId:'donor:old:N', element:'N',
    featureSignature:donorSignature, referencePoint:{ x:1.4,y:0,z:0 } },
  hydrogen:{ scope:'ligand', designAtomId:'donor:old:H', element:'H',
    referencePoint:{ x:2.3,y:0,z:0 } },
  acceptor:{ scope:'receptor', designAtomId:'protein:O', element:'O', point:{ x:4,y:0,z:0 } } };
const donorAfter = { atoms:[
  structuredClone(donorBefore.atoms[0]),
  { element:'N', designAtomId:'donor:new:N', x:1.4,y:.2,z:0 },
  { element:'H', designAtomId:'donor:new:H', x:2.3,y:.2,z:0 },
], bonds:[{ a:0,b:1,order:1 }, { a:1,b:2,order:1 }] };
const donorRemap = proposeLigandHydrogenBondFeatureRemaps([donorDefinition], donorAfter,
  [0,1,2], { eligibleAtomIndices:[1,2], beforeMolecule:donorBefore })[0];
assert.equal(donorRemap.status, 'unique');
const appliedDonorRemap = applyLigandHydrogenBondFeatureRemap(donorDefinition,
  donorRemap.candidates[0]);
assert.equal(appliedDonorRemap.donor.designAtomId, 'donor:new:N');
assert.equal(appliedDonorRemap.hydrogen.designAtomId, 'donor:new:H');
assert.equal('referencePoint' in appliedDonorRemap.hydrogen, false);
assert.equal(capturedHydrogenBondAvailability([appliedDonorRemap], donorAfter)[0].available, true);

const survivingDonorAfter = { atoms:[
  structuredClone(donorBefore.atoms[0]), structuredClone(donorBefore.atoms[1]),
  { element:'H', designAtomId:'donor:replacement:H', x:2.25,y:.1,z:0 },
], bonds:[{ a:0,b:1,order:1 }, { a:1,b:2,order:1 }] };
const survivingDonorRemap = proposeLigandHydrogenBondFeatureRemaps([donorDefinition],
  survivingDonorAfter, [0,1,2],
  { eligibleAtomIndices:[2], beforeMolecule:donorBefore })[0];
assert.equal(survivingDonorRemap.status, 'unique');
assert.deepEqual(survivingDonorRemap.boundaryAnchorIds, ['donor:old:N']);
assert.deepEqual(survivingDonorRemap.candidates[0].atomIds,
  ['donor:old:N', 'donor:replacement:H']);
const appliedSurvivingDonorRemap = applyLigandHydrogenBondFeatureRemap(donorDefinition,
  survivingDonorRemap.candidates[0]);
assert.equal(appliedSurvivingDonorRemap.donor.designAtomId, 'donor:old:N');
assert.equal(appliedSurvivingDonorRemap.hydrogen.designAtomId, 'donor:replacement:H');
assert.equal('referencePoint' in appliedSurvivingDonorRemap.hydrogen, false);

const changedStableDonorAfter = { atoms:[
  structuredClone(donorBefore.atoms[0]),
  { ...structuredClone(donorBefore.atoms[1]), element:'O' },
  { element:'H', designAtomId:'donor:replacement:OH', x:2.25,y:.1,z:0 },
], bonds:[{ a:0,b:1,order:1 }, { a:1,b:2,order:1 }] };
const changedStableDonorRemap = proposeLigandHydrogenBondFeatureRemaps([donorDefinition],
  changedStableDonorAfter, [0,1,2],
  { eligibleAtomIndices:[1,2], beforeMolecule:donorBefore })[0];
assert.equal(changedStableDonorRemap.status, 'unique');
assert.deepEqual(changedStableDonorRemap.boundaryAnchorIds, ['donor:core']);
assert.deepEqual(changedStableDonorRemap.candidates[0].boundaryAnchorIds, ['donor:core']);
assert.deepEqual(changedStableDonorRemap.candidates[0].atomIds,
  ['donor:old:N', 'donor:replacement:OH']);
assert.equal(changedStableDonorRemap.candidates[0].matchKind,
  'role-compatible-bioisostere');

const detachedStableDonorAfter = { atoms:[
  structuredClone(donorBefore.atoms[0]),
  { element:'C', designAtomId:'donor:unrelated-core', x:5,y:0,z:0 },
  { ...structuredClone(donorBefore.atoms[1]), element:'O', x:6.4 },
  { element:'H', designAtomId:'donor:detached:OH', x:7.3,y:0,z:0 },
], bonds:[{ a:1,b:2,order:1 }, { a:2,b:3,order:1 }] };
const detachedStableDonorRemap = proposeLigandHydrogenBondFeatureRemaps([donorDefinition],
  detachedStableDonorAfter, [0,1,2,3],
  { eligibleAtomIndices:[1,2,3], beforeMolecule:donorBefore })[0];
assert.equal(detachedStableDonorRemap.status, 'unavailable');
assert.deepEqual(detachedStableDonorRemap.candidates, []);

const twoHydrogenDonorAfter = { atoms:[
  structuredClone(donorBefore.atoms[0]), structuredClone(donorBefore.atoms[1]),
  { element:'H', designAtomId:'donor:replacement:H1', x:2.25,y:.1,z:0 },
  { element:'H', designAtomId:'donor:replacement:H2', x:1.4,y:1,z:0 },
], bonds:[{ a:0,b:1,order:1 }, { a:1,b:2,order:1 }, { a:1,b:3,order:1 }] };
const twoHydrogenDonorRemap = proposeLigandHydrogenBondFeatureRemaps([donorDefinition],
  twoHydrogenDonorAfter, [0,1,2,3],
  { eligibleAtomIndices:[2,3], beforeMolecule:donorBefore })[0];
assert.equal(twoHydrogenDonorRemap.status, 'ambiguous');
assert.deepEqual(twoHydrogenDonorRemap.candidates.map((entry) => entry.atomIds), [
  ['donor:old:N', 'donor:replacement:H1'],
  ['donor:old:N', 'donor:replacement:H2'],
]);

const torsionMolecule = { name:'fixed-core rotor test', atoms:[
  { element:'C' }, { element:'C' }, { element:'C' },
  { element:'C' }, { element:'C' }, { element:'F' },
], bonds:[
  { a:0, b:1, order:1 }, { a:1, b:2, order:1 }, { a:2, b:0, order:1 },
  { a:1, b:3, order:1 }, { a:3, b:4, order:1 }, { a:4, b:5, order:1 },
] };
const torsionStart = Float64Array.from([
  0,0,0, 1,0,0, 0,1,0, 2,0,0, 2,1,0, 2,2,0,
]);
const featureSeedMolecule = { atoms:[{ element:'C' }, { element:'N' }, { element:'C' }],
  bonds:[{ a:0, b:1, order:1 }, { a:1, b:2, order:1 }] };
const featureSeedStart = Float64Array.from([0,0,0, 1,0,0, 1,1,0]);
const featureSeeds = featureGuidedPoseSeeds({ molecule:featureSeedMolecule,
  initialPositions:featureSeedStart, coreAtomIndices:[0], count:7,
  hydrogenBondConstraints:[{ id:'replacement-acceptor', receptorRole:'donor',
    donor:{ scope:'receptor', point:{ x:0,y:3,z:0 } },
    hydrogen:{ scope:'receptor', point:{ x:0,y:2,z:0 } },
    acceptor:{ scope:'ligand', atomIndex:1 },
    targetLigandFeatureReferencePoint:{ x:0,y:1.2,z:0 } }] });
assert.equal(featureSeeds.method, 'molarium-edit-region-axis-seeding/v4');
assert.equal(featureSeeds.requestedCount, 7);
assert.equal(featureSeeds.uniqueSeedCount, 7);
assert.equal(featureSeeds.untargetedRotorCount, 0,
  'a region already covered by a captured feature is not redundantly scanned');
assert.deepEqual(Array.from(featureSeeds.seeds[0].positions), Array.from(featureSeedStart));
assert.ok(Math.abs(featureSeeds.seeds[1].positions[3]) < 1e-12
  && Math.abs(featureSeeds.seeds[1].positions[4] - 1) < 1e-12,
'feature seed aligns the replacement direction while preserving its bond length');
assert.deepEqual(Array.from(featureSeeds.seeds[1].positions.slice(0, 3)), [0,0,0]);
assert.ok(Math.abs(Math.hypot(...Array.from(featureSeeds.seeds[1].positions.slice(3, 6))) - 1) < 1e-12);
const multiAnchorSeeds = featureGuidedPoseSeeds({ molecule:{
  atoms:[{ element:'C' }, { element:'N' }, { element:'C' }],
  bonds:[{ a:0,b:1,order:1 }, { a:1,b:2,order:1 }] },
initialPositions:featureSeedStart, coreAtomIndices:[0,2], count:3,
hydrogenBondConstraints:[{ id:'ring-feature', receptorRole:'donor',
  acceptor:{ scope:'ligand', atomIndex:1 },
  targetLigandFeatureReferencePoint:{ x:0,y:1,z:0 } }] });
assert.equal(multiAnchorSeeds.uniqueSeedCount, 1,
  'multi-anchor edits are not distorted by the single-anchor feature seeder');
const untargetedSeeds = featureGuidedPoseSeeds({ molecule:{
  atoms:[{ element:'C' }, { element:'C' }, { element:'C' }, { element:'O' }],
  bonds:[{ a:0,b:1,order:1 }, { a:1,b:2,order:1 }, { a:2,b:3,order:1 }] },
initialPositions:Float64Array.from([0,0,0, 1,0,0, 1,1,0, 1,2,0]),
coreAtomIndices:[0], count:6, hydrogenBondConstraints:[] });
assert.equal(untargetedSeeds.uniqueSeedCount, 12);
assert.equal(untargetedSeeds.untargetedRotorCount, 1);
assert.equal(untargetedSeeds.seeds[1].audit.method, 'untargeted-edit-region-torsion-scan');
assert.deepEqual(Array.from(untargetedSeeds.seeds[1].positions.slice(0, 6)),
  [0,0,0, 1,0,0], 'the fixed core and attachment atom remain exact');
assert.ok(Math.abs(untargetedSeeds.seeds[1].positions[7] - Math.sqrt(3) / 2) < 1e-12
  && Math.abs(Math.abs(untargetedSeeds.seeds[1].positions[8]) - 0.5) < 1e-12,
  'an untargeted grown region is seeded around its core-boundary bond');
const conservedJunctionRingSeeds = featureGuidedPoseSeeds({ molecule:{
  atoms:[{ element:'C' }, { element:'C' }, { element:'C' }, { element:'C' },
    { element:'C' }],
  bonds:[{ a:0,b:1,order:1 }, { a:1,b:2,order:1 }, { a:2,b:3,order:1 },
    { a:3,b:4,order:1 }, { a:4,b:1,order:1 }] },
initialPositions:Float64Array.from([-1,0,0, 0,0,0, 0,1,0, 1,1,0, 1,0,0]),
coreAtomIndices:[0,1], count:6, hydrogenBondConstraints:[] });
assert.equal(conservedJunctionRingSeeds.uniqueSeedCount, 12);
assert.equal(conservedJunctionRingSeeds.untargetedRotorCount, 1);
assert.equal(conservedJunctionRingSeeds.seeds[1].audit.attachmentMode,
  'conserved-junction-ring-axis');
assert.deepEqual(Array.from(conservedJunctionRingSeeds.seeds[1].positions.slice(0, 6)),
  [-1,0,0, 0,0,0], 'the scaffold and conserved junction atom remain exact');
assert.ok(Math.abs(conservedJunctionRingSeeds.seeds[1].positions[7]
    - Math.sqrt(3) / 2) < 1e-12
  && Math.abs(Math.abs(conservedJunctionRingSeeds.seeds[1].positions[8])
    - 0.5) < 1e-12,
  'a ring grown around a conserved junction scans the external scaffold bond');
const attachedSingle = attachNonCoreRegionsToSnappedCore({
  molecule:{ atoms:[{ element:'C' }, { element:'N' }, { element:'H' }],
    bonds:[{ a:0, b:1, order:3 }, { a:1, b:2, order:1 }] },
  alignedPositions:new Float64Array([10, 0, 0, 11.2, 0, 0, 12.0, 0, 0]),
  referencePositions:new Float64Array([1, 2, 3]), coreAtomPairs:[[0, 0]],
});
assert.ok(Array.from(attachedSingle.positions).every((value, index) =>
  Math.abs(value - [1, 2, 3, 2.2, 2, 3, 3, 2, 3][index]) < 1e-12));
assert.equal(attachedSingle.regions[0].method, 'single-anchor-translation');
assert.ok(Math.abs(Math.hypot(...[0, 1, 2].map((axis) =>
  attachedSingle.positions[3 + axis] - attachedSingle.positions[axis])) - 1.2) < 1e-12);
const attachedDouble = attachNonCoreRegionsToSnappedCore({
  molecule:{ atoms:[{ element:'C' }, { element:'C' }, { element:'N' }, { element:'O' }],
    bonds:[{ a:0, b:2, order:1 }, { a:2, b:3, order:1 }, { a:3, b:1, order:1 }] },
  alignedPositions:new Float64Array([10, 0, 0, 12, 0, 0, 10, 1, 0, 12, 1, 0]),
  referencePositions:new Float64Array([0, 0, 0, 0, 2, 0]),
  coreAtomPairs:[[0, 0], [1, 1]],
});
assert.equal(attachedDouble.regions[0].method, 'two-anchor-rigid-axis-fit');
assert.ok(Math.abs(Math.hypot(...[0, 1, 2].map((axis) =>
  attachedDouble.positions[6 + axis] - attachedDouble.positions[axis])) - 1) < 1e-12);
const freeRotors = identifyFreeRotors(torsionMolecule, [0, 1, 2]);
assert.deepEqual(freeRotors.map((entry) => entry.bondAtomIndices), [[1, 3], [3, 4]]);
assert.ok(freeRotors.every((entry) => entry.movingAtomIndices.every((atom) => ![0, 1, 2].includes(atom))));
const quarterTurn = rotateAroundBond(torsionStart, freeRotors[0], Math.PI / 2);
assert.ok(Math.abs(quarterTurn[4 * 3 + 2] - 1) < 1e-12);
const torsionScore = (positions) => ({ objectiveKcalMol:(positions[4 * 3 + 2] - 1) ** 2,
  feasible:positions[4 * 3 + 2] > 0.8 });
const torsionSearchOptions = { molecule:torsionMolecule, initialPositions:torsionStart,
  coreAtomIndices:[0, 1, 2], scorePose:torsionScore, steps:32,
  temperatureStartKelvin:600, temperatureEndKelvin:100,
  proposalAnglesDegrees:[90], seed:77 };
const torsionRun = await refinePoseByTorsionMonteCarlo({ ...torsionSearchOptions, random:mulberry32(77) });
const torsionReplay = await refinePoseByTorsionMonteCarlo({ ...torsionSearchOptions, random:mulberry32(77) });
assert.deepEqual(torsionRun.positions, torsionReplay.positions);
assert.equal(torsionRun.selectedFeasible, true);
assert.ok(torsionRun.bestObjectiveKcalMol < torsionRun.startObjectiveKcalMol);
for (const atom of [0, 1, 2]) for (let axis = 0; axis < 3; axis++)
  assert.equal(torsionRun.positions[atom * 3 + axis], torsionStart[atom * 3 + axis]);
const retainedFeasible = await refinePoseByTorsionMonteCarlo({ ...torsionSearchOptions,
  initialPositions:quarterTurn, random:() => 0, steps:1, proposalAnglesDegrees:[90] });
assert.equal(retainedFeasible.accepted, 0);
assert.equal(retainedFeasible.selectedFeasible, true);
assert.deepEqual(retainedFeasible.positions, quarterTurn);
const ringOnly = identifyFreeRotors({ atoms:torsionMolecule.atoms.slice(0, 3),
  bonds:torsionMolecule.bonds.slice(0, 3) }, [0, 1, 2]);
assert.deepEqual(ringOnly, []);
const amide = { atoms:[{ element:'C' }, { element:'N' }, { element:'O' }, { element:'C' }],
  bonds:[{ a:0, b:1, order:1 }, { a:0, b:2, order:2 }, { a:1, b:3, order:1 }] };
assert.ok(identifyFreeRotors(amide, [2]).every((entry) => !entry.bondAtomIndices.includes(0)
  || !entry.bondAtomIndices.includes(1)));
const rigidRun = await refinePoseByTorsionMonteCarlo({ molecule:{ atoms:[{ element:'C' },
  { element:'C' }], bonds:[{ a:0, b:1, order:1 }] }, initialPositions:[0,0,0, 1,0,0],
  coreAtomIndices:[0], scorePose:() => 0, steps:10, random:mulberry32(1), seed:1 });
assert.equal(rigidRun.proposals, 0);
assert.deepEqual(Array.from(rigidRun.positions), [0,0,0, 1,0,0]);

const energyMolecule = { atoms:[{ element:'C', x:0, y:0, z:0 },
  { element:'C', x:1.6, y:0, z:0 }], bonds:[{ a:0, b:1, order:1 }] };
const energyParameters = { forcefield:'OpenFF Sage test', chargeModel:'test', sourceSha256:'test', system:{
  particles:[{ index:0, mass_amu:12 }, { index:1, mass_amu:12 }], constraints:[],
  bonds:[{ i:0, j:1, k_kj_nm2:1000, r0_nm:0.15 }], angles:[], torsions:[],
  nonbonded:[{ index:0, sigma_nm:0.34, epsilon_kj:0.4, charge_e:0 },
    { index:1, sigma_nm:0.34, epsilon_kj:0.4, charge_e:0 }],
  exceptions:[{ i:0, j:1, sigma_nm:0.1, epsilon_kj:0, chargeprod_e2:0 }],
} };
const energyTopology = buildParameterizedSystem(energyMolecule, energyParameters);
const energyPositions4 = packPositions4(Float64Array.from([0,0,0, 1.6,0,0]));
const energyComponents = cpuEnergies(energyTopology, energyPositions4);
assert.ok(Math.abs(energyComponents.total - energyComponents.bond) < 1e-12);
assert.ok(energyComponents.bond > 0);
const stack = Float32Array.from([...Array(12).keys(), ...Array(12).keys()].map(Number));
assert.deepEqual(unpackConformerStack(stack, 4).map((entry) => entry.length), [12, 12]);
const moved = structuredClone(complex);
applyLigandPositions(moved, ligandGlobals, Float64Array.from([
  10, 0, 0, 11, 0, 0, 12, 0, 0, 13, 0, 0,
]));
assert.equal(moved.atoms[3].x, 10);
assert.equal(moved.atoms[6].x, 13);
assert.equal(moved.atoms[0].x, -2);
assert.match(dockingInputText(complex, ligandGlobals), /adapter-test:HETATM/);
const ligandTopology = dockingTopologyText(complex, ligandGlobals);
assert.equal(dockingTopologyText(moved, ligandGlobals), ligandTopology);
const changedTopology = structuredClone(complex); changedTopology.atoms[3].element = 'S';
assert.notEqual(dockingTopologyText(changedTopology, ligandGlobals), ligandTopology);

const editedFiveAtomConformer = Float64Array.from([
  4, -2, 3, 5, -2, 3, 4, -1, 3, 6.8, -2, 3, 7.5, -2, 3,
]);
const editedAtomCountRun = await runConstrainedDocking({
  referencePositions:captured.positions,
  candidateConformers:[editedFiveAtomConformer],
  coreAtomPairs:mappedCore.atomPairs,
  protocol:MOLARIUM_CONSTRAINT_DOCK_PROTOCOL,
  physicalScore:() => -1,
});
assert.equal(editedAtomCountRun.selected.positions.length, 15);
await assert.rejects(() => runConstrainedDocking({
  referencePositions:captured.positions,
  candidateConformers:[editedFiveAtomConformer, Float64Array.from([0, 0, 0])],
  coreAtomPairs:mappedCore.atomPairs,
  protocol:MOLARIUM_CONSTRAINT_DOCK_PROTOCOL,
  physicalScore:() => -1,
}), /must contain 15 finite coordinates/);
await assert.rejects(() => runConstrainedDocking({
  referencePositions:captured.positions, candidateConformers:[],
  coreAtomPairs:mappedCore.atomPairs, protocol:MOLARIUM_CONSTRAINT_DOCK_PROTOCOL, physicalScore:() => -1,
}), /At least one candidate/);
const incompleteSystem = structuredClone(siteMolecule.parameterization.system);
incompleteSystem.nonbonded[1].index = 0;
assert.throws(() => buildReceptorSite(siteMolecule, [3], incompleteSystem), /no nonbonded term for atom 1/);

console.log('Molarium ConstraintDock-1 constraints and labbook: PASS');
