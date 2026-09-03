import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cameraFromView, easeInOut, expandStructureTimeline, interpolateCamera } from './timeline.mjs';

assert.equal(easeInOut(0), 0);
assert.equal(easeInOut(1), 1);
assert.equal(easeInOut(.5), .5);
const start = cameraFromView({ target:[0, 0, 0], radius:10, view:[0, 0, 1] });
const end = cameraFromView({ target:[4, 2, 0], radius:2, view:[0, 0, 1] });
const middle = interpolateCamera(start, end, .5);
assert.deepEqual(middle.target, [2, 1, 0]);
assert.equal(middle.radius, 6);
const frames = expandStructureTimeline({ fps:10, cues:[
  { durationMs:1000, scene:'a' }, { durationMs:500, scene:'b' },
] });
assert.equal(frames.length, 15);
assert.equal(frames[0].cueProgress, 0);
assert.equal(frames[9].cueProgress, 1);
assert.equal(frames[10].scene, 'b');
assert.equal(frames.at(-1).cueProgress, 1);
const sequenced = expandStructureTimeline({ fps:10, cues:[
  { durationMs:1000, scene:'fallback', sceneSequence:['first','middle','last'] },
] });
assert.equal(sequenced[0].scene, 'first');
assert.equal(sequenced[4].scene, 'middle');
assert.equal(sequenced.at(-1).scene, 'last');

const bcl = JSON.parse(await readFile(new URL('./bclxl-fragment-linking.json', import.meta.url)));
assert.equal(bcl.cues.length, 6, 'the five-state BCL-xL history uses one cue per state plus summary');
assert(bcl.cues.every((cue) => cue.durationMs >= 4000), 'no BCL-xL state is rushed');
assert.deepEqual(Object.keys(bcl.cameras), ['master'],
  'BCL-xL must expose one literal camera snapshot');
for (const cue of bcl.cues) {
  assert.equal(cue.cameraStart, 'master', `${cue.id} may not pan at cue start`);
  assert.equal(cue.cameraEnd, 'master', `${cue.id} may not pan or zoom`);
}
for (const [sceneId, scene] of Object.entries(bcl.scenes).filter(([id]) => id !== 'fixed3sp7'))
  assert.equal(scene.extends, 'fixed3sp7', `${sceneId} must inherit one receptor/pocket frame`);
assert.deepEqual(bcl.scenes.fixed3sp7.models.map((model) => model.path),
  ['3sp7-aligned-protein.pdb','3sp7-aligned-pocket.pdb'],
  'the common BCL-xL frame must pin the same aligned receptor assets');
assert.match(bcl.subtitle, /reconstructed poses are labeled/i,
  'BCL-xL must not present the historical reconstructions as prospective predictions');

const cdk2 = JSON.parse(await readFile(new URL('./cdk2-hit-only-prospective.json', import.meta.url)));
assert.equal(cdk2.cues.length, 11, 'CDK2 tells the two-step prospective result without extra shots');
assert(cdk2.cues.every((cue) => cue.durationMs >= 1800), 'CDK2 comparison cues must remain readable');
assert.equal(new Set(Object.values(cdk2.cameras).map((camera) => JSON.stringify(camera.view))).size, 1,
  'CDK2 holds one viewing direction for the entire prospective comparison');
for (const cue of cdk2.cues.slice(1)) {
  assert.equal(cue.cameraStart, cue.cameraEnd,
    `${cue.id} must hold the active-site camera still after the initial approach`);
}
for (const id of ['freeze-6cp','freeze-n76']) {
  const cue=cdk2.cues.find((entry)=>entry.id===id);
  assert.match(cue.detail, /Agent API sequence \d+/,
    `${id} must expose its Agent API freeze sequence`);
}
for (const id of ['reveal-1h1r','reveal-1oiu']) {
  const cue=cdk2.cues.find((entry)=>entry.id===id);
  assert.match(cue.detail, /opened after freeze/i,
    `${id} must label the post-freeze holdout boundary`);
}

const success = JSON.parse(await readFile(new URL('./cdk2-designer-hit-to-lead.json', import.meta.url)));
assert.equal(success.cues.length, 9, 'designer-directed CDK2 keeps the success story concise');
assert.deepEqual(Object.keys(success.cameras), ['overview','edit'],
  'designer-directed CDK2 uses only an overview and one edit-site camera');
assert.equal(new Set(Object.values(success.cameras).map((camera)=>JSON.stringify(camera.view))).size,1,
  'the deliberate edit-site push must not rotate the structure');
assert.deepEqual(success.cues.filter((cue)=>cue.cameraStart!==cue.cameraEnd).map((cue)=>cue.id),
  ['select-c19'],'only the C19 selection cue may push into the edit site');
assert.equal(success.cues[0].cameraStart,'overview');
assert.equal(success.cues[0].cameraEnd,'overview');
for (const cue of success.cues.slice(2)) {
  assert.equal(cue.cameraStart,'edit',`${cue.id} must start on the locked edit camera`);
  assert.equal(cue.cameraEnd,'edit',`${cue.id} must end on the locked edit camera`);
}
assert(success.cues.some((cue) => /attachmentAtomId/.test(cue.detail)),
  'the movie must show that designer spatial intent enters through the public Agent API');
assert(success.cues.some((cue) => /0\.53 Å/.test(cue.detail))
  && success.cues.some((cue) => /0\.85 Å/.test(cue.detail)),
  'the movie must report both successful structural validations');
for (const id of ['validate-6cp', 'validate-n76']) {
  const cue = success.cues.find((entry) => entry.id === id);
  assert.deepEqual(cue.sceneSequence.length, 2,
    `${id} must replace prediction with crystal in the same frame`);
  assert.match(cue.detail, /opened after freeze/i,
    `${id} must expose the post-freeze holdout boundary`);
}
const successResolvedModels=(sceneId,trail=[])=>{
  assert(!trail.includes(sceneId),`${sceneId} has cyclic scene inheritance`);
  const scene=success.scenes[sceneId];assert(scene,`${sceneId} is not registered`);
  return [...(scene.extends?successResolvedModels(scene.extends,[...trail,sceneId]):[]),
    ...(scene.models||[])];
};
const successScenes=new Set(success.cues.flatMap((cue)=>cue.sceneSequence||[cue.scene]));
for (const sceneId of successScenes) {
  const models=successResolvedModels(sceneId);
  assert.equal(models.filter((model)=>['hit','prediction','crystal'].includes(model.ref)).length, 1,
    `${sceneId} must display exactly one ligand`);
  assert(models.some((model)=>model.ref==='protein') && models.some((model)=>model.ref==='pocket'),
    `${sceneId} must retain the same hit-derived receptor and pocket`);
}

const sos1 = JSON.parse(await readFile(new URL('./sos1-hit-only-success.json', import.meta.url)));
assert.equal(sos1.cues.length, 14,
  'SOS1 restores the reviewed five-beat prediction/reveal cut');
assert.equal(new Set(Object.values(sos1.cameras).map((camera) =>
  JSON.stringify(camera.view))).size, 1, 'SOS1 holds one viewing direction');
const movingCues = sos1.cues.filter((cue) => cue.cameraStart !== cue.cameraEnd);
assert.deepEqual(movingCues.map((cue)=>cue.id), ['grow-into-phe890'],
  'only the causal Phe890 collision may make a modest change-centered push');
for (const cue of sos1.cues.filter((entry)=>entry.id!=='grow-into-phe890'))
  assert.equal(cue.cameraStart, cue.cameraEnd, `${cue.id} must hold the camera still`);
const flip = sos1.cues.find((cue) => cue.id === 'phe890-flip-slow-motion');
assert.equal(flip.sceneSequence.length, 9, 'Phe890 slow motion must use all audited intermediates');
assert(flip.durationMs >= 3000, 'the Phe890 change must remain slow enough to inspect');
assert.match(sos1.cues.find((cue) => cue.id === 'reveal-5ovi').detail, /Post-freeze 5OVI/i,
  'the final reveal must expose the post-freeze holdout boundary');
for (const beat of [1,2,3,4,5]) assert(sos1.cues.some((cue) =>
  cue.title.startsWith(`${beat} ·`)), `approved beat ${beat} is absent`);
assert.equal(sos1.cues[0].scene, 'hit', 'the prospective SOS1 story must start from 5OVE/AXE');
assert.match(sos1.cues[0].body, /Tyr884 arrangement is already present at time zero/i,
  'Tyr884 must not be misrepresented as a prospective prediction');
assert.match(sos1.cues.find((cue) => cue.id === 'grow-into-phe890').detail,
  /Phe-in adds four clashes/, 'the causal Phe890 collision must remain quantitative');
assert.match(sos1.cues.find((cue) => cue.id === 'reveal-5ovi').detail,
  /1\.215 Å.*predicted −172\.43°.*crystal −166\.55°/,
  'the final pose and conformational validation must be quantitative');
const resolvedModels=(sceneId,trail=[])=>{
  assert(!trail.includes(sceneId),`${sceneId} has cyclic scene inheritance`);
  const scene=sos1.scenes[sceneId];assert(scene,`${sceneId} is not registered`);
  return [...(scene.extends?resolvedModels(scene.extends,[...trail,sceneId]):[]),...(scene.models||[])];
};
const activeScenes=new Set(sos1.cues.flatMap((cue)=>cue.sceneSequence||[cue.scene]));
for (const sceneId of activeScenes) {
  const models=resolvedModels(sceneId);
  assert(models.filter((model) => /-(?:prediction|crystal|hit)-ligand\.pdb$/.test(model.path)).length <= 1,
    `${sceneId} must never overlay two whole ligands`);
  assert(models.filter((model) => /-phe890\.pdb$/.test(model.path)).length <= 1,
    `${sceneId} must show at most one Phe890 conformation at a time`);
}
for (const sceneId of flip.sceneSequence) {
  const refs=resolvedModels(sceneId).map((model)=>model.ref);
  assert.deepEqual(refs.filter((ref)=>ref==='ligand'), ['ligand'],
    `${sceneId} must keep one intact provenance-colored ligand fixed`);
  assert.deepEqual(refs.filter((ref)=>ref==='phe-highlight'), ['phe-highlight'],
    `${sceneId} must show exactly one moving Phe890`);
  assert(refs.includes('phe-peptide'), `${sceneId} must visibly attach Phe890 to its peptide`);
}
for (const sceneId of ['awtPrediction','awzPrediction','awwBeforeFlip','axhPrediction']) {
  const models=resolvedModels(sceneId),refs=models.map((model)=>model.ref);
  const ligands=models.filter((model)=>model.ref==='ligand');
  assert.equal(ligands.length,1,`${sceneId} must render one chemically intact ligand`);
  assert(Array.isArray(ligands[0].provenance?.addedAtomNames)
    &&ligands[0].provenance.addedAtomNames.length>0,
  `${sceneId} must color the intact ligand by atom provenance`);
  assert(refs.includes('phe-peptide'),`${sceneId} must anchor Phe890 to local backbone context`);
  assert(!refs.includes('inherited')&&!refs.includes('added'),
    `${sceneId} must not use disconnected ligand partitions`);
}
for (const sceneId of ['awtValidation','awzValidation','awwValidation','axhValidation']) {
  assert(sos1.scenes[sceneId].models.every((model) => !/-prediction-/.test(model.path)),
    `${sceneId} must cut cleanly to the crystal instead of overlaying it on the prediction`);
}
console.log('structure timeline tests passed');
