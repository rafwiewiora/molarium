import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPocketInterfaceStory } from '../design-history/interface-story.mjs';

const [app, source] = await Promise.all([
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../design-history/examples/sos1-growth-clash-v7.selected-route.action-script.json',
    import.meta.url), 'utf8').then(JSON.parse),
]);
const story = buildPocketInterfaceStory(source);

assert.match(app, /product\.atoms\.forEach\(\(atom, index\) => \{[\s\S]*?atom\.record = 'HETATM'; atom\.residueName = productComponentId/,
  'registered graph rewrites must remain one ligand display/2D component');
assert.match(app, /'depictionPinnedLigand', 'depictionOrientationAnchor'/,
  'story checkpoints must retain the active ligand chosen for 2D depiction');
assert.match(app, /restoreDesignerMoveCheckpoint[\s\S]*?state\.depictionKey = null; state\.depictionGlobalAtomIndices = \[\]/,
  'checkpoint navigation must rebuild the 2D atom map against restored coordinates');

assert.equal(story.actions.filter((step) => step.action === 'view.focusComponent').length, 1);
assert.equal(story.actions.filter((step) => step.action === 'view.focusAtoms').length, 0);
assert.equal(story.actions.filter((step) => step.action === 'view.setCamera').length, 0);
const highlights = story.actions.filter((step) => step.action === 'view.highlightAtoms');
assert.ok(highlights.length > 0);
assert.ok(highlights.every((step) => !Object.hasOwn(step.args, 'contextRadiusAngstrom')),
  'change markers must not refit the established pocket camera');
assert.ok(highlights.filter((step) => !Array.isArray(step.args.atomIds))
  .every((step) => Object.keys(step.args.atomIds).join() === '$binding'),
  'changed ligand atoms must come from the public mutation result binding');
assert.ok(highlights.filter((step) => step.args.residueLabels?.length)
  .every((step) => step.args.residueLabels.some((label) => label.label === 'Phe890'
    && label.tone === 'gold')),
  'Phe890 must remain a separate gold residue label, not a red ligand-change atom');
assert.ok(highlights.some((step) => Array.isArray(step.args.atomIds)
  && step.args.atomIds.length === 0 && step.args.residueLabels?.some(
    (label) => label.label === 'Phe890')),
  'a clean comparison state must clear red atom markers while retaining Phe890 context');

console.log('SOS1 interface presentation source invariants: PASS');
