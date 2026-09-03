import assert from 'node:assert/strict';
import { evaluateHydrogenBondConstraint } from './constraints.mjs';
import { applyInternalCoordinateMove, identifyAcyclicTorsionMoves,
  identifyRingCrankshaftMoves, perceiveFlexibleRings,
  refinePoseByRestraintBiasedSearch, generatePoseByRestraintBiasedSearch,
  polishPoseByInternalCoordinateDescent,
  RESTRAINT_BIASED_SEARCH_DEFAULTS } from './restraint-biased-search.mjs';
import { mulberry32 } from '../stormm/core.mjs';

const close = (actual, expected, tolerance = 1e-10, message = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message} expected ${expected}, received ${actual}`);
const point = (positions, atom) => Array.from(positions.slice(atom * 3, atom * 3 + 3));
const distance = (positions, first, second) => Math.hypot(...[0, 1, 2].map((axis) =>
  positions[first * 3 + axis] - positions[second * 3 + axis]));

const ring = { name:'cyclohexyl-aldehyde restraint test', atoms:[
  { element:'C' }, { element:'C' }, { element:'C' },
  { element:'C' }, { element:'C' }, { element:'C' }, { element:'C' }, { element:'O' },
], bonds:[
  { a:0,b:1,order:1 }, { a:1,b:2,order:1 }, { a:2,b:3,order:1 },
  { a:3,b:4,order:1 }, { a:4,b:5,order:1 }, { a:5,b:0,order:1 },
  { a:1,b:6,order:1 }, { a:6,b:7,order:2 },
] };
const root3 = Math.sqrt(3);
const planar = new Float64Array([
  1,0,0, 0.5,root3/2,0, -0.5,root3/2,0,
  -1,0,0, -0.5,-root3/2,0, 0.5,-root3/2,0,
  1,1.7,0, 1.5,2.75,0,
]);

const perceived = perceiveFlexibleRings(ring);
assert.equal(perceived.length, 1);
assert.deepEqual(perceived[0].atomIndices, [0,1,2,3,4,5]);
assert.equal(perceived[0].flexible, true);

const aromatic = { atoms:Array.from({ length:6 }, () => ({ element:'C' })),
  bonds:Array.from({ length:6 }, (_, index) => ({ a:index, b:(index + 1) % 6,
    order:1.5, aromatic:true })) };
assert.equal(perceiveFlexibleRings(aromatic)[0].flexible, false);
assert.deepEqual(identifyRingCrankshaftMoves(aromatic), []);

for (const size of [4,5,6,7,8]) {
  const polygon = { atoms:Array.from({ length:size }, () => ({ element:'C' })), bonds:
    Array.from({ length:size }, (_, index) => ({ a:index, b:(index + 1) % size, order:1 })) };
  const polygonPositions = new Float64Array(polygon.atoms.flatMap((atom, index) => {
    return [Math.cos(2 * Math.PI * index / size), Math.sin(2 * Math.PI * index / size), 0];
  }));
  const moves = identifyRingCrankshaftMoves(polygon, [0]);
  assert.ok(moves.length > 0, `an isolated saturated ${size}-membered ring is sampled`);
  const moved = applyInternalCoordinateMove(polygonPositions, moves[0], Math.PI / 7);
  polygon.bonds.forEach((bond) => close(distance(moved, bond.a, bond.b),
    distance(polygonPositions, bond.a, bond.b), 2e-12,
    `${size}-membered ring move preserves every bond`));
  assert.deepEqual(point(moved, 0), point(polygonPositions, 0));
}

const fused = { atoms:Array.from({ length:10 }, () => ({ element:'C' })),
  bonds:[[0,1],[1,2],[2,3],[3,4],[4,5],[5,0],
    [2,6],[6,7],[7,8],[8,9],[9,3]].map(([a,b]) => ({ a,b,order:1 })) };
assert.equal(perceiveFlexibleRings(fused).length, 2);
assert.deepEqual(identifyRingCrankshaftMoves(fused, [0]), [],
  'fused rings are excluded until a concerted closure method is registered');

const spiro = { atoms:Array.from({ length:9 }, () => ({ element:'C' })),
  bonds:[[0,1],[1,2],[2,3],[3,0],[0,4],[4,5],[5,6],[6,0]]
    .map(([a,b]) => ({ a,b,order:1 })) };
assert.equal(perceiveFlexibleRings(spiro).length, 2);
assert.deepEqual(identifyRingCrankshaftMoves(spiro, [1]), [],
  'spiro rings are excluded from the isolated-ring move family');

const ringMoves = identifyRingCrankshaftMoves(ring, [0]);
assert.ok(ringMoves.length >= 4, 'a flexible six-membered ring exposes multiple crankshaft moves');
assert.ok(ringMoves.every((move) => !move.movingAtomIndices.includes(0)),
  'hard-core atoms never enter a ring move');
const carbonylMove = ringMoves.find((move) => move.movingAtomIndices.includes(7));
assert.ok(carbonylMove,
  'a safe ring-pucker move carries a pendant carbonyl as one rigid substituent');

for (const angle of [-60, -30, 15, 45, 60]) {
  const moved = applyInternalCoordinateMove(planar, carbonylMove, angle * Math.PI / 180);
  assert.deepEqual(point(moved, 0), point(planar, 0), 'hard-core coordinates remain bitwise exact');
  ring.bonds.forEach((bond, index) => close(distance(moved, bond.a, bond.b),
    distance(planar, bond.a, bond.b), 2e-12, `ring move preserves bond ${index + 1}`));
}

assert.deepEqual(identifyRingCrankshaftMoves(ring, [0,1,2,3,4,5]), [],
  'a completely fixed ring has no crankshaft degrees of freedom');

const cyclohexanone = { atoms:Array.from({ length:7 }, (_, index) =>
  ({ element:index === 6 ? 'O' : 'C' })), bonds:[
  ...Array.from({ length:6 }, (_, index) => ({ a:index, b:(index + 1) % 6, order:1 })),
  { a:1,b:6,order:2 },
] };
const cyclohexanoneMoves = identifyRingCrankshaftMoves(cyclohexanone);
assert.ok(cyclohexanoneMoves.every((move) => !move.axisAtomIndices.includes(1)
  && !move.movingAtomIndices.includes(1) && !move.movingAtomIndices.includes(6)),
  'a ring carbonyl and its trigonal geometry are never distorted by a crankshaft move');

const stereoRing = { atoms:[
  ...Array.from({ length:6 }, () => ({ element:'C' })), { element:'H' },
  { element:'C' }, { element:'F' },
], bonds:[
  ...Array.from({ length:6 }, (_, index) => ({ a:index,b:(index + 1) % 6,order:1 })),
  { a:1,b:6,order:1 }, { a:1,b:7,order:1 }, { a:3,b:8,order:1 },
] };
const stereoPositions = new Float64Array([
  1,0,0, 0.5,root3/2,0, -0.5,root3/2,0, -1,0,0,
  -0.5,-root3/2,0, 0.5,-root3/2,0, 0.5,root3/2,1,
  0.5,root3/2,-1, -2,0,0,
]);
const signedVolume = (positions, center, neighbors) => {
  const vectors = neighbors.slice(0, 3).map((atom) => point(positions, atom)
    .map((value, axis) => value - positions[center * 3 + axis]));
  const fourth = point(positions, neighbors[3]).map((value, axis) =>
    value - positions[center * 3 + axis]);
  const first = vectors[0].map((value, axis) => value - fourth[axis]);
  const second = vectors[1].map((value, axis) => value - fourth[axis]);
  const third = vectors[2].map((value, axis) => value - fourth[axis]);
  return first[0] * (second[1] * third[2] - second[2] * third[1])
    - first[1] * (second[0] * third[2] - second[2] * third[0])
    + first[2] * (second[0] * third[1] - second[1] * third[0]);
};
const stereoMoves = identifyRingCrankshaftMoves(stereoRing);
assert.ok(stereoMoves.length > 0, 'safe ring degrees of freedom remain available');
assert.ok(stereoMoves.every((move) => !move.axisAtomIndices.includes(1)
  && !move.movingAtomIndices.includes(1)), 'moves touching a perceived tetrahedral center are excluded');
for (const move of stereoMoves) {
  const moved = applyInternalCoordinateMove(stereoPositions, move, Math.PI / 3);
  close(signedVolume(moved, 1, [0,2,6,7]), signedVolume(stereoPositions, 1, [0,2,6,7]),
    1e-12, 'remaining ring moves preserve configured handedness');
}

const lactam = { atoms:[...Array.from({ length:6 }, (_, index) =>
  ({ element:index === 1 ? 'N' : 'C' })), { element:'O' }], bonds:[
  ...Array.from({ length:6 }, (_, index) => ({ a:index,b:(index + 1) % 6,order:1 })),
  { a:0,b:6,order:2 },
] };
const lactamMoves = identifyRingCrankshaftMoves(lactam);
assert.ok(lactamMoves.every((move) => ![0,1].some((atom) =>
  move.axisAtomIndices.includes(atom) || move.movingAtomIndices.includes(atom))),
  'lactam carbonyl and amide nitrogen remain outside the crankshaft move set');

const acyclic = { atoms:[{ element:'C' }, { element:'C' }, { element:'C' },
  { element:'O' }], bonds:[{ a:0,b:1,order:1 }, { a:1,b:2,order:1 },
    { a:2,b:3,order:1 }] };
const torsions = identifyAcyclicTorsionMoves(acyclic, [0]);
assert.ok(torsions.length >= 1);
assert.ok(torsions.every((move) => move.kind === 'acyclic-torsion'
  && move.movingAtomIndices.every((atom) => atom !== 0)));
const permutedAcyclic = { ...acyclic, bonds:[...acyclic.bonds].reverse()
  .map((bond) => ({ ...bond, a:bond.b, b:bond.a })) };
const normalizedMoves = (moves) => moves.map(({ bondIndex, ...move }) => move);
assert.deepEqual(normalizedMoves(identifyAcyclicTorsionMoves(permutedAcyclic, [0])),
  normalizedMoves(torsions), 'torsion enumeration is independent of bond serialization order');
const acyclicPositions = new Float64Array([0,0,0, 1,0,0, 1.7,0.8,0, 2.2,1,0.9]);
const replayAcyclic = async (molecule) => refinePoseByRestraintBiasedSearch({ molecule,
  initialPositions:acyclicPositions, coreAtomIndices:[0], random:mulberry32(501), seed:501,
  steps:12, torsionAnglesDegrees:[-60,60], ringCrankshaftAnglesDegrees:[-30,30],
  localLineFractions:[1], scorePose:(positions) => ({ objectiveKcalMol:
    (positions[11] - 1.5) ** 2 + positions[10] ** 2, feasible:false }) });
const orderedReplay = await replayAcyclic(acyclic);
const permutedReplay = await replayAcyclic(permutedAcyclic);
assert.deepEqual(orderedReplay.positions, permutedReplay.positions,
  'same graph, coordinates, and seed replay exactly after bond-array permutation');

const targetPositions = applyInternalCoordinateMove(planar, carbonylMove, 60 * Math.PI / 180);
const target = point(targetPositions, 7), initial = point(planar, 7);
const targetDirection = target.map((value, axis) => value - initial[axis]);
const targetDirectionLength = Math.hypot(...targetDirection);
assert.ok(targetDirectionLength > 0.8, 'test target requires a material ring-pucker displacement');
const unit = targetDirection.map((value) => value / targetDirectionLength);
const receptorHydrogen = target.map((value, axis) => value + unit[axis] * 1.8);
const receptorDonor = target.map((value, axis) => value + unit[axis] * 2.8);
const hbondSettings = { donorAcceptorDistanceAngstrom:[2.4,3.5],
  hydrogenAcceptorDistanceAngstrom:[1.2,2.7], minimumDhaAngleDegrees:120,
  weightKcalMol:120 };
const evaluateAcceptor = (positions) => evaluateHydrogenBondConstraint({
  donor:{ x:receptorDonor[0], y:receptorDonor[1], z:receptorDonor[2] },
  hydrogen:{ x:receptorHydrogen[0], y:receptorHydrogen[1], z:receptorHydrogen[2] },
  acceptor:{ x:positions[21], y:positions[22], z:positions[23] },
}, hbondSettings);
assert.equal(evaluateAcceptor(planar).satisfied, false);
assert.equal(evaluateAcceptor(targetPositions).satisfied, true);

const oneStep = await refinePoseByRestraintBiasedSearch({ molecule:ring,
  initialPositions:planar, coreAtomIndices:[0], proposalMoves:[carbonylMove],
  scorePose:(positions) => {
    const hbond = evaluateAcceptor(positions);
    return { objectiveKcalMol:hbond.penaltyKcalMol, feasible:hbond.satisfied,
      hydrogenBonds:[{ id:'required-ring-carbonyl', ...hbond }] };
  }, random:() => 0, seed:41, steps:1, ringCrankshaftAnglesDegrees:[60],
  torsionAnglesDegrees:[60], localLineFractions:[1] });
assert.equal(oneStep.method, RESTRAINT_BIASED_SEARCH_DEFAULTS.method);
assert.equal(oneStep.ringCrankshaftMoveCount, 1);
assert.equal(oneStep.rotatableBondCount, 0);
assert.equal(oneStep.lineEvaluations, 1);
assert.equal(oneStep.selectedFeasible, true,
  'the required contact participates in generation and discovers the ring pose');
assert.equal(evaluateAcceptor(oneStep.positions).satisfied, true);
assert.deepEqual(point(oneStep.positions, 0), point(planar, 0));
assert.equal(oneStep.bestEvaluation.hydrogenBonds[0].satisfied, true);
assert.equal(oneStep.startEvaluation.hydrogenBonds[0].satisfied, false);

let physicalCalls = 0;
const staged = await generatePoseByRestraintBiasedSearch({ molecule:ring,
  initialPositions:planar, coreAtomIndices:[0], proposalMoves:[carbonylMove],
  restraintScorePose:(positions) => {
    const hbond = evaluateAcceptor(positions);
    return { objectiveKcalMol:hbond.penaltyKcalMol,
      hbondPenaltyKcalMol:hbond.penaltyKcalMol,
      feasible:hbond.satisfied, hydrogenBonds:[{ id:'required-ring-carbonyl', ...hbond }] };
  },
  // Deliberately make the captured geometry physically expensive. A blended
  // one-stage objective would retain the planar missed contact; staged capture
  // must find it first and the hard feasibility transition must then retain it.
  physicalScorePose:(positions) => {
    physicalCalls++;
    const hbond = evaluateAcceptor(positions);
    const displacement = Math.hypot(...point(positions, 7).map((value, axis) =>
      value - initial[axis]));
    return { objectiveKcalMol:1000 * displacement ** 2 + hbond.penaltyKcalMol,
      feasible:hbond.satisfied, hydrogenBonds:[{ id:'required-ring-carbonyl', ...hbond }] };
  },
  random:() => 0, seed:99, captureSteps:1, refinementSteps:1,
  ringCrankshaftAnglesDegrees:[60], torsionAnglesDegrees:[60], localLineFractions:[1] });
assert.equal(staged.stageOutcome, 'captured-and-physically-refined');
assert.equal(staged.captureFeasible, true);
assert.equal(staged.physicalRefinementAttempted, true);
assert.ok(physicalCalls >= 2, 'physical refinement runs only after capture');
assert.equal(staged.selectedFeasible, true,
  'physical energy cannot pull a generated pose out of a required contact');
assert.equal(evaluateAcceptor(staged.positions).satisfied, true);
assert.equal(staged.capture.startEvaluation.hydrogenBonds[0].satisfied, false);
assert.equal(staged.capture.bestEvaluation.hydrogenBonds[0].satisfied, true);
assert.deepEqual(point(staged.positions, 0), point(planar, 0));
assert.equal(staged.objectiveStage, 'physical-refinement');
assert.equal(staged.startObjectiveKcalMol,
  staged.physicalRefinement.startEvaluation.objectiveKcalMol,
  'top-level start and best metrics belong to the same physical objective');
assert.equal(staged.bestObjectiveKcalMol,
  staged.physicalRefinement.bestEvaluation.objectiveKcalMol);

let zeroStepPhysicalCalls = 0;
const capturedWithoutPhysical = await generatePoseByRestraintBiasedSearch({ molecule:ring,
  initialPositions:planar, coreAtomIndices:[0], proposalMoves:[carbonylMove],
  restraintScorePose:(positions) => {
    const hbond = evaluateAcceptor(positions);
    return { objectiveKcalMol:hbond.penaltyKcalMol, feasible:hbond.satisfied,
      hydrogenBonds:[hbond] };
  }, physicalScorePose:() => { zeroStepPhysicalCalls++; return 0; },
  random:() => 0, captureSteps:1, capturePolishSweeps:0, refinementSteps:0,
  ringCrankshaftAnglesDegrees:[60], torsionAnglesDegrees:[60], localLineFractions:[1] });
assert.equal(capturedWithoutPhysical.stageOutcome, 'captured-no-physical-proposals');
assert.equal(capturedWithoutPhysical.physicalRefinementAttempted, false);
assert.equal(capturedWithoutPhysical.objectiveStage, 'pharmacophore-capture');
assert.equal(zeroStepPhysicalCalls, 0);
assert.equal(capturedWithoutPhysical.startObjectiveKcalMol,
  capturedWithoutPhysical.capture.startEvaluation.objectiveKcalMol);
assert.equal(capturedWithoutPhysical.bestObjectiveKcalMol,
  capturedWithoutPhysical.capture.bestEvaluation.objectiveKcalMol);

const feasibleLineWins = await refinePoseByRestraintBiasedSearch({ molecule:ring,
  initialPositions:planar, coreAtomIndices:[0], proposalMoves:[carbonylMove],
  scorePose:(positions) => {
    const hbond = evaluateAcceptor(positions);
    return { objectiveKcalMol:hbond.satisfied ? 100 : -100, feasible:hbond.satisfied };
  }, random:() => 0, steps:1, ringCrankshaftAnglesDegrees:[60],
  torsionAnglesDegrees:[60], localLineFractions:[0.5,1] });
assert.equal(feasibleLineWins.selectedFeasible, true,
  'local line selection is feasibility-first rather than blindly energy-first');

const polished = await polishPoseByInternalCoordinateDescent({ molecule:ring,
  initialPositions:planar, coreAtomIndices:[0], proposalMoves:[carbonylMove],
  scorePose:(positions) => {
    const hbond = evaluateAcceptor(positions);
    return { objectiveKcalMol:hbond.penaltyKcalMol, feasible:hbond.satisfied,
      hydrogenBonds:[{ id:'required-ring-carbonyl', ...hbond }] };
  }, sweeps:3, ringCrankshaftAnglesDegrees:[30,60],
  torsionAnglesDegrees:[60], localLineFractions:[1] });
assert.equal(polished.selectedFeasible, true);
assert.ok(polished.completedSweeps >= 1);
assert.ok(polished.evaluations >= 2);
assert.ok(polished.improvements >= 1);
assert.equal(polished.bestEvaluation.hydrogenBonds[0].satisfied, true);
assert.deepEqual(point(polished.positions, 0), point(planar, 0));

const deterministicOptions = { molecule:ring, initialPositions:planar, coreAtomIndices:[0],
  scorePose:(positions) => {
    const hbond = evaluateAcceptor(positions);
    return { objectiveKcalMol:hbond.penaltyKcalMol, feasible:hbond.satisfied };
  }, seed:20260822, steps:48, localLineFractions:[0.5, 1],
  ringCrankshaftAnglesDegrees:[-60,-30,30,60], torsionAnglesDegrees:[-60,60] };
const firstReplay = await refinePoseByRestraintBiasedSearch({ ...deterministicOptions,
  random:mulberry32(20260822) });
const secondReplay = await refinePoseByRestraintBiasedSearch({ ...deterministicOptions,
  random:mulberry32(20260822) });
assert.deepEqual(firstReplay.positions, secondReplay.positions);
assert.deepEqual(firstReplay.acceptedByKind, secondReplay.acceptedByKind);
assert.equal(firstReplay.bestObjectiveKcalMol, secondReplay.bestObjectiveKcalMol);
assert.ok(firstReplay.ringCrankshaftMoveCount > 0);
assert.ok(firstReplay.lineEvaluations >= firstReplay.proposals);
assert.deepEqual(point(firstReplay.positions, 0), point(planar, 0));

const stagedReplayOptions = { molecule:ring, initialPositions:planar, coreAtomIndices:[0],
  proposalMoves:[carbonylMove], restraintScorePose:(positions) => {
    const hbond = evaluateAcceptor(positions);
    return { objectiveKcalMol:hbond.penaltyKcalMol, feasible:hbond.satisfied,
      hbondPenaltyKcalMol:hbond.penaltyKcalMol, hydrogenBonds:[hbond] };
  }, physicalScorePose:(positions) => {
    const hbond = evaluateAcceptor(positions);
    return { objectiveKcalMol:distance(positions, 1, 7) + hbond.penaltyKcalMol,
      feasible:hbond.satisfied, hydrogenBonds:[hbond] };
  }, seed:8831, captureSteps:12, capturePolishSweeps:2, refinementSteps:12,
  ringCrankshaftAnglesDegrees:[-60,-30,30,60], torsionAnglesDegrees:[-60,60],
  localLineFractions:[0.5,1] };
const stagedReplayFirst = await generatePoseByRestraintBiasedSearch({ ...stagedReplayOptions,
  random:mulberry32(8831) });
const stagedReplaySecond = await generatePoseByRestraintBiasedSearch({ ...stagedReplayOptions,
  random:mulberry32(8831) });
const cooperativeYieldEvents = [];
const stagedReplayYielding = await generatePoseByRestraintBiasedSearch({ ...stagedReplayOptions,
  random:mulberry32(8831), yieldControl:(progress) => {
    cooperativeYieldEvents.push(progress);
    return Promise.resolve();
  } });
assert.deepEqual(stagedReplayFirst.positions, stagedReplaySecond.positions);
assert.deepEqual(stagedReplayFirst.capture, stagedReplaySecond.capture);
assert.deepEqual(stagedReplayFirst.physicalRefinement, stagedReplaySecond.physicalRefinement);
assert.deepEqual(stagedReplayYielding.positions, stagedReplayFirst.positions,
  'cooperative browser yields do not alter deterministic coordinates');
assert.deepEqual(stagedReplayYielding.capture, stagedReplayFirst.capture,
  'cooperative browser yields do not alter capture scoring or decisions');
assert.ok(cooperativeYieldEvents.length > 0);
assert.ok(cooperativeYieldEvents.some((entry) => entry.stage === 'contact capture'));
assert.ok(cooperativeYieldEvents.some((entry) => entry.stage === 'contact polish'));

const impossibleTarget = [20,20,20];
const impossible = await refinePoseByRestraintBiasedSearch({ molecule:ring,
  initialPositions:planar, coreAtomIndices:[0], proposalMoves:[carbonylMove],
  scorePose:(positions) => {
    const acceptor = point(positions, 6);
    const error = Math.hypot(...acceptor.map((value, axis) => value - impossibleTarget[axis]));
    return { objectiveKcalMol:error ** 2, feasible:error < 0.1 };
  }, random:() => 0, steps:4, ringCrankshaftAnglesDegrees:[60],
  torsionAnglesDegrees:[60], localLineFractions:[1] });
assert.equal(impossible.selectedFeasible, false,
  'biased generation still reports an unreachable constraint honestly');

let forbiddenPhysicalCalls = 0;
const stagedImpossible = await generatePoseByRestraintBiasedSearch({ molecule:ring,
  initialPositions:planar, coreAtomIndices:[0], proposalMoves:[carbonylMove],
  restraintScorePose:(positions) => {
    const acceptor = point(positions, 6);
    const error = Math.hypot(...acceptor.map((value, axis) => value - impossibleTarget[axis]));
    return { objectiveKcalMol:error ** 2, hbondPenaltyKcalMol:error ** 2,
      feasible:error < 0.1, hydrogenBonds:[] };
  },
  physicalScorePose:() => { forbiddenPhysicalCalls++; return 0; },
  random:() => 0, captureSteps:4, refinementSteps:4,
  ringCrankshaftAnglesDegrees:[60], torsionAnglesDegrees:[60], localLineFractions:[1] });
assert.equal(stagedImpossible.stageOutcome, 'capture-infeasible');
assert.equal(stagedImpossible.captureFeasible, false);
assert.equal(stagedImpossible.physicalRefinementAttempted, false);
assert.equal(forbiddenPhysicalCalls, 0,
  'an impossible restraint is reported before a physical score can hide it');
assert.equal(stagedImpossible.physicalRefinement, null);

let invalidGeometryPhysicalCalls = 0;
const invalidGeometryOnly = await generatePoseByRestraintBiasedSearch({ molecule:ring,
  initialPositions:planar, coreAtomIndices:[0], proposalMoves:[carbonylMove],
  restraintScorePose:(positions) => {
    const hbond = evaluateAcceptor(positions), chemicalValid = !hbond.satisfied;
    return { objectiveKcalMol:hbond.penaltyKcalMol + (chemicalValid ? 0 : 1e4),
      hbondPenaltyKcalMol:hbond.penaltyKcalMol,
      feasible:hbond.satisfied && chemicalValid,
      chemicalValidity:{ valid:chemicalValid, reason:chemicalValid ? 'within-gate' : 'excessive-strain' },
      hydrogenBonds:[hbond] };
  }, physicalScorePose:() => { invalidGeometryPhysicalCalls++; return 0; },
  random:() => 0, captureSteps:1, capturePolishSweeps:1, refinementSteps:4,
  ringCrankshaftAnglesDegrees:[60], torsionAnglesDegrees:[60], localLineFractions:[1] });
assert.equal(invalidGeometryOnly.captureFeasible, false,
  'an H bond reachable only through chemically invalid geometry is not a capture');
assert.equal(invalidGeometryOnly.stageOutcome, 'capture-infeasible');
assert.equal(invalidGeometryPhysicalCalls, 0);

const zeroMove = await refinePoseByRestraintBiasedSearch({ molecule:ring,
  initialPositions:planar, coreAtomIndices:[0,1,2,3,4,5,6],
  scorePose:() => ({ objectiveKcalMol:7, feasible:false }),
  random:mulberry32(1), steps:20 });
assert.equal(zeroMove.proposals, 0);
assert.deepEqual(zeroMove.positions, planar);

await assert.rejects(() => refinePoseByRestraintBiasedSearch({ molecule:ring,
  initialPositions:planar, coreAtomIndices:[0], scorePose:() => 0,
  random:mulberry32(1), localLineFractions:[] }), /line-minimization/);
await assert.rejects(() => refinePoseByRestraintBiasedSearch({ molecule:ring,
  initialPositions:planar, coreAtomIndices:[0], scorePose:() => 0,
  random:mulberry32(1), steps:Number.NaN }), /steps/);
await assert.rejects(() => refinePoseByRestraintBiasedSearch({ molecule:ring,
  initialPositions:planar, coreAtomIndices:[0], proposalMoves:[carbonylMove],
  scorePose:() => 0, random:() => 1, steps:1 }), /\[0, 1\)/);
await assert.rejects(() => polishPoseByInternalCoordinateDescent({ molecule:ring,
  initialPositions:planar, coreAtomIndices:[0], scorePose:() => 0,
  sweeps:-1 }), /sweeps/);

console.log('Molarium restraint-biased internal-coordinate search: PASS');
