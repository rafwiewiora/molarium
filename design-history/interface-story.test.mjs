import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPocketInterfaceStory } from './interface-story.mjs';
import { actionScriptSha256 } from './replay.mjs';

const source = JSON.parse(await readFile(new URL(
  './examples/sos1-growth-clash-v7.selected-route.action-script.json', import.meta.url)));
const sourceBefore = structuredClone(source);
const story = buildPocketInterfaceStory(source, {
  sourcePath:'design-history/examples/sos1-growth-clash-v7.selected-route.action-script.json',
  sourceSha256:'74cbf827a3928a1c8066a2f5f2b13f37dec7141fb8c8aa4af6919bf3540f4ab1',
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
  'fb7ca38969f71545df1c8207a01206bd3b76f985ea1e852581fe5afffab7d3b1');
console.log('Interface story test passed: 33 scientific actions + 15 presentation actions');
