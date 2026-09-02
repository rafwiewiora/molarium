import assert from 'node:assert/strict';
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
assert(Object.hasOwn(api.describe().actions, 'view.setDisplay'));
assert(Object.hasOwn(api.describe().actions, 'pose.addContact'));
assert(Object.hasOwn(api.describe().actions, 'pose.forgetContact'));
assert(Object.hasOwn(api.describe().actions, 'pose.updateReceptorReference'));
assert(Object.hasOwn(api.describe().actions, 'pose.enumerateSidechainRotamers'));
assert(Object.hasOwn(api.describe().actions, 'pose.applySidechainRotamer'));
assert(Object.hasOwn(api.describe().actions, 'structureStory.selectFrame'));
assert.match(api.describe().actions['session.inspect'].arguments.scope, /pocket/);
assert(!Object.hasOwn(api.describe().actions, 'test.loadObject'));
assert.match(api.describe().guarantee, /no arbitrary code/);

const first = await api.execute({ requestId:'chemist-1', action:'view.setMode', args:{ mode:'build' } });
assert.equal(first.status, 'completed');
assert.deepEqual(calls[0], { action:'view.setMode', args:{ mode:'build' } });
await assert.rejects(() => api.execute({ action:'internal.scorePose', args:{} }), /Unknown chemist action/);
await assert.rejects(() => api.execute({ action:'view.setMode', args:{ callback:() => {} } }), /plain JSON/);
await assert.rejects(() => api.execute({ action:'view.setMode', args:{ value:Infinity } }), /finite/);
const polluted = Object.create(null); polluted.mode = 'build';
await assert.rejects(() => api.execute({ action:'view.setMode', args:polluted }), /plain JSON/);

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
assert.equal(persisted.length, 3);
assert(persisted.every((record) => record.status === 'completed'),
  'accepted actions are offered to the durable audit adapter after completion');

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
