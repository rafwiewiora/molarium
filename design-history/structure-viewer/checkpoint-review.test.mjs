import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CHEMIST_ACTION_SCOPES } from '../../chemist-actions.mjs';
import { expandStructureTimeline } from './timeline.mjs';
import { validatePrecomputedCheckpointReview } from './checkpoint-review.mjs';

const root = resolve(import.meta.dirname, '../..');
const storyPath = resolve(import.meta.dirname, 'sos1-accepted-review.json');
const storyBytes = await readFile(storyPath);
const story = JSON.parse(storyBytes);
const readPinnedJson = async ({ path, sha256 }) => {
  const bytes = await readFile(resolve(import.meta.dirname, path));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256, path);
  return JSON.parse(bytes);
};
const [actionScript, provenance, assetManifest] = await Promise.all([
  readPinnedJson(story.review.actionScript),
  readPinnedJson(story.review.provenance),
  readPinnedJson(story.review.assetManifest),
]);

assert.equal(validatePrecomputedCheckpointReview(story,
  { actionScript, provenance, assetManifest }), story);
assert.equal(story.review.calculationPolicy, 'never-run');
assert.ok(CHEMIST_ACTION_SCOPES.structureStory.every((action) =>
  action.startsWith('structureStory.')));
assert.equal(CHEMIST_ACTION_SCOPES.structureStory.some((action) =>
  /optimization|pose|designRoute/.test(action)), false,
  'the review viewer must not expose scientific mutation actions');
assert.equal(story.cues.length, 4);
assert.equal(expandStructureTimeline(story).length, story.cues.length,
  'each arrowable item must be one immutable saved endpoint, not an interpolated scene');

for (const scene of Object.values(story.scenes)) {
  assert.ok(!/crystal|holdout/i.test(JSON.stringify(scene)),
    'the precomputed prospective review must not add post-freeze holdout coordinates');
  for (const model of scene.models) {
    const bytes = await readFile(resolve(root, 'design-history/structures/generated', model.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), model.sha256, model.path);
  }
}

const viewer = await readFile(resolve(import.meta.dirname, 'viewer.mjs'), 'utf8');
const storySha256 = createHash('sha256').update(storyBytes).digest('hex');
assert.match(viewer, new RegExp(`'sos1-hit-to-bay293-review':[\\s\\S]*${storySha256}`),
  'the registered review must pin the exact story JSON');

const build = await readFile(resolve(root, 'scripts/build-web.mjs'), 'utf8');
const server = await readFile(resolve(root, 'server.js'), 'utf8');
for (const source of [build, server]) assert.match(source,
  /sos1-hit-to-bay293\/replay/,
  'production and local serving must expose the stable review path');

console.log('SOS1 precomputed checkpoint review: PASS');
