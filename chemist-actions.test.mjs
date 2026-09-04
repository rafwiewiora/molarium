import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHEMIST_ACTIONS_SCHEMA, CHEMIST_ACTION_DEFINITIONS, CHEMIST_ACTION_SCOPES,
  createChemistActionsApi } from './chemist-actions.mjs';

const calls = [];
const persisted = [];
let clock = 0;
const routes = Object.fromEntries(Object.keys(CHEMIST_ACTION_DEFINITIONS).map((action) =>
  [action, async (args) => { calls.push({ action, args });
    if (action === 'chemistry.deleteAtom' && args.fail) throw new Error('chemistry rejected');
    return { observed:action }; }]));
const api = createChemistActionsApi({ routes,
  now:() => `time-${clock}`, monotonicNow:() => ++clock, historyLimit:3,
  recordAudit:(record) => persisted.push(record) });

assert.equal(api.schema, CHEMIST_ACTIONS_SCHEMA);
assert(Object.isFrozen(api));
assert(Object.hasOwn(api.describe().actions, 'chemistry.finish'));
assert(Object.hasOwn(api.describe().actions, 'view.focusComponent'));
assert(Object.hasOwn(api.describe().actions, 'view.focusAtoms'));
assert(Object.hasOwn(api.describe().actions, 'view.highlightAtoms'));
assert(Object.hasOwn(api.describe().actions, 'view.setDisplay'));
assert(Object.hasOwn(api.describe().actions, 'session.loadStructure'));
assert(Object.hasOwn(api.describe().actions, 'geometry.setInternalCoordinate'));
assert(Object.hasOwn(api.describe().actions, 'calculation.run'));
assert(Object.hasOwn(api.describe().actions, 'campaign.import'));
assert(Object.hasOwn(api.describe().actions, 'designerScript.play'));
assert(Object.hasOwn(api.describe().actions, 'designerScript.loadRegistered'));
assert(Object.hasOwn(api.describe().actions, 'designerScript.export'));
assert(Object.hasOwn(api.describe().actions, 'interface.presentDesignerStep'));
assert.match(api.describe().actions['designerScript.export'].arguments.kind,
  /installed-script/);
assert.match(api.describe().actions['interface.presentDesignerStep'].arguments.phase,
  /before \| after \| clear/);
assert(Object.hasOwn(api.describe().actions, 'pose.addContact'));
assert(Object.hasOwn(api.describe().actions, 'pose.forgetContact'));
assert(Object.hasOwn(api.describe().actions, 'pose.updateReceptorReference'));
assert(Object.hasOwn(api.describe().actions, 'pose.enumerateSidechainRotamers'));
assert(Object.hasOwn(api.describe().actions, 'pose.applySidechainRotamer'));
assert(Object.hasOwn(api.describe().actions, 'chemistry.setEditPolicy'));
assert.equal(api.describe().actions['chemistry.setAtom'].arguments.atomId,
  'persistent atom ID');
assert.match(api.describe().actions['chemistry.setBond'].arguments.atomIds,
  /two persistent atom IDs/);
assert.equal(api.describe().actions['chemistry.addHydrogen'].arguments.atomId,
  'persistent atom ID');
assert.match(api.describe().actions['pose.applySidechainRotamer'].arguments.chiDegrees,
  /uniquely matched/);
assert.match(api.describe().actions['pose.applySidechainRotamer'].arguments.coordinateSha256,
  /SHA-256/);
assert.match(api.describe().actions['pose.apply'].arguments.allowInfeasible,
  /false by default/);
assert.match(api.describe().actions['pose.refine'].arguments.expectedSelectedCoordinateSha256,
  /SHA-256/);
assert.match(api.describe().actions['pose.apply'].arguments.expectedOutputCoordinateSha256,
  /SHA-256/);
assert.match(api.describe().actions['optimization.run'].arguments.expectedInputCoordinateSha256,
  /SHA-256/);
assert.match(api.describe().actions['pose.refine'].arguments.expectedSelectedStateSha256,
  /molecular-state-hash\/v1/);
assert.match(api.describe().actions['pose.apply'].arguments.expectedOutputStateSha256,
  /atomic output guard/);
assert.match(api.describe().actions['optimization.run'].arguments.expectedInputStateSha256,
  /preferred input guard/);
assert(Object.hasOwn(api.describe().actions, 'structureStory.selectFrame'));
assert.match(api.describe().actions['session.inspect'].arguments.scope, /pocket/);
assert.match(api.describe().actions['view.setMode'].description, /View, Design, or Simulate/);
assert.equal(api.describe().actions['view.setMode'].arguments.mode, 'view | build | run');
assert.match(api.describe().actions['pose.refine'].arguments.featureSeedingProtocol,
  /v3 \| v4 \| v5.*default v5/);
assert(!Object.hasOwn(api.describe().actions, 'test.loadObject'));
assert.match(api.describe().guarantee, /no arbitrary code/);
assert.match(api.describe().guarantee, /every saved replay and visible playback control executes only public routes/i);

const appSource = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
assert.match(appSource,
  /resolveCampaignAssetSource\(args\.sourcePath, args\.sourceSha256, location\.href\)/);
assert.match(appSource, /Campaign asset integrity check failed/);
assert.match(appSource, /if \(state\.designerMoveReplaying\)[\s\S]{0,200}saved publication replay/,
  'saved replays fail closed when selection-dependent chemistry omits persistent targets');
assert.match(appSource, /runChemistUiAction\('chemistry\.addHydrogen',\s*\{\s*atomId:/,
  'viewer Add-H records its persistent target');
assert.match(appSource, /selectDepictionAtomsThroughAction[\s\S]{0,320}selection\.replace/,
  '2D selection goes through the public selection action');
assert.match(appSource, /Applied refined-pose coordinates do not match expectedOutputCoordinateSha256/);
assert.match(appSource, /Optimized coordinates do not match expectedOutputCoordinateSha256/);
assert.match(appSource, /captureChemistActionGuardCheckpoint/);
assert.match(appSource, /restoreChemistActionGuardCheckpoint\(rollback\)/,
  'guard failure restores the complete captured action state');
assert.match(appSource, /stateHashSchema:MOLECULAR_STATE_HASH_SCHEMA/,
  'scientific action results identify their versioned identity-topology-coordinate hash');

const first = await api.execute({ requestId:'chemist-1', action:'view.setMode', args:{ mode:'build' } });
assert.equal(first.status, 'completed');
assert.deepEqual(calls[0], { action:'view.setMode', args:{ mode:'build' } });
await assert.rejects(() => api.execute({ action:'internal.scorePose', args:{} }), /Unknown chemist action/);
await assert.rejects(() => api.execute({ action:'view.setMode', args:{ callback:() => {} } }), /plain JSON/);
await assert.rejects(() => api.execute({ action:'view.setMode', args:{ value:Infinity } }), /finite/);
const polluted = Object.create(null); polluted.mode = 'build';
await assert.rejects(() => api.execute({ action:'view.setMode', args:polluted }), /plain JSON/);
const coordinateText = 'ATOM  '.repeat(20000);
await api.execute({ action:'session.loadStructure', args:{ content:coordinateText, format:'pdb' } });
assert.equal(calls.at(-1).args.content.length, coordinateText.length,
  'coordinate-bearing structure payloads are accepted above the old 32 KiB control limit');
const nestedReplay = { schema:'molarium.chemist-action-script/v1', label:'Nested replay fixture',
  actions:[{ action:'session.inspect', args:{ scope:'pocket' },
    expect:{ 'fixture.axes':[
      { chi:'chi1', atomNames:['N','CA','CB','CG'] },
      { chi:'chi2', atomNames:['CA','CB','CG','CD1'] },
    ] } }] };
await api.execute({ action:'designerScript.load', args:{ script:nestedReplay } });
assert.deepEqual(calls.at(-1).args.script, nestedReplay,
  'the public loader accepts the nested shape of an installed replay script');
let excessiveDepth = { value:true };
for (let depth = 0; depth < 13; depth++) excessiveDepth = { nested:excessiveDepth };
await assert.rejects(() => api.execute({ action:'designerScript.load',
  args:{ script:excessiveDepth } }), /input exceeds depth 12/);

const sizeRoutes = {
  'campaign.import':async () => ({ imported:true }),
  'view.setMode':async () => ({ mode:'view' }),
};
const sizeApi = createChemistActionsApi({ routes:sizeRoutes,
  enabledActions:Object.keys(sizeRoutes), historyLimit:1 });
const fullSystemCampaign = 'x'.repeat(9 * 1024 * 1024);
await sizeApi.execute({ action:'campaign.import',
  args:{ serialized:fullSystemCampaign } });
await assert.rejects(() => sizeApi.execute({ action:'campaign.import', args:{
  sourcePath:'./campaign.json', sourceSha256:'a'.repeat(64),
  padding:fullSystemCampaign,
} }), /input exceeds 8388608 bytes/,
'path-based campaign imports must use the normal small action envelope');
await assert.rejects(() => sizeApi.execute({ action:'view.setMode',
  args:{ padding:fullSystemCampaign } }), /input exceeds 8388608 bytes/);
assert.match(sizeApi.describe().actions['campaign.import'].arguments.serialized,
  /32 MiB/);
assert.match(sizeApi.describe().actions['campaign.import'].arguments.sourceSha256,
  /SHA-256/);

const order = [];
routes['chemistry.finish'] = undefined;
const serialRoutes = Object.fromEntries(Object.keys(CHEMIST_ACTION_DEFINITIONS).map((action) =>
  [action, async () => { order.push(`${action}:start`); await Promise.resolve(); order.push(`${action}:end`); return {}; }]));
const serial = createChemistActionsApi({ routes:serialRoutes });
await Promise.all([
  serial.execute({ action:'chemistry.finish' }),
  serial.execute({ action:'history.undo' }),
]);
assert.deepEqual(order, ['chemistry.finish:start','chemistry.finish:end','history.undo:start','history.undo:end']);

await api.execute({ action:'selection.clear' });
await api.execute({ action:'chemistry.setBond', args:{ order:1 } });
assert.equal(api.history().length, 3, 'audit history is bounded');
assert(api.history().every((record) => record.status === 'completed'));
const copy = api.history(); copy[0].action = 'tampered';
assert.notEqual(api.history()[0].action, 'tampered', 'history returns a defensive copy');
assert.equal(persisted.length, 5);
assert(persisted.every((record) => record.status === 'completed'),
  'accepted actions are offered to the durable audit adapter after completion');
assert(persisted.every((record) => record.result?.observed === record.action),
  'completed audit records preserve the public action result');

assert.throws(() => createChemistActionsApi({ routes:{} }), /route session.inspect is missing/);

const storyCalls = [];
const storyApi = createChemistActionsApi({
  enabledActions:CHEMIST_ACTION_SCOPES.structureStory,
  routes:Object.fromEntries(CHEMIST_ACTION_SCOPES.structureStory.map((action) =>
    [action, async (args) => { storyCalls.push({ action, args }); return { observed:action }; }])),
});
assert.deepEqual(Object.keys(storyApi.describe().actions), CHEMIST_ACTION_SCOPES.structureStory);
await storyApi.execute({ action:'structureStory.selectCue', args:{ cueId:'bound-start' } });
assert.deepEqual(storyCalls, [{ action:'structureStory.selectCue', args:{ cueId:'bound-start' } }]);
await assert.rejects(() => storyApi.execute({ action:'chemistry.finish' }), /Unknown chemist action/);
assert.throws(() => createChemistActionsApi({ routes:{}, enabledActions:['private.eval'] }),
  /Unknown enabled Chemist Actions route/);
console.log('Molarium Chemist Actions API: PASS');
