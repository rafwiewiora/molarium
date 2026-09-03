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
assert.equal(story.actions.length, 48);
assert.equal(story.actions.filter((step) => step.action === 'view.focusComponent').length, 1);
assert.equal(story.actions.filter((step) => step.action === 'view.focusAtoms').length, 5);
assert.equal(story.actions.filter((step) => step.action === 'view.highlightAtoms').length, 8);
assert.equal(story.actions.filter((step) => step.action === 'view.setDisplay').length, 1);
assert.equal(story.actions.find((step) => step.action === 'view.setDisplay')
  .args.representation, 'cartoon');
assert.deepEqual(story.actions.filter((step) => !step.action.startsWith('view.'))
  .map(({ capture, ...step }) => step),
source.actions.filter((step) => !step.action.startsWith('view.')));
for (const presentation of story.actions.filter((step) =>
  step.action === 'view.focusAtoms' || step.action === 'view.highlightAtoms')) {
  assert.deepEqual(Object.keys(presentation.args.atomIds), ['$binding']);
  const presentationIndex = story.actions.indexOf(presentation);
  assert(Object.hasOwn(story.actions[presentationIndex - 1].capture,
    presentation.args.atomIds.$binding));
}
assert(story.actions.filter((step) => step.action === 'view.focusAtoms')
  .every((step) => step.args.contextRadiusAngstrom === 3.8));
assert.deepEqual(story.actions.find((step) => step.action === 'view.focusAtoms')
  .args.residueLabels.map((entry) => entry.label), ['Phe890','Lys898']);
assert(story.actions.filter((step) => step.action === 'view.highlightAtoms')
  .every((step) => !Object.hasOwn(step.args, 'contextRadiusAngstrom')));
assert.match(story.actions.find((step) => step.action === 'view.highlightAtoms')?.caption,
  /pyrazole.*Phe890.*Lys898.*no direct H-bond/i);
assert.equal(await actionScriptSha256(story),
  'cde8d237563c2cbcb824ee398bcccf50b4d85de51cc55fac263092971d607a8a');
console.log('Interface story test passed: 33 scientific actions + 15 presentation actions');
