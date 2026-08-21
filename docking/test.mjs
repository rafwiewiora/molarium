import assert from 'node:assert/strict';
import { MOLARIUM_CONSTRAINT_DOCK_PROTOCOL, MOLARIUM_POSE_PROPAGATION_PROTOCOL } from './protocol.mjs';
import { applyCoreTransform, evaluateCoreConstraint, evaluateHydrogenBondConstraint,
  fittedCoreTransform, hydrogenBondGeometry, rankConstrainedPoses, scoreConstrainedPose,
  snapCorePositions } from './constraints.mjs';
import { appendLabbookEvent, completeLabbook, createLabbook, inputProvenance,
  renderLabbookMarkdown, verifyLabbook } from './labbook.mjs';
import { captureReferenceLigand, ensureStableAtomIds, mapReferenceCore,
  mapSurvivingReferenceAtoms } from './reference-core.mjs';
import { runConstrainedDocking } from './workflow.mjs';
import { buildReceptorSite, pairInteractionKcalMol, receptorSiteIntegrity,
  scoreReceptorLigand } from './receptor-score.mjs';
import { applyLigandPositions, captureCrossHydrogenBonds, createLigandPlan, dockingInputText,
  capturedHydrogenBondAvailability, dockingTopologyText, mapCapturedHydrogenBonds,
  unpackConformerStack } from './browser-adapter.mjs';
import { identifyFreeRotors, packPositions4, refinePoseByTorsionMonteCarlo,
  rotateAroundBond } from './torsion-search.mjs';
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

const feasible = scoreConstrainedPose({ physicalEnergyKcalMol:-10, core,
  hydrogenBonds:[{ ...goodHbond, required:true }] });
const infeasible = scoreConstrainedPose({ physicalEnergyKcalMol:-100, core,
  hydrogenBonds:[{ ...badHbond, required:true }] });
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
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.id, 'molarium-pose-propagation-1');
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.version, '0.2.0');
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.coordinateMapping.minimumSurvivingHeavyAtoms, 3);
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.coordinateMapping
  .minimumMaximumTriangleDoubleAreaAngstrom2, 1e-3);
assert.deepEqual(MOLARIUM_POSE_PROPAGATION_PROTOCOL.torsionMonteCarlo.proposalAnglesDegrees,
  [-180, -120, -90, -60, -30, -15, 15, 30, 60, 90, 120, 180]);
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.torsionMonteCarlo.metropolisBoltzmannKcalMolKelvin,
  0.00198720425864083);
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.fixedScaffoldRelaxation.stepScale, 1e-4);
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.fixedScaffoldRelaxation
  .maximumDisplacementAngstromPerIteration, 0.01);
assert.equal(MOLARIUM_POSE_PROPAGATION_PROTOCOL.scoring.coulombConstantKcalAngstromPerMolE2,
  332.063713299);
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
  labbook:workflowLabbook,
  startedAt:'2026-08-19T12:00:03.000Z', completedAt:'2026-08-19T12:00:04.000Z',
});
assert.equal(dockingRun.feasibleCount, 1);
assert.equal(dockingRun.selected.conformerIndex, 1);
assert.equal(dockingRun.selected.feasible, true);
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
