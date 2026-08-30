import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildManualContactPanelManifest } from './7kpa-manual-contact-panel.mjs';
import { operationActions, validatePanelManifest } from './7kpa-two-terminus-panel.mjs';

const manifest = await buildManualContactPanelManifest();
const validated = await validatePanelManifest(manifest);
assert.equal(validated.cases, 10);
assert.deepEqual(validated.loci, { dual:1, pyridone:4, pyrrolidone:5 });

for (const entry of manifest.cases) {
  const forgets = entry.operations.filter((operation) => operation.op === 'forgetContact');
  const additions = entry.operations.filter((operation) => operation.op === 'addContact');
  assert(forgets.length >= 1, `${entry.id}: old contact is never explicitly forgotten`);
  assert.equal(additions.length, forgets.length,
    `${entry.id}: every forgotten pharmacophore must have one explicit replacement`);
  for (const addition of additions) {
    const forgetIndex = entry.operations.findIndex((operation) =>
      operation.op === 'forgetContact' && operation.contact === addition.contact);
    const addIndex = entry.operations.indexOf(addition);
    assert(forgetIndex >= 0 && forgetIndex < addIndex,
      `${entry.id}: replacement is asserted before its predecessor is forgotten`);
    assert(entry.operations.slice(forgetIndex + 1, addIndex).some((operation) =>
      ['addAtom','setAtom'].includes(operation.op)),
    `${entry.id}: contact recapture does not follow a chemist-visible feature edit`);
  }
  assert(entry.operations.every((operation) => operationActions[operation.op]),
    `${entry.id}: an operation has no public Chemist Actions route`);
}

const elementFamilies = new Set(manifest.cases.flatMap((entry) => entry.operations
  .filter((operation) => operation.op === 'addAtom')
  .map((operation) => operation.element)));
assert.deepEqual([...elementFamilies].sort(), ['C','O','S']);
assert(manifest.cases.some((entry) => entry.name.includes('pyrazole')));
assert(manifest.cases.some((entry) => entry.name.includes('tetrahydropyran')));
assert(manifest.cases.some((entry) => entry.name.includes('sultam')));
assert(manifest.cases.some((entry) => entry.intendedRoles.includes('donor')
  && entry.intendedRoles.includes('acceptor')));

const smoke = JSON.parse(await readFile(new URL('./7kpa-manual-contact-smoke.v0.1.json',
  import.meta.url)));
const results = JSON.parse(await readFile(new URL(
  './7kpa-manual-contact-results.psiblue.v0.1.json', import.meta.url)));
assert.equal(smoke.schema, 'molarium.7kpa.manual-contact-smoke/v1');
assert.equal(smoke.panelId, manifest.panelId);
assert(manifest.cases.some((entry) => entry.id === smoke.caseId));
assert.equal(smoke.chemistry.productGraphMatchesExpected, true);
assert.equal(smoke.outcome.candidateCount, 8);
assert.equal(smoke.outcome.feasibleCount, 8);
assert.equal(smoke.outcome.allRequiredHydrogenBondsSatisfied, true);
assert.equal(smoke.audit.labbookValid, true);
for (const field of ['protocolSha256','labbookSha256','manifestSha256','rawResultSha256'])
  assert.match(smoke.audit[field], /^[a-f0-9]{64}$/, `${field}: invalid SHA-256`);
for (const action of ['chemistry.deleteAtom','chemistry.finish','pose.forgetContact',
  'chemistry.addAtom','chemistry.setBond','pose.addContact','pose.refine'])
  assert(smoke.audit.orderedActions.includes(action), `smoke evidence omits ${action}`);

assert.equal(results.schema, 'molarium.7kpa.manual-contact-panel-evidence/v1');
assert.equal(results.panelId, manifest.panelId);
assert.equal(results.summary.registeredCases, manifest.cases.length);
assert.equal(results.summary.replays, 20);
assert.equal(results.summary.replayAgreements, manifest.cases.length);
assert.equal(results.summary.feasibleCases, 9);
assert.deepEqual(results.summary.outcomes, {
  'no-feasible-pose':2,
  'success-feasible':18,
});
assert.equal(results.timing.byCase.length, manifest.cases.length);
assert(results.timing.byCase.every(entry => entry.replayAgreement));
assert(results.timing.byCase.every(entry => entry.totalMs.length === 2));
assert(results.timing.byAction.some(entry => entry.action === 'chemistry.finish'
  && entry.count === 46));
assert.equal(results.execution.scheduler.state, 'COMPLETED');
assert.equal(results.execution.scheduler.elapsedSeconds, 1434);
assert.match(results.execution.source.commit, /^[a-f0-9]{40}$/);
assert.equal(results.verification.commands.length, 5);
assert(results.verification.commands.every(entry => entry.status === 'PASS'));
assert(results.verification.commands.every(entry => Number.isFinite(entry.realSeconds)));
for (const field of ['archiveSha256','resultSha256','receiptSha256'])
  assert.match(results.execution.source[field], /^[a-f0-9]{64}$/, `${field}: invalid SHA-256`);
assert.equal(results.deterministicNegative.caseId, 'pyridone-sultam-manual-recapture');
assert.deepEqual(results.deterministicNegative.outcomes,
  ['no-feasible-pose','no-feasible-pose']);

console.log('7KPA manual contact-recapture panel: PASS (10 cases; 20 deterministic replays)');
