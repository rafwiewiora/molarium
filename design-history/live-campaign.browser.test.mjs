import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../scripts/headless-chrome.mjs';

const root = resolve(import.meta.dirname, '..');
const productionBuild = process.env.MOLARIUM_CAMPAIGN_DIST === '1';
const browser = await startMolariumBrowser({ root,
  appPath:productionBuild ? 'dist/?blank' : '?blank', width:1600, height:1000 });
const execute = (action, args = {}) => browser.evaluate(
  `window.MolariumChemistActionsReady.then((api) => api.execute(${JSON.stringify({ action, args })}))`);
const chemistActionsReady = () => browser.evaluate(
  `window.MolariumChemistActionsReady?.then((api) => Boolean(api?.execute))`);

const alaninePdb = `ATOM      1  N   ALA A   1      -1.458   0.000   0.000  1.00 20.00           N
ATOM      2  CA  ALA A   1       0.000   0.000   0.000  1.00 20.00           C
ATOM      3  C   ALA A   1       0.525   1.430   0.000  1.00 20.00           C
ATOM      4  O   ALA A   1      -0.225   2.380   0.000  1.00 20.00           O
ATOM      5  CB  ALA A   1       0.540  -0.770  -1.210  1.00 20.00           C
END`;

try {
  await waitFor(chemistActionsReady,
    60000, 'Chemist Actions API');
  await browser.evaluate(`(() => {
    document.querySelector('#structure-input').value = ${JSON.stringify(alaninePdb)};
    document.querySelector('#parse-button').click();
    return true;
  })()`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#info-atoms')?.textContent.includes('C 3')`),
  30000, 'test PDB load');
  await execute('view.setMode', { mode:'build' });

  const started = await execute('campaign.create', { campaignId:'browser-campaign',
    title:'Browser campaign', actorId:'chemist.browser', actorName:'Browser Chemist',
    initialCommitMessage:'Capture starting alanine' });
  assert.ok(started.result.campaignCommit?.commitId,
    'one campaign.create action must be able to commit the current molecule');
  assert.equal(started.result.campaign.campaign.commits, 1);

  const card = await browser.evaluate(`({
    visible:!document.querySelector('#design-history-panel').classList.contains('hidden'),
    createHidden:document.querySelector('#campaign-create-controls').classList.contains('hidden'),
    summary:document.querySelector('#campaign-summary').textContent,
    startLabel:document.querySelector('#campaign-create').textContent,
  })`);
  assert.equal(card.visible, true);
  assert.equal(card.createHidden, true);
  assert.match(card.summary, /Commits1/);
  assert.match(card.startLabel, /Start & commit/);
  if (process.env.MOLARIUM_CAMPAIGN_SCREENSHOT)
    await writeFile(process.env.MOLARIUM_CAMPAIGN_SCREENSHOT, await browser.capturePng());

  await execute('campaign.createBranch', { branch:'series.fluoro' });
  await execute('view.setMode', { mode:'view' });
  await execute('view.setMode', { mode:'build' });
  const branchCommit = await execute('campaign.commitCurrent', {
    message:'Record branch workspace actions' });
  assert.equal(branchCommit.result.campaignCommit.branch, 'series.fluoro');

  const switched = await execute('campaign.switchBranch', { branch:'main' });
  assert.equal(switched.result.campaignBranch.restored, true);
  assert.equal(switched.result.campaignBranch.branch, 'main');
  const merged = await execute('campaign.mergeBranch', { sourceBranch:'series.fluoro',
    targetBranch:'main', message:'Merge selected branch' });
  assert.ok(merged.result.campaignMerge.commitId);
  await execute('campaign.recordDecision', { disposition:'progressed',
    reasonCodes:['other'], rationale:'Advance the merged state' });
  const verified = await execute('campaign.verify');
  assert.equal(verified.result.campaignVerification.valid, true);
  assert.equal(verified.result.campaignVerification.commits, 3);

  const stored = await browser.evaluate(`new Promise((resolve, reject) => {
    const request = indexedDB.open('molarium-design-history', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(['campaigns','workspace'], 'readonly');
      const campaignRequest = transaction.objectStore('campaigns').get('browser-campaign');
      const workspaceRequest = transaction.objectStore('workspace').get('active-campaign');
      transaction.oncomplete = () => {
        const campaign = JSON.parse(campaignRequest.result.campaignJson);
        resolve({ actorName:campaign.actors[0].displayName,
          activeBranch:workspaceRequest.result.activeBranch,
          scripts:Object.values(campaign.objects.actionScripts).map((script) => ({
            expectedStartSnapshotId:script.expectedStartSnapshotId,
            expectedEndSnapshotId:script.expectedEndSnapshotId,
            coverage:script.coverage,
          })) });
      };
      transaction.onerror = () => reject(transaction.error);
    };
  })`);
  assert.equal(stored.actorName, 'Browser Chemist');
  assert.equal(stored.activeBranch, 'main');
  assert.ok(stored.scripts.length >= 1);
  assert.ok(stored.scripts.every((script) => script.expectedStartSnapshotId === null
    && script.expectedEndSnapshotId === null
    && script.coverage?.kind === 'public-actions-only'
    && script.coverage?.complete === false));

  await browser.evaluate(`window.__molariumReloadSentinel = true; location.reload(); true`);
  await waitFor(async () => browser.evaluate(
    `document.readyState === 'complete' && !window.__molariumReloadSentinel
      && window.MolariumChemistActionsReady?.then((api) => Boolean(api?.execute))`),
    60000, 'reloaded Chemist Actions API');
  await execute('view.setMode', { mode:'build' });
  const restored = await execute('campaign.inspect');
  assert.equal(restored.result.campaign.active, true);
  assert.equal(restored.result.campaign.currentBranch, 'main');
  assert.equal(restored.result.campaign.campaign.commits, 3);
  assert.match(restored.result.molecule.name, /PDB structure/);

  await execute('campaign.close');
  const closed = await execute('campaign.inspect');
  assert.equal(closed.result.campaign.active, false);
  const restarted = await execute('campaign.create', { campaignId:'browser-campaign-2',
    title:'Second browser campaign', initialCommitMessage:'Start another campaign' });
  assert.ok(restarted.result.campaignCommit.commitId,
    'closing a campaign must permit a new one without deleting the first');

  await browser.evaluate(`new Promise((resolve, reject) => {
    const request = indexedDB.open('molarium-design-history', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('campaigns', 'readonly');
      const recordRequest = transaction.objectStore('campaigns').get('browser-campaign');
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        const campaign = JSON.parse(recordRequest.result.campaignJson);
        const snapshot = campaign.objects.snapshots[Object.keys(campaign.objects.snapshots)[0]];
        snapshot.label += ' tampered';
        const transfer = new DataTransfer();
        transfer.items.add(new File([JSON.stringify(campaign)], 'tampered.campaign.json',
          { type:'application/json' }));
        const input = document.querySelector('#campaign-file');
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles:true }));
        resolve(true);
      };
    };
  })`);
  await waitFor(async () => browser.evaluate(
    `document.querySelector('#campaign-status')?.textContent.includes('Campaign is invalid')`),
  30000, 'transactional import rejection');
  const afterRejectedImport = await execute('campaign.inspect');
  assert.equal(afterRejectedImport.result.campaign.campaign.campaignId, 'browser-campaign-2',
    'a rejected import must preserve the active in-memory campaign');
  const activeAfterRejectedImport = await browser.evaluate(`new Promise((resolve, reject) => {
    const request = indexedDB.open('molarium-design-history', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction('workspace', 'readonly');
      const workspaceRequest = transaction.objectStore('workspace').get('active-campaign');
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve(workspaceRequest.result.campaignId);
    };
  })`);
  assert.equal(activeAfterRejectedImport, 'browser-campaign-2',
    'a rejected import must preserve the active durable workspace');

  console.log(`Live campaign ${productionBuild ? 'production' : 'source'} browser test passed: create/commit, branch checkout, merge, decision, IndexedDB restore, close/new, transactional import rejection`);
} finally {
  await browser.close();
}
