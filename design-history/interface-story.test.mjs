import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPocketInterfaceStory } from './interface-story.mjs';
import { actionScriptSha256 } from './replay.mjs';

const source = JSON.parse(await readFile(new URL(
  './examples/sos1-growth-clash-v7.selected-route.action-script.json', import.meta.url)));
const sourceBefore = structuredClone(source);
const story = buildPocketInterfaceStory(source, {
  sourcePath:'design-history/examples/sos1-growth-clash-v7.selected-route.action-script.json',
  sourceSha256:'34d1db8acb8e6c5ec48194d3d49b2099820a36fa1c81a2e3c0f1d6af713e7aa7',
});

assert.deepEqual(source, sourceBefore);
assert.equal(source.actions.length, 33);
assert.equal(story.actions.length, 49);
assert.equal(story.actions.filter((step) => step.action === 'view.focusComponent').length, 1);
assert.equal(story.actions.filter((step) => step.action === 'view.focusAtoms').length, 0);
assert.equal(story.actions.filter((step) => step.action === 'view.highlightAtoms').length, 13);
assert.equal(story.actions.filter((step) => step.action === 'view.setDisplay').length, 2);
assert.equal(story.actions.find((step) => step.action === 'view.setDisplay')
  .args.representation, 'cartoon');
assert.equal(story.actions.find((step) => step.action === 'view.setDisplay')
  .args.colorTheme, 'design-hit');
assert.equal(story.actions.filter((step) => step.action === 'view.setDisplay')[1]
  .args.colorTheme, 'design-prediction');
assert.deepEqual(story.actions.filter((step) => !step.action.startsWith('view.'))
  .map(({ capture, ...step }) => step),
source.actions.filter((step) => !step.action.startsWith('view.')));
for (const presentation of story.actions.filter((step) => step.action === 'view.highlightAtoms'
  && !Array.isArray(step.args.atomIds))) {
  assert.deepEqual(Object.keys(presentation.args.atomIds), ['$binding']);
  const presentationIndex = story.actions.indexOf(presentation);
  const captured = story.actions.slice(0, presentationIndex).reverse()
    .find((step) => step.capture?.[presentation.args.atomIds.$binding]);
  assert(captured);
}
assert(story.actions.filter((step) => step.action === 'view.highlightAtoms')
  .every((step) => !Object.hasOwn(step.args, 'contextRadiusAngstrom')));
assert.equal(story.actions.filter((step) => step.action === 'view.highlightAtoms'
  && Array.isArray(step.args.atomIds) && step.args.atomIds.length === 0).length, 4);
assert(story.actions.some((step) => step.action === 'view.highlightAtoms'
  && step.args.residueLabels?.some((entry) => entry.label === 'Phe890'
    && entry.tone === 'gold')));
assert.match(story.actions.find((step) => step.action === 'view.highlightAtoms')?.caption,
  /graph changed/i);
assert.match(story.actions.find((step) => step.action === 'view.highlightAtoms'
  && /pyrazole/.test(step.caption))?.caption,
  /pyrazole.*Phe890.*Lys898.*no direct H-bond/i);
assert.match(await actionScriptSha256(story), /^[0-9a-f]{64}$/);
console.log('Interface story test passed: 33 scientific actions + 16 presentation actions');
