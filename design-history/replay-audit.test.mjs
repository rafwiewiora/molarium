import assert from 'node:assert/strict';
import { CHEMIST_ACTIONS_SCHEMA } from '../chemist-actions.mjs';
import { MOLECULAR_STATE_HASH_SCHEMA } from '../molecular-state-hash.mjs';
import { AUDIT_PORTABLE_SCIENTIFIC_GUARDS, AUDIT_STATE_HASH_GUARDS,
  NON_REPLAYABLE_ACTION_NAMES, NON_REPLAYABLE_ACTION_PREFIXES,
  actionScriptFromAudit, replayActionScript, validateActionScript } from './replay.mjs';

const audit = { schema:CHEMIST_ACTIONS_SCHEMA, routeId:'converter-test', records:[
  { sequence:1, requestId:'load', action:'designRoute.load',
    args:{ routeId:'test' }, status:'completed', startedAt:'ignored', result:{ ignored:true } },
  { sequence:2, requestId:'inspect', action:'session.inspect',
    args:{ scope:'ligand', includeCoordinates:false, maximumAtoms:100 }, status:'completed' },
  { sequence:3, requestId:'failed-edit', action:'view.setMode',
    args:{ mode:'run' }, status:'failed', error:'ignored' },
  { sequence:4, requestId:'build', action:'view.setMode', args:{ mode:'build' },
    caption:'Enter the Design workspace', status:'completed', durationMs:4 },
  { sequence:5, requestId:'commit-history', action:'campaign.commitCurrent',
    args:{ message:'must not recursively replay' }, status:'completed' },
] };

const complete = actionScriptFromAudit(audit, { label:'Complete protocol' });
assert.equal(validateActionScript(complete), complete);
assert.equal(complete.actions.length, 3);
assert.deepEqual(complete.actions[0], {
  action:'designRoute.load', args:{ routeId:'test' },
});
assert.deepEqual(complete.actions[1].args, audit.records[1].args);
assert.equal(complete.actions[2].caption, 'Enter the Design workspace');
assert.equal(complete.sourceAudit.failedRecordsExcluded, 1);
assert.deepEqual(complete.sourceAudit.includedSequences, [1, 2, 4]);
assert.equal(complete.sourceAudit.campaignBookkeepingExcluded, 1);
assert.equal(JSON.stringify(complete).includes('startedAt'), false);
assert.equal(JSON.stringify(complete).includes('durationMs'), false);
assert.equal(JSON.stringify(complete).includes('ignored'), false);
assert.equal(JSON.stringify(complete).includes('requestId'), false);

assert.deepEqual(NON_REPLAYABLE_ACTION_PREFIXES, ['campaign.', 'designerScript.']);
assert.deepEqual(NON_REPLAYABLE_ACTION_NAMES, ['interface.presentDesignerStep']);
const replayControlAudit = { schema:CHEMIST_ACTIONS_SCHEMA, records:[
  { sequence:1, action:'designRoute.load', args:{ routeId:'test' }, status:'completed' },
  { sequence:2, action:'designerScript.play', args:{ playing:false }, status:'completed' },
  { sequence:3, action:'designerScript.step', args:{ direction:'previous' }, status:'completed' },
  { sequence:4, action:'designerScript.restart', args:{}, status:'completed' },
  { sequence:5, action:'designerScript.inspect', args:{}, status:'completed' },
  { sequence:6, action:'interface.presentDesignerStep',
    args:{ index:0, phase:'before' }, status:'completed' },
  { sequence:7, action:'interface.setPanelOpen',
    args:{ panelId:'load-toggle', open:false }, status:'completed' },
  { sequence:8, action:'campaign.commitCurrent',
    args:{ message:'container bookkeeping' }, status:'completed' },
] };
const replayControlSafe = actionScriptFromAudit(replayControlAudit,
  { label:'Replay-controller exclusion' });
assert.deepEqual(replayControlSafe.actions.map((step) => step.action),
  ['designRoute.load', 'interface.setPanelOpen'],
  'molecular scripts must retain ordinary interface actions but exclude their own replay controller');
assert.deepEqual(replayControlSafe.sourceAudit.includedSequences, [1, 7]);
assert.equal(replayControlSafe.sourceAudit.nonReplayableActionsExcluded, 6);
assert.equal(replayControlSafe.sourceAudit.campaignBookkeepingExcluded, 1);
assert.equal(replayControlSafe.sourceAudit.replayControllerActionsExcluded, 5);

audit.records[0].args.routeId = 'changed-after-conversion';
assert.equal(complete.actions[0].args.routeId, 'test', 'action arguments must be cloned');

const concise = actionScriptFromAudit(audit, { label:'Selected route', includeReadOnly:false,
  includeSequences:[1, 2, 4], captionsBySequence:{ 1:'Load the hit' },
  includeAuditMetadata:true });
assert.deepEqual(concise.actions.map((step) => step.action),
  ['designRoute.load', 'view.setMode']);
assert.equal(concise.actions[0].caption, 'Load the hit');
assert.equal(concise.actions[0].auditSequence, 1);
assert.equal(concise.actions[0].auditRequestId, 'load');
assert.deepEqual(concise.sourceAudit.includedSequences, [1, 4]);

assert.throws(() => actionScriptFromAudit(audit, { includeSequences:[99] }),
  /does not contain requested sequences/);
assert.throws(() => actionScriptFromAudit({ schema:'other/v1', records:[] }),
  /Unsupported Chemist Actions audit schema/);
assert.throws(() => actionScriptFromAudit({ schema:CHEMIST_ACTIONS_SCHEMA, records:[
  { sequence:1, status:'completed', action:'private.teleport', args:{} },
] }), /unavailable route/);

const calls = [];
const api = Object.freeze({ schema:CHEMIST_ACTIONS_SCHEMA, async execute(request) {
  calls.push(request);
  return { schema:CHEMIST_ACTIONS_SCHEMA, status:'completed', result:{} };
} });
const replay = await replayActionScript(api, concise);
assert.equal(replay.status, 'completed');
assert.deepEqual(calls.map(({ action, args }) => ({ action, args })), concise.actions
  .map(({ action, args }) => ({ action, args })));

const guardedScript = { schema:'molarium.chemist-action-script/v1', label:'Guarded replay',
  actions:[{ action:'session.inspect', args:{ scope:'ligand' },
    expect:{ 'checkpoint.protocol':'v4', 'checkpoint.feasible':true } }] };
const guardedApi = Object.freeze({ schema:CHEMIST_ACTIONS_SCHEMA, async execute() {
  return { schema:CHEMIST_ACTIONS_SCHEMA, status:'completed',
    result:{ checkpoint:{ protocol:'v4', feasible:true } } };
} });
assert.equal((await replayActionScript(guardedApi, guardedScript)).status, 'completed');
const mismatchedApi = Object.freeze({ schema:CHEMIST_ACTIONS_SCHEMA, async execute() {
  return { schema:CHEMIST_ACTIONS_SCHEMA, status:'completed',
    result:{ checkpoint:{ protocol:'v4', feasible:false } } };
} });
const mismatched = await replayActionScript(mismatchedApi, guardedScript);
assert.equal(mismatched.status, 'failed');
assert.match(mismatched.steps[0].error, /expectation failed.*feasible/i);
assert.throws(() => validateActionScript({ schema:'molarium.chemist-action-script/v1',
  label:'Bad expectation', actions:[{ action:'session.inspect', args:{},
    expect:{ 'bad path':true } }] }), /invalid expectation path/);

assert.throws(() => validateActionScript({ schema:'molarium.chemist-action-script/v1',
  label:'Implicit chemistry target', actions:[
    { action:'selection.replace', args:{ atomIds:['persistent-a'] } },
    { action:'chemistry.deleteAtom', args:{} },
  ] }), /requires explicit atomId.*ambient selection/);

const migratedLegacyAudit = actionScriptFromAudit({ schema:CHEMIST_ACTIONS_SCHEMA, records:[
  { sequence:1, action:'selection.replace', args:{ atomIds:['persistent-a'] },
    status:'completed' },
  { sequence:2, action:'chemistry.deleteAtom', args:{}, status:'completed' },
] });
assert.deepEqual(migratedLegacyAudit.actions[1].args, { atomId:'persistent-a' },
  'audit conversion may materialize a prior explicit selection, but saved scripts must contain the target');
assert.throws(() => actionScriptFromAudit({ schema:CHEMIST_ACTIONS_SCHEMA, records:[
  { sequence:1, action:'chemistry.setBond', args:{ order:2 }, status:'completed' },
] }), /cannot be migrated.*no explicit atomIds/);

assert.deepEqual(Object.keys(AUDIT_STATE_HASH_GUARDS).sort(),
  ['optimization.run','pose.apply','pose.refine']);
assert.deepEqual(Object.keys(AUDIT_PORTABLE_SCIENTIFIC_GUARDS).sort(),
  ['optimization.run','pose.apply','pose.applySidechainRotamer',
    'pose.enumerateSidechainRotamers','pose.refine']);
const hashes = Object.fromEntries('abcdef'.split('').map((key, index) =>
  [key, String(index + 1).repeat(64)]));
const guardedAudit = { schema:CHEMIST_ACTIONS_SCHEMA, records:[
  { sequence:1, action:'pose.refine', args:{ searchChains:16 }, status:'completed',
    result:{ refinement:{ stateHashSchema:MOLECULAR_STATE_HASH_SCHEMA,
      inputStateSha256:hashes.a, selectedStateSha256:hashes.b } } },
  { sequence:2, action:'pose.apply', args:{ index:0 }, status:'completed',
    result:{ appliedPose:{ stateHashSchema:MOLECULAR_STATE_HASH_SCHEMA,
      inputStateSha256:hashes.a, selectedStateSha256:hashes.b,
      outputStateSha256:hashes.c } } },
  { sequence:3, action:'optimization.run', args:{ method:'induced-fit-webgpu' },
    status:'completed', result:{ optimization:{ stateHashSchema:MOLECULAR_STATE_HASH_SCHEMA,
      inputStateSha256:hashes.c, outputStateSha256:hashes.d } } },
] };
const automaticallyGuarded = actionScriptFromAudit(guardedAudit);
assert.deepEqual(automaticallyGuarded.actions.map((step) => step.args), [
  { searchChains:16, expectedInputStateSha256:hashes.a,
    expectedSelectedStateSha256:hashes.b },
  { index:0, expectedInputStateSha256:hashes.a,
    expectedSelectedStateSha256:hashes.b, expectedOutputStateSha256:hashes.c },
  { method:'induced-fit-webgpu', expectedInputStateSha256:hashes.c,
    expectedOutputStateSha256:hashes.d },
]);
assert.deepEqual(automaticallyGuarded.sourceAudit.stateHashGuards,
  { mode:'auto', schema:MOLECULAR_STATE_HASH_SCHEMA, guardedActionCount:3 });
assert.equal(actionScriptFromAudit(guardedAudit,
  { stateHashGuards:'required' }).sourceAudit.stateHashGuards.guardedActionCount, 3);
assert.equal(Object.keys(actionScriptFromAudit(guardedAudit,
  { stateHashGuards:'off' }).actions[0].args).includes('expectedInputStateSha256'), false);
const portableAudit = structuredClone(guardedAudit);
portableAudit.records[0].result.molecule = { atoms:14, bonds:15 };
Object.assign(portableAudit.records[0].result.refinement, {
  coverageComplete:true, selectedFeasible:true,
  selectedCore:{ satisfied:true }, requiredSpatialFeatureCount:2,
});
Object.assign(portableAudit.records[1].result.appliedPose, {
  feasible:true, infeasibleOverride:false,
});
Object.assign(portableAudit.records[2].result.optimization, {
  accepted:true, valenceSafeguard:{ accepted:true, complete:true },
  registeredPoseRetention:{ accepted:true }, fixedAtomMotion:{ accepted:true },
});
const portable = actionScriptFromAudit(portableAudit, {
  stateHashGuards:'off', executionContract:'portable-scientific',
});
assert.deepEqual(portable.actions[0].args, { searchChains:16 });
assert.deepEqual(portable.actions[0].expect, {
  'refinement.coverageComplete':true,
  'refinement.selectedFeasible':true,
  'refinement.selectedCore.satisfied':true,
  'refinement.requiredSpatialFeatureCount':2,
  'molecule.atoms':14,
  'molecule.bonds':15,
});
assert.equal(portable.actions[2].expect['optimization.valenceSafeguard.accepted'], true);
assert.equal(portable.actions[2].expect['optimization.fixedAtomMotion.accepted'], true);
assert.equal(portable.sourceAudit.executionContract.mode, 'portable-scientific');
assert.equal(portable.sourceAudit.executionContract.portableScientificGuardCount, 13);

const portableRotamer = actionScriptFromAudit({ schema:CHEMIST_ACTIONS_SCHEMA, records:[
  { sequence:1, action:'pose.enumerateSidechainRotamers', status:'completed',
    args:{ receptorAtomId:'run-specific:PHE:890:CG', maximumCandidates:32 },
    result:{ molecule:{ atoms:100, bonds:101 }, sidechainRotamers:{
      residue:{ residueName:'PHE', chain:'A', residueIndex:890, insertionCode:'' },
      generatedCandidateCount:13,
    } } },
  { sequence:2, action:'pose.applySidechainRotamer', status:'completed',
    args:{ coordinateSha256:hashes.a, expectedInputCoordinateSha256:hashes.b,
      expectedSelectedCoordinateSha256:hashes.a },
    result:{ molecule:{ atoms:100, bonds:101 }, sidechainRotamer:{
      residue:{ residueName:'PHE', chain:'A', residueIndex:890, insertionCode:'' },
      chiDegrees:[-180,-90], source:'canonical-library',
    } } },
] }, { stateHashGuards:'off', executionContract:'portable-scientific' });
assert.deepEqual(portableRotamer.actions[0].args, {
  receptorResidue:{ residueName:'PHE', chain:'A', residueIndex:890, insertionCode:'' },
  maximumCandidates:32,
});
assert.deepEqual(portableRotamer.actions[1].args, { chiDegrees:[-180,-90] });
assert.equal(portableRotamer.actions[0].expect['sidechainRotamers.generatedCandidateCount'], 13);
assert.equal(portableRotamer.actions[1].expect['sidechainRotamer.source'], 'canonical-library');
assert.equal(Object.hasOwn(portableRotamer.actions[1].expect,
  'sidechainRotamer.chiDegrees'), false,
'the public chi selector is circular; +180 and -180 must not become an exact-output guard');
assert.throws(() => actionScriptFromAudit(guardedAudit, {
  executionContract:'portable-scientific', stateHashGuards:'required',
}), /portable-scientific execution requires stateHashGuards off/);
assert.throws(() => actionScriptFromAudit(guardedAudit, {
  executionContract:'portable-ish', stateHashGuards:'off',
}), /executionContract must be/);
assert.throws(() => actionScriptFromAudit({ schema:CHEMIST_ACTIONS_SCHEMA, records:[
  { sequence:1, action:'pose.refine', args:{ searchChains:16 }, status:'completed', result:{} },
] }, { stateHashGuards:'required' }), /missing molarium\.molecular-state-hash\/v1 result guards/);
assert.throws(() => actionScriptFromAudit({ schema:CHEMIST_ACTIONS_SCHEMA, records:[
  { sequence:1, action:'pose.apply', args:{ index:0 }, status:'completed',
    result:{ appliedPose:{ stateHashSchema:MOLECULAR_STATE_HASH_SCHEMA,
      inputStateSha256:hashes.a, selectedStateSha256:hashes.b } } },
] }), /no valid outputStateSha256/);
assert.throws(() => actionScriptFromAudit({ schema:CHEMIST_ACTIONS_SCHEMA, records:[
  { sequence:1, action:'optimization.run',
    args:{ method:'webgpu', expectedInputStateSha256:hashes.e }, status:'completed',
    result:{ optimization:{ stateHashSchema:MOLECULAR_STATE_HASH_SCHEMA,
      inputStateSha256:hashes.a, outputStateSha256:hashes.f } } },
] }), /expectedInputStateSha256 conflicts/);
assert.throws(() => actionScriptFromAudit(guardedAudit, { stateHashGuards:'sometimes' }),
  /must be auto, required, or off/);

console.log('Chemist action audit converter: PASS');
