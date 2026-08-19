import assert from 'node:assert/strict';
import { MOLARIUM_CCD_PROTOCOL } from './protocol.mjs';
import { applyCoreTransform, evaluateCoreConstraint, evaluateHydrogenBondConstraint,
  fittedCoreTransform, hydrogenBondGeometry, rankConstrainedPoses, scoreConstrainedPose } from './constraints.mjs';
import { appendLabbookEvent, completeLabbook, createLabbook, inputProvenance,
  renderLabbookMarkdown, verifyLabbook } from './labbook.mjs';
import { captureReferenceLigand, ensureStableAtomIds, mapReferenceCore } from './reference-core.mjs';
import { runConstrainedDocking } from './workflow.mjs';

const reference = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
const candidate = Float64Array.from([4, -2, 3, 4, -1, 3, 3, -2, 3, 4, -2, 4]);
const pairs = [[0, 0], [1, 1], [2, 2], [3, 3]];
const transform = fittedCoreTransform(reference, candidate, pairs);
const aligned = applyCoreTransform(candidate, transform);
assert.ok(transform.fittedRmsdAngstrom < 1e-7);
assert.ok(Array.from(aligned).every((value, index) => Math.abs(value - reference[index]) < 1e-7));

const core = evaluateCoreConstraint(reference, aligned, pairs, MOLARIUM_CCD_PROTOCOL.coreConstraint);
assert.equal(core.satisfied, true);
assert.equal(core.penaltyKcalMol, 0);
aligned[0] += 2;
const displacedCore = evaluateCoreConstraint(reference, aligned, pairs, MOLARIUM_CCD_PROTOCOL.coreConstraint);
assert.equal(displacedCore.satisfied, false);
assert.ok(displacedCore.penaltyKcalMol > 0);

const hbondGeometry = hydrogenBondGeometry({
  donor:{ x:0, y:0, z:0 }, hydrogen:{ x:1, y:0, z:0 }, acceptor:{ x:2.8, y:0, z:0 },
});
assert.equal(hbondGeometry.dhaAngleDegrees, 180);
const goodHbond = evaluateHydrogenBondConstraint(hbondGeometry, MOLARIUM_CCD_PROTOCOL.hydrogenBondConstraint);
assert.equal(goodHbond.satisfied, true);
assert.equal(goodHbond.penaltyKcalMol, 0);
const badHbond = evaluateHydrogenBondConstraint({ ...hbondGeometry, dhaAngleDegrees:90 },
  MOLARIUM_CCD_PROTOCOL.hydrogenBondConstraint);
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
  runId:'ccd-test-1', startedAt:'2026-08-19T12:00:00.000Z', inputs,
  selections:{ coreAtomPairs:pairs, hydrogenBonds:[{ receptorAtom:7, ligandAtom:2, required:true }] },
  environment:{ execution:'browser', network:'disabled' }, application:{ version:'test' },
});
await appendLabbookEvent(labbook, { at:'2026-08-19T12:00:01.000Z', stage:'core-alignment',
  status:'passed', details:{ fittedRmsdAngstrom:transform.fittedRmsdAngstrom } });
await completeLabbook(labbook, { completedAt:'2026-08-19T12:00:02.000Z',
  outcome:{ candidates:2, feasible:1, selectedRank:1 } });
assert.deepEqual(await verifyLabbook(labbook), { valid:true, reason:null, events:2 });
const markdown = renderLabbookMarkdown(labbook);
assert.match(markdown, /Molarium CCD-1 labbook/);
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
const editedAtoms = designMolecule.atoms.map((atom) => ({ ...atom }));
editedAtoms.push({ element:'C', x:3.8, y:0, z:0 });
const mappedCore = mapReferenceCore(captured, editedAtoms);
assert.equal(mappedCore.complete, true);
assert.deepEqual(mappedCore.atomPairs, [[0, 0], [1, 1], [2, 2]]);

const translatedGood = Float64Array.from([4, -2, 3, 5, -2, 3, 4, -1, 3, 6.8, -2, 3]);
const translatedBad = Float64Array.from([4, -2, 3, 5, -2, 3, 4, -1, 3, 4, -2, 5.8]);
const workflowLabbook = await createLabbook({
  runId:'ccd-workflow-1', startedAt:'2026-08-19T12:00:03.000Z', inputs,
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
  protocol:MOLARIUM_CCD_PROTOCOL,
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

console.log('Molarium CCD-1 constraints and labbook: PASS');
