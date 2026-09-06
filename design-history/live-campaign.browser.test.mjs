import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  const offered = await execute('campaign.inspect');
  assert.equal(offered.result.campaign.active, false,
    'Design and inspection must not automatically activate a saved campaign');
  assert.equal(offered.result.campaign.savedCampaign.campaignId, 'browser-campaign');
  assert.equal(offered.result.molecule, null,
    'an explicitly blank startup must remain blank even with a saved campaign');
  await execute('campaign.resume');
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

  // Reproduce the reported public-site regression with a real saved SOS1
  // checkpoint, then revisit the ordinary LSD launch page in the same profile.
  const sos1Path = 'design-history/publications/sos1/checkpoints/starting-hit-campaign.json';
  const sos1Bytes = await readFile(resolve(root, sos1Path));
  const importedSos1 = await execute('campaign.import', { sourcePath:`./${sos1Path}`,
    sourceSha256:createHash('sha256').update(sos1Bytes).digest('hex') });
  const launchUrl = new URL(browser.appUrl); launchUrl.search = '';
  await browser.evaluate(`window.__molariumReloadSentinel = true; location.href = ${JSON.stringify(launchUrl.href)}; true`);
  await waitFor(async () => browser.evaluate(
    `document.readyState === 'complete' && !window.__molariumReloadSentinel
      && window.MolariumChemistActionsReady?.then((api) => Boolean(api?.execute))`),
    60000, 'fresh launch after saving SOS1');
  await waitFor(async () => (await execute('session.inspect')).result?.molecule?.name === 'LSD',
    30000, 'default LSD molecule');
  const inspectAll = () => execute('session.inspect', { scope:'all', includeCoordinates:true });
  const lsdBefore = (await inspectAll()).result;
  await browser.evaluate(`document.querySelector('.mode-bar button[data-mode="build"]').click(); true`);
  await waitFor(async () => browser.evaluate(
    `!document.querySelector('#campaign-resume-controls').classList.contains('hidden')`),
    30000, 'explicit saved-campaign resume offer');
  const savedSos1 = (await execute('campaign.inspect')).result;
  assert.equal(savedSos1.campaign.active, false);
  assert.equal(savedSos1.campaign.savedCampaign.campaignId,
    importedSos1.result.campaignImport.campaignId);
  for (const mode of ['view', 'build', 'run', 'build']) {
    await execute('view.setMode', { mode });
    const after = (await inspectAll()).result;
    assert.equal(after.molecule.name, 'LSD', 'mode changes must preserve the launch molecule');
    assert.deepEqual(after.atoms, lsdBefore.atoms, 'mode changes must preserve exact LSD coordinates and atom identities');
    assert.deepEqual(after.bonds, lsdBefore.bonds);
  }
  await browser.evaluate(`document.querySelector('#campaign-resume').click(); true`);
  await waitFor(async () => (await execute('campaign.inspect')).result.campaign.active,
    30000, 'explicit SOS1 resume');
  const resumedSos1 = (await execute('campaign.inspect')).result;
  assert.deepEqual(resumedSos1.molecule, importedSos1.result.molecule);
  assert.equal(resumedSos1.campaign.currentCommitId, importedSos1.result.campaignImport.commitId);

  console.log(`Live campaign ${productionBuild ? 'production' : 'source'} browser test passed: create/commit, branch checkout, merge, decision, explicit IndexedDB resume, blank/LSD preservation with saved SOS1, close/new, transactional import rejection`);
} finally {
  await browser.close();
}
