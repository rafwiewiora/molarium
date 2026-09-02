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
assert.equal(story.actions.filter((step) => step.action === 'view.focusComponent').length, 14);
assert.equal(story.actions.filter((step) => step.action === 'view.setDisplay').length, 1);
assert.deepEqual(story.actions.filter((step) => !step.action.startsWith('view.')),
  source.actions.filter((step) => !step.action.startsWith('view.')));
assert.equal(await actionScriptSha256(story),
  '1f0ec66d15c99e6546d5e1e3112fa3cb29d81cc9d729676076df4b2926c31e5d');
console.log('Interface story test passed: 33 scientific actions + 15 presentation actions');
