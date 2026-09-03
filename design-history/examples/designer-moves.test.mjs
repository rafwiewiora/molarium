import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHEMIST_ACTIONS_SCHEMA } from '../../chemist-actions.mjs';
import { actionScriptSha256, replayActionScript,
  validateActionScript } from '../replay.mjs';

const here = dirname(fileURLToPath(import.meta.url));
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
  .map((step) => step.args.chiDegrees), [[-180,90]]);
assert(selected.actions.filter((step) => step.action === 'pose.refine')
  .every((step) => step.args.featureSeedingProtocol === 'v3'
    && step.expect['refinement.selectedFeasible'] === true
    && step.expect['refinement.featureGuidedSeeding.method']
      === 'molarium-edit-region-axis-seeding/v3'));
assert(selected.actions.filter((step) => step.action === 'pose.apply')
  .every((step) => step.expect['appliedPose.feasible'] === true));
const selectedRotamer = selected.actions.find((step) =>
  step.action === 'pose.applySidechainRotamer');
assert.equal(selectedRotamer.args.expectedInputCoordinateSha256,
  'e62cdf930726a2f8b15effd1fc267dfebb448eec79c934f18705eb9bb69f9895');
assert.equal(selectedRotamer.args.expectedSelectedCoordinateSha256,
  '0fdc3367686a264f9c62d0af91251c686afcab6985222a11c1d81037d78ef333');
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
    const step = script.actions[calls.length];
    calls.push(request);
    const result = {};
    for (const [path, value] of Object.entries(step.expect || {})) {
      const keys = path.split('.'); let target = result;
      keys.slice(0, -1).forEach((key) => { target = target[key] ||= {}; });
      target[keys.at(-1)] = structuredClone(value);
    }
    return { schema:CHEMIST_ACTIONS_SCHEMA, status:'completed', result };
  } });
  const replay = await replayActionScript(fakeApi, script);
  assert.equal(replay.status, 'completed');
  assert.equal(calls.length, script.actions.length);
}

console.log('SOS1 designer-moves examples: PASS (89-action exploration; 33-action selected route)');
