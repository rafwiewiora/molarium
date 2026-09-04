import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { acceptedCheckpointReviewScript, acceptedInspectionCheckpointReviewScript } from
  './accepted-checkpoint-review.mjs';
import { commitMolecule, createCampaign, storeSnapshot, verifyCampaign } from './ledger.mjs';
import { serializeCampaign } from './live-campaign-store.mjs';

async function fixture(index) {
  const occurredAt = `2026-01-0${index + 1}T00:00:00.000Z`;
  const campaign = createCampaign({
    campaignId:`accepted-review-${index}`,
    title:`Accepted checkpoint ${index}`,
    createdAt:occurredAt,
    actors:[{ id:'agent.fixture', type:'agent', displayName:'Fixture agent' }],
  });
  const snapshotId = await storeSnapshot(campaign, {
    label:`checkpoint ${index}`,
    graph:{ atoms:[
      { atomId:'L:C1', element:'C', formalCharge:0, record:'HETATM', residueName:'LIG' },
      { atomId:'L:N1', element:'N', formalCharge:0, record:'HETATM', residueName:'LIG' },
    ], bonds:[{ atomIds:['L:C1','L:N1'], order:1 }] },
    coordinates:{ unit:'angstrom', atomIds:['L:C1','L:N1'],
      positions:[[index,0,0],[index + 1,0,0]] },
  });
  const commitId = await commitMolecule(campaign, { snapshotId, parents:[], branch:'main',
    message:`Accept checkpoint ${index}`, actorId:'agent.fixture', occurredAt,
    tags:['accepted','pre-holdout'] });
  assert.equal((await verifyCampaign(campaign)).valid, true);
  const serializedCampaign = serializeCampaign(campaign);
  return { accepted:true, frozenBeforeHoldoutAccess:true,
    checkpointSha256:String(index).repeat(64),
    campaignSha256:createHash('sha256').update(serializedCampaign).digest('hex'),
    serializedCampaign, branch:'main', commitId, snapshotId,
    label:`checkpoint ${index}` };
}

const checkpoints = [await fixture(1), await fixture(2)];
const script = await acceptedCheckpointReviewScript({ label:'Accepted states', checkpoints });
assert.deepEqual(script.actions.map(({ action }) => action), ['campaign.import','campaign.import']);
assert.equal(script.provenance.promotable, false);
assert.equal(script.provenance.calculationPolicy, 'none');
assert.equal(script.provenance.holdoutCoordinatesIncluded, false);
assert(script.actions.every((step) => step.review.immutableSnapshot
  && step.review.sourceStatus === 'accepted' && step.review.promotable === false));
assert(!JSON.stringify(script).includes('pose.refine'));
assert(!JSON.stringify(script).includes('optimization.run'));
assert(!JSON.stringify(script).includes('directCoordinates'));

const inspectionScript = await acceptedInspectionCheckpointReviewScript({
  label:'Accepted inspections', checkpoints:[1,2].map((index) => ({
    accepted:true, frozenBeforeHoldoutAccess:true,
    checkpointSha256:String(index).repeat(64), label:`inspection ${index}`,
    ligand:{ atoms:[{ atomId:'L:C1' },{ atomId:'L:N1' }], bonds:[{
      atomIds:['L:C1','L:N1'], order:1,
    }] },
    pocket:{ truncated:false, totalAtomCount:3, atoms:[
      { atomId:'L:C1', atomName:'C1', element:'C', residueName:'LIG',
        coordinatesAngstrom:[index,0,0] },
      { atomId:'L:N1', atomName:'N1', element:'N', residueName:'LIG',
        coordinatesAngstrom:[index + 1,0,0] },
      { atomId:'A:10:CA', atomName:'CA', element:'C', residueName:'PHE', chain:'A',
        residueIndex:10, coordinatesAngstrom:[0,index,0] },
    ], bonds:[{ atomIds:['L:C1','L:N1'], order:1 }] },
  })) });
assert.deepEqual(inspectionScript.actions.map((step) => step.action),
  ['campaign.import','campaign.import']);
assert(inspectionScript.actions.every((step) =>
  !step.args.serialized.includes('directCoordinates')));

await assert.rejects(() => acceptedCheckpointReviewScript({ checkpoints:[{
  ...checkpoints[0], accepted:false,
}] }), /not an accepted scientific result/);
await assert.rejects(() => acceptedCheckpointReviewScript({ checkpoints:[{
  ...checkpoints[0], campaignSha256:'f'.repeat(64),
}] }), /campaign bytes do not match/);

console.log('Accepted checkpoint review builder test: PASS');
