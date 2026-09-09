import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';
import { SOS1_CONTACT_RELEASE } from '../design-history/sos1-recompute-revision.mjs';

// Reproduce the final transition from a hash-pinned native AWW checkpoint,
// through public actions. No new contact policy and no relaxed acceptance gate.
const root = resolve(import.meta.dirname, '..');
const publication = 'design-history/publications/sos1/designer-intent-2026-09-04';
const review = JSON.parse(await readFile(resolve(root, publication,
  'checkpoint-review.action-script.json')));
const source = review.actions.find((entry) => entry.args.sourcePath.includes('aww-phe890-response'));
assert(source);
const release = JSON.parse(await readFile(resolve(root, publication, 'release.json')));
const auditDescriptor = release.evidence.find((entry) => entry.path.endsWith('/027-chemist-action-audit.json.gz'));
assert(auditDescriptor);
const auditBytes = await readFile(resolve(root, auditDescriptor.path));
assert.equal(createHash('sha256').update(auditBytes).digest('hex'), auditDescriptor.sha256);
const audit = JSON.parse(gunzipSync(auditBytes));
const originalContact = (sequence) => audit.records.find((entry) => entry.sequence === sequence)
  .result.contacts.find((entry) => entry.label === 'AWW A1104 OX3 → TYR A884 O');
assert.equal(originalContact(9).required, true);
assert.equal(originalContact(9).available, true);
assert.equal(originalContact(12).required, false, 'historical omission is evidence, not a policy to reinstate');
assert.equal(originalContact(12).available, false);
const browser = await startMolariumBrowser({ root, appPath:'?blank=1' });
try {
  await waitFor(() => browser.evaluate('Boolean(window.MolariumChemistActionsReady)'), 90000, 'API');
  await browser.evaluate('window.MolariumChemistActionsReady.then(() => true)');
  const execute = async (action, args = {}) => {
    console.log(action);
    return browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({ action, args })})`);
  };
  await execute(source.action, source.args);
  await execute('designRoute.resume', { routeId:'sos1-hit-only', stateId:'AWW' });
  await execute('protein.parameterize');
  await execute('view.setMode', { mode:'build' });
  await execute('pose.setDesignerLigandPoseFixed', { fixed:false });
  await execute('pose.captureReference', { mode:'propagate' });
  const inspect = async () => (await execute('session.inspect', { scope:'ligand', maximumAtoms:256 })).result;
  const before = await inspect();
  const oldContact = before.contacts.find((entry) => entry.label === 'AWW A1104 OX3 → TYR A884 O');
  assert(oldContact?.required && oldContact.available, 'native AWW captures the old oxygen contact');
  const staged = await execute('designRoute.applyStep', { stepId:'finish-bay-293' });
  const after = await inspect();
  const unresolved = after.contacts.find((entry) => entry.contactId === oldContact.contactId);
  assert.equal(unresolved.required, true, 'graph availability must not silently change intent');
  assert.equal(unresolved.available, false);
  assert(staged.result.designStep.contactPolicy.unresolvedRequiredContactIds.includes(oldContact.contactId));
  let failure = '';
  try { await execute('pose.refine', { execution:'serial', featureSeedingProtocol:'v5', searchChains:8 }); }
  catch (error) { failure = error.message; }
  assert.match(failure, /OX3 → TYR A884 O/);
  assert.match(failure, /no constraint was dropped/);
  const stopped = await inspect();
  assert.deepEqual(stopped.contacts, after.contacts, 'failed preflight leaves all requirements intact');
  const released = await execute(SOS1_CONTACT_RELEASE.action, SOS1_CONTACT_RELEASE.args);
  assert.equal(released.result.contactId, oldContact.contactId);
  assert.equal(released.result.required, false);
  const releasedState = await inspect();
  assert.deepEqual(releasedState.contacts.filter((entry) => entry.contactId !== oldContact.contactId),
    after.contacts.filter((entry) => entry.contactId !== oldContact.contactId));
  assert.deepEqual(releasedState.atoms, after.atoms);
  assert.deepEqual(releasedState.bonds, after.bonds);
  assert.equal(await browser.evaluate(`document.querySelector('input[data-constraint-id="${oldContact.contactId}"]').checked`), false);
  const absent = await execute('pose.setContact', { contactLabel:'absent regression hypothesis', required:false, ifAbsent:'record-omission' });
  assert.equal(absent.result.absent, true);
  assert.deepEqual((await inspect()).contacts, releasedState.contacts);
  if (process.env.MOLARIUM_FINAL_CONTACT_FULL === '1') {
    // Execute the original remaining scientific actions and EXACT expectations.
    // This is a final-transition rerun, not a new execution of the preceding hit→AWW route.
    await browser.evaluate(`window.sr07Done = false;
      (async () => {
        const source = await (await fetch('./${publication}/executable.action-script.json')).json();
        const start = source.actions.findIndex(s => s.action === 'designRoute.applyStep' && s.args.stepId === 'finish-bay-293');
        const { replayActionScript } = await import('./design-history/replay.mjs');
        window.sr07Replay = await replayActionScript(window.MolariumChemistActions,
          { schema:source.schema, label:'SR-07 final transition with explicit release', actions:source.actions.slice(start + 1) });
        window.sr07Done = true;
      })().catch(error => { window.sr07Error = String(error); window.sr07Done = true; }); true;`);
    await waitFor(() => browser.evaluate('window.sr07Done'), 1800000, 'final scientific transition');
    const result = await browser.evaluate(`({ error:window.sr07Error, status:window.sr07Replay?.status,
      steps:window.sr07Replay?.steps.map(s => ({ action:s.action, status:s.status, error:s.error,
        refinement:s.result?.refinement, optimization:s.result?.optimization })) })`);
    console.log(JSON.stringify(result, null, 2));
    assert.equal(result.error, undefined);
    assert.equal(result.status, 'completed');
  }
  console.log(JSON.stringify({ finding:'SR-07', contactId:oldContact.contactId,
    before:{ required:oldContact.required, available:oldContact.available },
    after:{ required:unresolved.required, available:unresolved.available },
    unresolvedRequiredContactIds:staged.result.designStep.contactPolicy.unresolvedRequiredContactIds,
    failure }, null, 2));
} finally { await browser.close(); }
