import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createChemistActionsApi } from '../chemist-actions.mjs';
import { commitLiveMolecule, createLiveCampaign } from '../design-history/live-campaign.mjs';
import {
  createMemoryRefinementCaptureStore,
  createRefinementCapture,
  refinementCaptureDescriptor,
  verifyRefinementCapture,
} from './refinement-capture-store.mjs';

const inputStateSha256 = '1'.repeat(64);
const selectedStateSha256 = '2'.repeat(64);
const atomIds = ['ligand:C1', 'ligand:N1'];
const positions = new Float64Array([0.2, 0, 0, 1.5, 0.1, 0]);
const selectedCoordinateDigest = await globalThis.crypto.subtle.digest('SHA-256', positions.buffer);
const selectedCoordinateSha256 = [...new Uint8Array(selectedCoordinateDigest)]
  .map((byte) => byte.toString(16).padStart(2, '0')).join('');
const liveMolecule = { atoms:[
  { designAtomId:atomIds[0], x:0, y:0, z:0 },
  { designAtomId:atomIds[1], x:1.3, y:0, z:0 },
] };
const unchanged = structuredClone(liveMolecule);
const store = createMemoryRefinementCaptureStore();

const routes = {
  'pose.refine':async () => {
    const record = await createRefinementCapture({ inputStateSha256,
      selectedStateSha256, selectedCoordinateSha256, atomIds, positions,
      selectedRank:3, selectedFeasible:false });
    await store.save(record);
    // Model an expected-selected or workflow gate that rejects after the
    // calculation. The persisted candidate must survive this failure.
    throw new Error('Selected refined pose does not match expectedSelectedStateSha256');
  },
  'pose.inspectRefinementCapture':async (args) => {
    const record = args.captureId ? await store.load(args.captureId) : await store.latest();
    if (!record) throw new Error('No refined-pose capture has been saved');
    return { refinementCapture:args.includeCoordinates
      ? record.capture : refinementCaptureDescriptor(record) };
  },
};
const api = createChemistActionsApi({ routes, enabledActions:Object.keys(routes) });
await assert.rejects(() => api.execute({ action:'pose.refine', args:{ searchChains:8 } }),
  /does not match expectedSelectedStateSha256/);

assert.deepEqual(liveMolecule, unchanged,
  'automatic candidate capture must not apply or mutate the live molecule');
const compact = await api.execute({ action:'pose.inspectRefinementCapture', args:{} });
assert.equal(compact.result.refinementCapture.promotable, false);
assert.equal(compact.result.refinementCapture.selectedFeasible, false);
assert.equal(compact.result.refinementCapture.selectedCoordinateSha256,
  selectedCoordinateSha256);
assert(!JSON.stringify(compact.result).includes('positions'),
  'ordinary API and audit payloads must contain only the compact descriptor');

const captureId = compact.result.refinementCapture.captureId;
const review = await api.execute({ action:'pose.inspectRefinementCapture',
  args:{ captureId, includeCoordinates:true } });
assert.deepEqual(review.result.refinementCapture.positions, Array.from(positions));
assert.deepEqual(review.result.refinementCapture.atomIds, atomIds);
assert.equal(review.result.refinementCapture.disposition, 'unapplied-candidate');
assert.equal(review.result.refinementCapture.promotable, false);
assert.deepEqual(await verifyRefinementCapture(await store.load(captureId)),
  { valid:true, captureId });

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const saveAt = appSource.indexOf('.save(refinementCapture);');
const guardAt = appSource.indexOf('if ((expectedSelected != null');
assert(saveAt > 0 && guardAt > saveAt,
  'pose.refine must persist the selected candidate before its output guard can throw');
assert.match(appSource,
  /state\.molecule\?\.source\?\.docking\?\.feasible === false[\s\S]{0,160}cannot be committed or promoted/,
  'an explicitly applied infeasible result must remain noncommittable');
const campaign = await createLiveCampaign({ campaignId:'infeasible-capture-test',
  title:'Infeasible capture test', actorId:'chemist.test',
  createdAt:'2026-09-04T00:00:00.000Z' });
await assert.rejects(() => commitLiveMolecule(campaign, {
  molecule:{ ...structuredClone(liveMolecule), source:{ docking:{ feasible:false } },
    bonds:[], charge:0, multiplicity:1 },
  message:'Must not commit', actorId:'chemist.test',
  occurredAt:'2026-09-04T00:00:01.000Z',
}), /cannot be committed or promoted/);

console.log('Refined-pose automatic capture survives failed guards without mutating state');
