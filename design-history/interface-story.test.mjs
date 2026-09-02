import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPocketInterfaceStory } from './interface-story.mjs';
import { actionScriptSha256 } from './replay.mjs';

const source = JSON.parse(await readFile(new URL(
  './examples/sos1-growth-clash-v7.selected-route.action-script.json', import.meta.url)));
const sourceBefore = structuredClone(source);
const story = buildPocketInterfaceStory(source, {
  sourcePath:'design-history/examples/sos1-growth-clash-v7.selected-route.action-script.json',
  sourceSha256:'9c3494c3deb11f7ec80559e8b7235981f4d9993c89b9e63bea978d7eb4a7267d',
});

assert.deepEqual(source, sourceBefore);
assert.equal(source.actions.length, 33);
assert.equal(story.actions.length, 48);
assert.equal(story.actions.filter((step) => step.action === 'view.focusComponent').length, 1);
assert.equal(story.actions.filter((step) => step.action === 'view.focusAtoms').length, 13);
assert.equal(story.actions.filter((step) => step.action === 'view.setDisplay').length, 1);
assert.equal(story.actions.find((step) => step.action === 'view.setDisplay')
  .args.representation, 'cartoon');
assert.deepEqual(story.actions.filter((step) => !step.action.startsWith('view.'))
  .map(({ capture, ...step }) => step),
source.actions.filter((step) => !step.action.startsWith('view.')));
for (const focus of story.actions.filter((step) => step.action === 'view.focusAtoms')) {
  assert.deepEqual(Object.keys(focus.args.atomIds), ['$binding']);
  const focusIndex = story.actions.indexOf(focus);
  assert(Object.hasOwn(story.actions[focusIndex - 1].capture,
    focus.args.atomIds.$binding));
}
assert.equal(await actionScriptSha256(story),
  'aa70ba60c084afaac48b4341302662c123634e8bfcbe8167be938b04eb19f1bf');
console.log('Interface story test passed: 33 scientific actions + 15 presentation actions');
