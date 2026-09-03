import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CHEMIST_ACTION_DEFINITIONS } from '../chemist-actions.mjs';
import { buildPocketInterfaceStory } from './interface-story.mjs';
import { actionScriptSha256 } from './replay.mjs';

const source = JSON.parse(await readFile(new URL(
  './examples/sos1-growth-clash-v7.selected-route.action-script.json', import.meta.url)));
const sourceBefore = structuredClone(source);
const story = buildPocketInterfaceStory(source, {
  sourcePath:'design-history/examples/sos1-growth-clash-v7.selected-route.action-script.json',
  sourceSha256:'f7f1fcb6b3791a8a4bd445e450f188c8e08e2062bf6c270fe0e5db1d9d6e5a59',
});

assert.deepEqual(source, sourceBefore);
assert.equal(source.actions.length, 33);
assert.equal(story.actions.length, 51);
assert(story.actions.every((step) => Object.hasOwn(CHEMIST_ACTION_DEFINITIONS, step.action)),
  'every source and presentation step must use the public Chemist Actions manifest');
assert.equal(story.actions.filter((step) => step.action === 'view.focusComponent').length, 1);
assert.equal(story.actions.filter((step) => step.action === 'view.focusAtoms').length, 0);
assert.equal(story.actions.filter((step) => step.action === 'view.highlightAtoms').length, 13);
assert.equal(story.actions.filter((step) => step.action === 'view.setDisplay').length, 4);
assert.equal(story.actions.find((step) => step.action === 'view.setDisplay')
  .args.representation, 'cartoon');
assert.equal(story.actions.find((step) => step.action === 'view.setDisplay')
  .args.colorTheme, 'design-hit');
assert.equal(story.actions.find((step) => step.action === 'view.setDisplay')
  .args.showStericClashes, false);
assert.equal(story.actions.filter((step) => step.action === 'view.setDisplay')[1]
  .args.colorTheme, 'design-prediction');
const clashOn = story.actions.findIndex((step) => step.action === 'view.setDisplay'
  && step.args.showStericClashes === true);
const pheOut = story.actions.findIndex((step) => step.action === 'pose.applySidechainRotamer');
const clashOff = story.actions.findIndex((step, index) => index > clashOn
  && step.action === 'view.setDisplay' && step.args.showStericClashes === false);
const compound21 = story.actions.findIndex((step) => step.action === 'designRoute.applyStep'
  && step.args.stepId === 'open-phe890-pocket');
assert.equal(clashOn, compound21 + 1);
assert.equal(clashOff, pheOut + 1);
assert(clashOn < pheOut && pheOut < clashOff);
assert.equal(story.actions.filter((step) => step.action === 'view.setCamera').length, 0);
const insertedPresentationActions = new Set([
  'view.setDisplay', 'view.focusComponent', 'view.highlightAtoms',
]);
assert.deepEqual(story.actions.filter((step) => !insertedPresentationActions.has(step.action))
  .map(({ capture, ...step }) => step),
source.actions,
'presentation transformation must retain every scientific request and workspace switch verbatim');
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
assert(story.actions.slice(compound21).filter((step) => step.action === 'view.highlightAtoms')
  .every((step) => step.args.residueLabels?.some((entry) => entry.label === 'Phe890'
    && entry.tone === 'gold')));
assert.match(story.actions.find((step) => step.action === 'view.highlightAtoms')?.caption,
  /graph changed/i);
assert.match(story.actions.find((step) => step.action === 'view.highlightAtoms'
  && /pyrazole/.test(step.caption))?.caption,
  /pyrazole.*Phe890.*Lys898.*no direct H-bond/i);
assert.match(await actionScriptSha256(story), /^[0-9a-f]{64}$/);
console.log('Interface story test passed: 33 scientific actions + 18 presentation actions');
