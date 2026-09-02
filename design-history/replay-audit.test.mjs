import assert from 'node:assert/strict';
import { CHEMIST_ACTIONS_SCHEMA } from '../chemist-actions.mjs';
import { actionScriptFromAudit, replayActionScript, validateActionScript } from './replay.mjs';

const audit = { schema:CHEMIST_ACTIONS_SCHEMA, routeId:'converter-test', records:[
  { sequence:1, requestId:'load', action:'designRoute.load',
    args:{ routeId:'test' }, status:'completed', startedAt:'ignored', result:{ ignored:true } },
  { sequence:2, requestId:'inspect', action:'session.inspect',
    args:{ scope:'ligand', includeCoordinates:false, maximumAtoms:100 }, status:'completed' },
  { sequence:3, requestId:'failed-edit', action:'view.setMode',
    args:{ mode:'run' }, status:'failed', error:'ignored' },
  { sequence:4, requestId:'build', action:'view.setMode', args:{ mode:'build' },
    caption:'Enter the Build workspace', status:'completed', durationMs:4 },
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
assert.equal(complete.actions[2].caption, 'Enter the Build workspace');
assert.equal(complete.sourceAudit.failedRecordsExcluded, 1);
assert.deepEqual(complete.sourceAudit.includedSequences, [1, 2, 4]);
assert.equal(complete.sourceAudit.campaignBookkeepingExcluded, 1);
assert.equal(JSON.stringify(complete).includes('startedAt'), false);
assert.equal(JSON.stringify(complete).includes('durationMs'), false);
assert.equal(JSON.stringify(complete).includes('ignored'), false);
assert.equal(JSON.stringify(complete).includes('requestId'), false);

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

console.log('Chemist action audit converter: PASS');
