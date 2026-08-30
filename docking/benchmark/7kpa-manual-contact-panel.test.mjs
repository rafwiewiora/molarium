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

console.log('7KPA manual contact-recapture panel: PASS (10 preregistered cases; 1 development smoke)');
