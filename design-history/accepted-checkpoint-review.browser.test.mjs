import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { acceptedCheckpointReviewScript } from './accepted-checkpoint-review.mjs';
import { commitMolecule, createCampaign, finalizeCampaign, storeSnapshot } from './ledger.mjs';
import { serializeCampaign } from './live-campaign-store.mjs';
import { startMolariumBrowser, waitFor } from '../scripts/headless-chrome.mjs';

async function acceptedFixture(index) {
  const occurredAt = `2026-02-0${index + 1}T00:00:00.000Z`;
  const campaign = createCampaign({
    campaignId:`accepted-browser-checkpoint-${index}`,
    title:`Accepted source checkpoint ${index}`,
    createdAt:occurredAt,
    actors:[{ id:'agent.fixture', type:'agent', displayName:'Fixture agent' }],
  });
  const snapshotId = await storeSnapshot(campaign, {
    label:`accepted state ${index}`,
    graph:{ atoms:[
      { atomId:'L:C1', element:'C', formalCharge:0, record:'HETATM',
        residueName:'LIG', chain:'A', residueIndex:1 },
      { atomId:'L:N1', element:'N', formalCharge:0, record:'HETATM',
        residueName:'LIG', chain:'A', residueIndex:1 },
      { atomId:'A:10:CA', element:'C', formalCharge:0, record:'ATOM',
        atomName:'CA', residueName:'PHE', chain:'A', residueIndex:10 },
    ], bonds:[{ atomIds:['L:C1','L:N1'], order:1 }] },
    coordinates:{ unit:'angstrom', atomIds:['L:C1','L:N1','A:10:CA'],
      positions:[[index,0,0],[index + 1,0,0],[0,index,0]] },
  });
  const commitId = await commitMolecule(campaign, { snapshotId, parents:[], branch:'main',
    message:`Accepted checkpoint ${index}`, actorId:'agent.fixture', occurredAt,
    tags:['accepted','pre-holdout'] });
  await finalizeCampaign(campaign, { finalizedAt:`2026-02-0${index + 1}T00:01:00.000Z`,
    actorId:'agent.fixture' });
  const serializedCampaign = serializeCampaign(campaign);
  return { accepted:true, frozenBeforeHoldoutAccess:true,
    checkpointSha256:String(index).repeat(64),
    campaignSha256:createHash('sha256').update(serializedCampaign).digest('hex'),
    serializedCampaign, branch:'main', commitId, snapshotId,
    label:`accepted state ${index}` };
}

const source = [await acceptedFixture(1), await acceptedFixture(2)];
const script = await acceptedCheckpointReviewScript({
  label:'Calculation-free accepted checkpoint review', checkpoints:source,
});
const browser = await startMolariumBrowser({
  root:resolve(import.meta.dirname, '..'), appPath:'?blank=1', width:1280, height:800,
});

try {
  await waitFor(async () => browser.evaluate(`Boolean(window.MolariumChemistActionsReady)`),
    30000, 'Molarium API');
  const initial = await browser.evaluate(`({
    moleculeHidden:document.querySelector('#molecule-info').classList.contains('hidden'),
    sceneHidden:document.querySelector('.scene-card').classList.contains('hidden'),
  })`);
  assert.equal(initial.moleculeHidden, true);
  assert.equal(initial.sceneHidden, true);

  await browser.evaluate(`(async (script) => {
    const api = await window.MolariumChemistActionsReady;
    await api.execute({ action:'designerScript.load', args:{ script } });
    await api.execute({ action:'designerScript.play', args:{ playing:true } });
  })(${JSON.stringify(script)})`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-tools')?.dataset.replayStatus === 'completed'`),
  30000, 'completed checkpoint review');

  const inspect = async () => browser.evaluate(`(async () => {
    const api = await window.MolariumChemistActionsReady;
    const result = await api.execute({ action:'session.inspect', args:{
      scope:'all', includeCoordinates:true, maximumAtoms:500,
    } });
    return result.result;
  })()`);
  const finalState = await inspect();
  const completed = await browser.evaluate(`({
    progress:document.querySelector('#designer-move-progress-label').textContent,
    previousDisabled:document.querySelector('#previous-designer-move').disabled,
    nextDisabled:document.querySelector('#next-designer-move').disabled,
    playLabel:document.querySelector('#replay-designer-moves').textContent,
    detail:document.querySelector('#designer-move-detail').textContent,
    status:document.querySelector('#campaign-status').textContent,
    calculations:window.MolariumChemistActions.history().filter((entry) =>
      /^(pose\.refine|optimization\.|calculation\.|protein\.prepare)/.test(entry.action)),
  })`);
  assert.equal(completed.progress.trim(), '2 / 2');
  assert.equal(completed.previousDisabled, false);
  assert.equal(completed.nextDisabled, true);
  assert.match(completed.playLabel, /Replay story/);
  assert.deepEqual(completed.calculations, []);
  assert.match(completed.status, /Accepted source checkpoint 2/);

  await browser.evaluate(`document.querySelector('#previous-designer-move').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-progress-label').textContent.trim() === '1 / 2'`),
  10000, 'previous immutable checkpoint');
  const firstState = await inspect();
  assert.notDeepEqual(firstState.atoms.map((atom) => atom.coordinatesAngstrom),
    finalState.atoms.map((atom) => atom.coordinatesAngstrom));
  assert.deepEqual(firstState.atoms.map((atom) => atom.coordinatesAngstrom),
    [[1,0,0],[2,0,0],[0,1,0]]);
  assert.match(await browser.evaluate(
    `document.querySelector('#campaign-status').textContent`), /Accepted source checkpoint 1/);

  await browser.evaluate(`document.querySelector('#next-designer-move').click()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#designer-move-progress-label').textContent.trim() === '2 / 2'`),
  10000, 'next immutable checkpoint');
  const restoredFinalState = await inspect();
  assert.deepEqual(restoredFinalState.atoms.map((atom) => atom.coordinatesAngstrom),
    finalState.atoms.map((atom) => atom.coordinatesAngstrom));
  assert.match(await browser.evaluate(
    `document.querySelector('#campaign-status').textContent`), /Accepted source checkpoint 2/);
  assert.match(await browser.evaluate(
    `document.querySelector('#designer-move-detail').textContent`), /calculation-free review/i);

  console.log('Accepted checkpoint review browser test: PASS');
} finally {
  await browser.close();
}
