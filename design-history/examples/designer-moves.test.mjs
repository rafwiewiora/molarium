import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHEMIST_ACTIONS_SCHEMA } from '../../chemist-actions.mjs';
import { actionScriptFromAudit, actionScriptSha256, replayActionScript,
  validateActionScript } from '../replay.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const load = async (filename) => JSON.parse(await readFile(join(here, filename), 'utf8'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

const provenance = await load('sos1-growth-clash-v7.provenance.json');
const full = await load('sos1-growth-clash-v7.full.action-script.json');
const selected = await load('sos1-growth-clash-v7.selected-route.action-script.json');
for (const script of [full, selected]) assert.equal(validateActionScript(script), script);

assert.equal(full.actions.length, 89);
assert.equal(selected.actions.length, 33);
assert.deepEqual(full.sourceAudit.includedSequences, Array.from({ length:89 }, (_, index) => index + 1));
assert.deepEqual(selected.sourceAudit.includedSequences,
  [1, 2, 3, 4, 6, 7, 8, 9, 10, 14, 15, 16, 17, 18, 19, 20, 24, 25, 26,
    70, 71, 72, 73, 74, 75, 76, 80, 81, 82, 83, 84, 85, 86]);
assert.deepEqual(full.actions.filter((step) => step.action === 'pose.applySidechainRotamer')
  .map((step) => step.args.index), [0, 5, 6, 5]);
assert.deepEqual(selected.actions.filter((step) => step.action === 'pose.applySidechainRotamer')
  .map((step) => step.args.index), [5]);
assert.equal(selected.actions.some((step) => step.action.endsWith('.inspect')), false);
assert.equal(JSON.stringify(full).includes('Tyr884'), false);

for (const [key, script, filename] of [
  ['fullExploration', full, 'sos1-growth-clash-v7.full.action-script.json'],
  ['selectedRoute', selected, 'sos1-growth-clash-v7.selected-route.action-script.json'],
]) {
  assert.equal(await actionScriptSha256(script), provenance.scripts[key].actionScriptSha256);
  assert.equal(digest(await readFile(join(here, filename))), provenance.scripts[key].fileSha256);
}

for (const script of [full, selected]) {
  const calls = [];
  const fakeApi = Object.freeze({ schema:CHEMIST_ACTIONS_SCHEMA, async execute(request) {
    calls.push(request);
    return { schema:CHEMIST_ACTIONS_SCHEMA, status:'completed', result:{} };
  } });
  const replay = await replayActionScript(fakeApi, script);
  assert.equal(replay.status, 'completed');
  assert.equal(calls.length, script.actions.length);
}

const sourceAuditPath = join(root, provenance.sourceRun.audit.path);
try {
  await access(sourceAuditPath);
  const auditBytes = await readFile(sourceAuditPath), audit = JSON.parse(auditBytes);
  assert.equal(digest(auditBytes), provenance.sourceRun.audit.sha256);
  const captions = await load('sos1-growth-clash-v7-captions.json');
  const regeneratedFull = actionScriptFromAudit(audit, {
    label:full.label, captionsBySequence:captions, captionFromRequestId:true,
    provenance:{ path:full.sourceAudit.path, sha256:full.sourceAudit.sha256 },
  });
  const regeneratedSelected = actionScriptFromAudit(audit, {
    label:selected.label, includeReadOnly:false,
    includeSequences:selected.sourceAudit.includedSequences,
    captionsBySequence:captions, captionFromRequestId:true,
    provenance:{ path:selected.sourceAudit.path, sha256:selected.sourceAudit.sha256 },
  });
  assert.deepEqual(regeneratedFull, full);
  assert.deepEqual(regeneratedSelected, selected);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

console.log('SOS1 designer-moves examples: PASS (89-action exploration; 33-action selected route)');
