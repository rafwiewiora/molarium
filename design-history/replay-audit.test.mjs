import assert from 'node:assert/strict';
import { CHEMIST_ACTIONS_SCHEMA } from '../chemist-actions.mjs';
import { NON_REPLAYABLE_ACTION_NAMES, NON_REPLAYABLE_ACTION_PREFIXES,
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

console.log('Chemist action audit converter: PASS');
