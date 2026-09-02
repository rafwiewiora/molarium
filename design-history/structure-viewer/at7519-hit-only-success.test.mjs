import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandStructureTimeline } from './timeline.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const story = JSON.parse(await readFile(join(here,
  'at7519-hit-only-success.json'), 'utf8'));
const assets = JSON.parse(await readFile(resolve(here, story.assetManifest), 'utf8'));
const evaluation = JSON.parse(await readFile(join(root,
  'design-history/structures/generated/at7519-holdout-evaluation.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

assert.equal(story.schema, 'molarium.structure-story/v1');
assert.equal(story.id, 'at7519-hit-only-success');
assert.equal(assets.campaignId, 'cdk2-at7519-hit-only');
assert.equal(assets.boundary.displayedReceptor, 'fixed 2VTA');
assert.equal(assets.boundary.sideChainMotion, false);
assert.equal(story.cues.length, 7);

const decisionCues = story.cues.slice(1, 6);
assert.deepEqual(decisionCues.map((cue) => cue.sceneSequence.length), [2, 2, 2, 2, 2]);
assert.equal(decisionCues.flatMap((cue) => cue.callouts || []).length, 5,
  'use one restrained change-region callout for each chemical decision');
for (const [index, cue] of decisionCues.entries()) {
  assert.equal(cue.sceneSequence[0], `predict${[15, 18, 22, 23, 33][index]}`);
  assert.equal(cue.sceneSequence[1], `validate${[15, 18, 22, 23, 33][index]}`);
  assert(cue.decisionCard?.rows?.length >= 3);
}

assert.deepEqual(Object.keys(story.cameras), ['master'],
  'the movie must expose one literal camera snapshot, not per-step focus cameras');
for (const cue of story.cues) {
  assert.equal(cue.cameraStart, 'master', `${cue.id} may not pan at cue start`);
  assert.equal(cue.cameraEnd, 'master', `${cue.id} may not pan or zoom inside the cue`);
}

function resolvedModels(sceneId, trail = []) {
  if (trail.includes(sceneId)) throw new Error(`scene inheritance cycle: ${sceneId}`);
  const scene = story.scenes[sceneId];
  assert(scene, `missing scene ${sceneId}`);
  return [
    ...(scene.extends ? resolvedModels(scene.extends, [...trail, sceneId]) : []),
    ...(scene.models || []),
  ];
}
const activeScenes = new Set(story.cues.flatMap((cue) => cue.sceneSequence || [cue.scene]));
for (const sceneId of activeScenes) {
  const models = resolvedModels(sceneId);
  assert.equal(models.filter((model) => /ligand\.pdb$/i.test(model.path)).length, 1,
    `${sceneId} must show exactly one ligand`);
  assert.equal(models.filter((model) => model.path === 'at7519-2vta-protein.pdb').length, 1,
    `${sceneId} must show the fixed 2VTA receptor`);
  assert.equal(models.filter((model) => model.path === 'at7519-2vta-pocket.pdb').length, 1,
    `${sceneId} must show the fixed 2VTA pocket`);
  assert(!models.some((model) => /sidechain|rotamer|flip|overlay/i.test(model.path)),
    `${sceneId} may not contain receptor motion or a side-chain overlay`);
}

const frames = expandStructureTimeline(story);
assert(frames.length > 500, 'the complete five-decision story should be paced, not rushed');
for (const cue of decisionCues) {
  const cueFrames = frames.filter((frame) => frame.cueIndex === story.cues.indexOf(cue));
  assert(cueFrames.some((frame) => frame.scene === cue.sceneSequence[0]));
  assert(cueFrames.some((frame) => frame.scene === cue.sceneSequence[1]));
  const transitions = cueFrames.filter((frame, index) => index
    && frame.scene !== cueFrames[index - 1].scene);
  assert.equal(transitions.length, 1, `${cue.id} must use one prediction-to-crystal hard cut`);
}

const storyText = JSON.stringify(story);
for (const result of evaluation.results)
  assert(storyText.includes(result.metrics.allHeavyAtomRmsdAngstrom.toFixed(2)),
    `${result.stepId} RMSD must be disclosed in the story`);
for (const asset of assets.assets) {
  const bytes = await readFile(join(root, asset.path));
  assert.equal(bytes.length, asset.bytes);
  assert.equal(sha256(bytes), asset.sha256);
}

console.log('AT7519 story passed fixed-view, hard-cut, one-ligand, and provenance gates');
