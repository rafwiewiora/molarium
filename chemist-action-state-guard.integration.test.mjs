import assert from 'node:assert/strict';
import { createChemistActionsApi, CHEMIST_ACTIONS_SCHEMA } from './chemist-actions.mjs';
import { actionScriptFromAudit, replayActionScript } from './design-history/replay.mjs';
import { MOLECULAR_STATE_HASH_SCHEMA, molecularStateSha256 } from './molecular-state-hash.mjs';

const molecule = (suffix, x) => ({ charge:0, multiplicity:1, atoms:[
  { designAtomId:`ligand:C1:${suffix}`, element:'C', formalCharge:0,
    atomName:'C1', record:'HETATM', chain:'A', residueName:'LIG', residueIndex:'1',
    x, y:0, z:0 },
  { designAtomId:`ligand:N1:${suffix}`, element:'N', formalCharge:0,
    atomName:'N1', record:'HETATM', chain:'A', residueName:'LIG', residueIndex:'1',
    x:x + 1.3, y:0, z:0 },
], bonds:[{ a:0, b:1, order:1 }] });

const hashes = {
  input:await molecularStateSha256(molecule('stable', 0)),
  selected:await molecularStateSha256(molecule('stable', 0.2)),
  applied:await molecularStateSha256(molecule('stable', 0.21)),
  optimized:await molecularStateSha256(molecule('stable', 0.19)),
};
const results = {
  'pose.refine':{ refinement:{ stateHashSchema:MOLECULAR_STATE_HASH_SCHEMA,
    inputStateSha256:hashes.input, selectedStateSha256:hashes.selected } },
  'pose.apply':{ appliedPose:{ stateHashSchema:MOLECULAR_STATE_HASH_SCHEMA,
    inputStateSha256:hashes.input, selectedStateSha256:hashes.selected,
    outputStateSha256:hashes.applied } },
  'optimization.run':{ optimization:{ stateHashSchema:MOLECULAR_STATE_HASH_SCHEMA,
    inputStateSha256:hashes.applied, outputStateSha256:hashes.optimized } },
};
const originalRequests = [
  { action:'pose.refine', args:{ searchChains:16, execution:'serial',
    featureSeedingProtocol:'v5' } },
  { action:'pose.apply', args:{ index:0 } },
  { action:'optimization.run', args:{ method:'induced-fit-webgpu' } },
];

// Use the real public executor and its durable-record callback. The callback
// deliberately performs the same JSON serialization boundary used by saved
// audits so this test cannot pass merely because object identity was retained.
const serializedRecords = [];
const routes = Object.fromEntries(Object.keys(results).map((action) => [action,
  async () => structuredClone(results[action]) ]));
const api = createChemistActionsApi({ enabledActions:Object.keys(results), routes,
  now:() => '2026-09-03T00:00:00.000Z', monotonicNow:() => 0,
  recordAudit:(record) => serializedRecords.push(JSON.stringify(record)) });
for (const [index, request] of originalRequests.entries())
  await api.execute({ ...request, requestId:`guard-integration-${index + 1}` });

const audit = JSON.parse(JSON.stringify({ schema:CHEMIST_ACTIONS_SCHEMA,
  routeId:'state-guard-integration', records:serializedRecords.map(JSON.parse) }));
const script = actionScriptFromAudit(audit, { stateHashGuards:'required' });
assert.deepEqual(script.actions.map((step) => step.args), [
  { ...originalRequests[0].args, expectedInputStateSha256:hashes.input,
    expectedSelectedStateSha256:hashes.selected },
  { ...originalRequests[1].args, expectedInputStateSha256:hashes.input,
    expectedSelectedStateSha256:hashes.selected,
    expectedOutputStateSha256:hashes.applied },
  { ...originalRequests[2].args, expectedInputStateSha256:hashes.applied,
    expectedOutputStateSha256:hashes.optimized },
]);
assert.deepEqual(script.sourceAudit.stateHashGuards, {
  mode:'required', schema:MOLECULAR_STATE_HASH_SCHEMA, guardedActionCount:3,
});

// Replay the generated requests through another real public executor. These
// adapters stand in for the app routes and reject any lost or rewritten guard.
const replayCalls = [];
const replayApi = createChemistActionsApi({ enabledActions:Object.keys(results),
  routes:Object.fromEntries(Object.keys(results).map((action) => [action, async (args) => {
    replayCalls.push({ action, args:structuredClone(args) });
    return structuredClone(results[action]);
  }])) });
await replayActionScript(replayApi, script);
assert.deepEqual(replayCalls, script.actions.map(({ action, args }) => ({ action, args })));

console.log('Chemist Action audit state-guard integration: PASS');

await import('./docking/refinement-capture.integration.test.mjs');
