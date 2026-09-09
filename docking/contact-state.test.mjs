import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { requiredContactPolicy, liveHydrogenBondState, unresolvedContactMessage, resolveContactRequirement } from './contact-state.mjs';
import { capturedContactDefault, CONTACT_CAPTURE_POLICY } from './contact-capture-policy.mjs';
import { captureCrossHydrogenBonds, mapCapturedHydrogenBonds } from './browser-adapter.mjs';
import * as remapModule from './contact-remap.mjs';

const definitions = [{ id:'anchor',label:'anchor' },{ id:'removed',label:'removed' }];
const hypotheses = definitions.map(({ id,label }) => ({ kind:'hydrogen-bond',capturedId:id,label }));

test('SR-07: exact labels survive capture numbering; absence and ambiguity fail closed by default', () => {
  assert.equal(resolveContactRequirement(definitions, { contactLabel:'removed', required:false }).id, 'removed');
  assert.equal(resolveContactRequirement(definitions, { contactId:'anchor', required:true }).id, 'anchor');
  assert.throws(() => resolveContactRequirement(definitions, { contactLabel:'missing', required:false }), /Unknown/);
  assert.equal(resolveContactRequirement(definitions, { contactLabel:'missing', required:false, ifAbsent:'record-omission' }), null);
  assert.throws(() => resolveContactRequirement(definitions, { contactLabel:'missing', required:true, ifAbsent:'record-omission' }), /requires/);
  assert.throws(() => resolveContactRequirement(definitions, { contactId:'anchor', required:false, ifAbsent:'record-omission' }), /requires/);
  assert.throws(() => resolveContactRequirement([...definitions, definitions[0]], { contactLabel:'anchor', required:false }), /Ambiguous/);
  assert.throws(() => resolveContactRequirement(definitions, { contactId:'anchor', contactLabel:'anchor', required:false }), /exactly one/);
});

test('SR-07: unresolved-contact errors identify the exact requirement without changing intent', () => {
  const ids = ['reference-hbond-78'];
  const definitions = [{ id:ids[0], label:'AWW A1104 OX3 → TYR A884 O' }];
  assert.equal(unresolvedContactMessage(ids, definitions),
    'Required contact AWW A1104 OX3 → TYR A884 O [reference-hbond-78] has no role-compatible replacement feature. '
    + 'Explicitly revise the contact requirement or continue editing; no constraint was dropped.');
  assert.match(unresolvedContactMessage([...ids, 'unknown'], definitions), /; unknown have no/);
  assert.deepEqual(ids, ['reference-hbond-78']);
  assert.equal(definitions[0].label, 'AWW A1104 OX3 → TYR A884 O');
});

test('DV-01: missing availability cannot omit required intent or re-enable omitted intent', () => {
  const policy = requiredContactPolicy(definitions, ['removed'], hypotheses);
  assert.deepEqual(policy.requiredContactIds, ['removed']);
  assert.equal(policy.availabilityChangesIntent, false);
  assert(policy.decisions.every((entry) => entry.decisionSource === 'preserved-prior-requirement'));
  const explicit = requiredContactPolicy(definitions, ['removed'], hypotheses.map((entry) =>
    ({ ...entry, required:entry.capturedId === 'anchor' })));
  assert.deepEqual(explicit.requiredContactIds, ['anchor']);
  assert.throws(() => requiredContactPolicy(definitions, [], []), /pre-registered/);
  assert.throws(() => requiredContactPolicy(definitions, [],
    [{ ...hypotheses[0],required:'false' },hypotheses[1]]), /boolean/);
  assert.throws(() => requiredContactPolicy(definitions, [], [...hypotheses,hypotheses[0]]), /Duplicate/);
});

const fixture = () => ({ atoms:[
  { designAtomId:'D',element:'N',x:0,y:0,z:0 },
  { designAtomId:'H',element:'H',x:1,y:0,z:0 },
  { designAtomId:'A',element:'O',x:2.8,y:0,z:0 },
  { designAtomId:'C',element:'C',x:4,y:0,z:0 },
], bonds:[{ a:0,b:1,order:1 },{ a:2,b:3,order:2 }] });
const capture = (molecule) => captureCrossHydrogenBonds(molecule, [2,3],
  [{ donor:0,hydrogen:1,acceptor:2,distance:1.8,cosine:-1 }])[0];

test('DV-02: live geometry follows receptor and ligand motion, never captured coordinates', () => {
  const molecule = fixture(), definition = capture(molecule);
  const before = liveHydrogenBondState(molecule, definition, { includeCoordinates:true });
  assert.equal(before.satisfied, true);
  molecule.atoms[0].x = -1; molecule.atoms[1].x = 0;
  const after = liveHydrogenBondState(molecule, definition, { includeCoordinates:true });
  assert.equal(after.donorAcceptorDistanceAngstrom, 3.8);
  assert.equal(after.hydrogenAcceptorDistanceAngstrom, 2.8);
  assert.equal(after.satisfied, false);
  assert.deepEqual(after.participants.donor.coordinatesAngstrom, [-1,0,0]);
  assert.equal(definition.donor.point.x, 0, 'Captured reference must not be rewritten');
  molecule.atoms[2].x = 1.8;
  const ligandMoved = liveHydrogenBondState(molecule, definition);
  assert.equal(ligandMoved.satisfied, true);
  assert.equal(ligandMoved.geometrySource, 'current-molecule-coordinates');
  assert(!('coordinatesAngstrom' in ligandMoved.participants.donor));
});

test('DV-02: missing, non-finite, incompatible and unresolved features fail closed', () => {
  const molecule = fixture(), definition = capture(molecule);
  assert.equal(liveHydrogenBondState(molecule, definition, { available:false }).satisfied, false);
  molecule.atoms[2].element = 'C';
  const changed = liveHydrogenBondState(molecule, definition);
  assert.equal(changed.roleCompatible, false);
  assert.equal(changed.satisfied, false);
  assert.deepEqual(changed.incompatibleAtomIds, ['A']);
  molecule.atoms[2].element = 'O'; molecule.atoms[2].x = NaN;
  const invalid = liveHydrogenBondState(molecule, definition);
  assert.equal(invalid.donorAcceptorDistanceAngstrom, null);
  assert.deepEqual(invalid.invalidCoordinateAtomIds, ['A']);
  molecule.atoms[2].designAtomId = 'replacement';
  const missing = liveHydrogenBondState(molecule, definition);
  assert.equal(missing.satisfied, false);
  assert.equal(missing.participants.acceptor.present, false);
  assert.deepEqual(missing.missingAtomIds, ['A']);
  assert(!('coordinatesAngstrom' in missing.participants.acceptor));
});

test('DV-03: covalent F is optional; geminal halogens are disclosed; fluoride is distinct', () => {
  const molecule = fixture();
  molecule.atoms[2].element = 'F'; molecule.bonds[1].order = 1;
  let policy = capturedContactDefault(molecule, 2);
  assert.equal(policy.required, false);
  assert.equal(policy.evidenceClass, 'weak-covalent-fluorine-hypothesis');
  assert.match(policy.conventionalAcceptorHeuristic, /^within-/);
  assert.equal(policy.capturePolicy, CONTACT_CAPTURE_POLICY.id);
  for (const element of ['F','Cl','Br','I']) {
    molecule.atoms[4] = { element,x:4,y:1,z:0 };
    molecule.bonds[2] = { a:3,b:4,order:1 };
    assert.match(capturedContactDefault(molecule, 2).conventionalAcceptorHeuristic, /^outside-/);
  }
  molecule.atoms.push({ element:'F',x:4,y:-1,z:0 }); molecule.bonds.push({ a:3,b:5,order:1 });
  assert.equal(capturedContactDefault(molecule, 2).required, false, 'CF3 remains optional');
  molecule.bonds = [molecule.bonds[0]]; molecule.atoms[2].formalCharge = -1;
  policy = capturedContactDefault(molecule, 2);
  assert.equal(policy.required, true, 'Unbound fluoride is not covalent C–F');
});

test('DV-03: explicit designer selection requires a default-optional fluorine hypothesis', () => {
  const molecule = fixture(); molecule.atoms[2].element = 'F'; molecule.bonds[1].order = 1;
  const definition = capture(molecule);
  assert.equal(definition.required, false);
  assert.match(definition.acceptor.featureSignature, /fluorine acceptor/);
  assert.equal(mapCapturedHydrogenBonds([definition], molecule.atoms, []).constraints.length, 0);
  const explicit = mapCapturedHydrogenBonds([definition], molecule.atoms, [definition.id]);
  assert.equal(explicit.constraints[0].required, true);
  const alternatives = mapCapturedHydrogenBonds([{ ...definition,
    alternatives:[{ ...definition,alternativeId:'replacement-F' }] }], molecule.atoms, [definition.id]);
  assert.equal(alternatives.constraints[0].required, true);
  assert.equal(alternatives.constraints[0].alternatives[0].required, true);
});

test('DV-01/02 wiring: rendering never removes intent and cached metrics have a separate name', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const render = source.slice(source.indexOf('function renderDockingConstraints()'),
    source.indexOf('function updateDockingUi()'));
  assert(!render.includes('dockingSelectedHbondIds.delete'));
  assert(!render.includes('checkbox.disabled = pending ||'));
  const inspect = source.slice(source.indexOf('async function inspectChemistActionState('),
    source.indexOf('const REGISTERED_DESIGN_ROUTES'));
  assert.match(inspect, /liveHydrogenBondState\(state.molecule/);
  assert.match(inspect, /candidateHydrogenBond:/);
  assert(!inspect.includes('satisfied:poseContact?.satisfied'));
  const set = source.slice(source.indexOf("'pose.setContact':async"), source.indexOf("'pose.addContact':async"));
  assert.match(set, /if \(changed\).*state.dockingResult = null/);
});

test('DV-02: actual apply/remap functions commit only the applied alternative; contact history restores it', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const extract = (first,next) => source.slice(source.indexOf(first),source.indexOf(next));
  const molecule=fixture(), definition=capture(molecule);
  const candidate={id:'replacement-O',role:'acceptor',atomIds:['replacement'],
    signature:definition.acceptor.featureSignature,
    replacement:{acceptor:{...definition.acceptor,designAtomId:'replacement'}}};
  const state={molecule,dockingPoseIndex:0,dockingReference:{hydrogenBonds:[definition],receptorSite:{}},
    dockingSelectedHbondIds:new Set([definition.id]),dockingContactRemaps:new Map(),
    dockingContactRemapProposals:new Map([[definition.id,{id:definition.id,candidates:[candidate],
      priorEffectiveDefinition:definition,ligandRole:'acceptor'}]])};
  const logs=[],history=[];
  const bind = (body,bindings) => new Function(...Object.keys(bindings),`return (${body});`)(...Object.values(bindings));
  const captureState=bind(extract('function captureDockingContactState()',
    'function restoreDockingContactState('),{state});
  const restoreState=bind(extract('function restoreDockingContactState(',
    'function buildHistoryEntry('),{state});
  const choose=bind(extract('async function chooseDockingContactRemap(',
    'function canonicalDockingTopology(').replace("await import('./docking/contact-remap.mjs')",'remapModule'),
  {state,remapModule,contactParticipantIds:(value,scope)=>['donor','hydrogen','acceptor']
    .map((role)=>value[role]).filter((entry)=>entry.scope===scope).map((entry)=>entry.designAtomId),
  recordDockingContactRemap:(audit)=>logs.push(audit),updateDockingUi:()=>{},showToast:()=>{}});
  const pose={feasible:true,rank:1,totalScoreKcalMol:0,positions:[1,2,3],
    hydrogenBonds:[{id:definition.id,selectedAlternativeId:candidate.id}]};
  const result={run:{candidates:[pose]},plan:{},labbook:{protocol:{id:'test'},runId:'test'},ligandTopologyText:'same'};
  state.dockingResult=result;
  const adapter={dockingTopologyText:()=> 'same',applyLigandPositions:(target)=>{target.atoms[2].x=3;}};
  const apply=bind(extract('async function applySelectedDockingPose(',
    'async function downloadDockingLabbook(')
    .replace("await import('./docking/browser-adapter.mjs')",'adapterModule')
    .replace("await import('./docking/receptor-score.mjs')",'receptorModule'),
  {state,adapterModule:adapter,receptorModule:{receptorSiteIntegrity:()=>({valid:true})},
    currentIndicesForDockingPlan:()=>[2,3],pushBuildHistory:()=>history.push(captureState()),
    chooseDockingContactRemap:choose,clearCalculationResult:()=>{},updateStoredBondDistances:()=>{},
    updateInfo:()=>{},updateHistoryButtons:()=>{},draw:()=>{},showToast:()=>{}});
  assert.equal(state.dockingContactRemaps.size,0,'A candidate alone must not commit its feature');
  pose.feasible=false;
  await assert.rejects(apply,/infeasible/);
  assert.equal(history.length,0); assert.equal(logs.length,0);
  pose.feasible=true; await apply();
  assert.equal(state.dockingContactRemapProposals.size,0);
  assert.equal(state.dockingContactRemaps.get(definition.id).effectiveDefinition.acceptor.designAtomId,'replacement');
  assert.equal(logs[0].selectedAlternativeId,candidate.id);
  assert.equal(logs[0].geometryUsedForSelection,true);
  assert.equal(state.dockingResult,result,'Applying the remap preserves the result used by pose.apply');
  const redo=captureState(); restoreState(history[0]);
  assert.equal(state.dockingContactRemaps.size,0);
  assert.equal(state.dockingContactRemapProposals.get(definition.id).candidates[0].id,candidate.id);
  restoreState(redo);
  assert.equal(state.dockingContactRemaps.get(definition.id).audit.selectedAlternativeId,candidate.id);
});
