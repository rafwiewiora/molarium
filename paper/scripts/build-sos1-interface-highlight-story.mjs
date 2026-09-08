// Reading-only replay: verified frozen campaigns plus public display actions.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPocketInterfaceStory } from '../../design-history/interface-story.mjs';
import { validateActionScript } from '../../design-history/replay.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = resolve(process.argv[2] || resolve(root, '../paper-history-review/fig2-interface-a21'));
const aligned = process.argv.includes('--align');
const chemicalDifference = process.argv.includes('--chemical-difference');
const chemicalMapPath = 'paper/review/sos1-chemical-change-map.json';
const chemicalMapBytes = chemicalDifference ? await readFile(resolve(root, chemicalMapPath)) : null;
const chemicalMap = chemicalMapBytes ? JSON.parse(chemicalMapBytes) : null;
if (chemicalMap) assert.ok(chemicalMap.publicationStatus.startsWith('AUTHOR-RETAINED:'));
const referenceSmarts = '[#6]1~[#6]~[#7]~[#6]~[#7]~[#6]~1~[#7]~[#6]';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const releasePath = 'design-history/publications/sos1/designer-intent-2026-09-04/release.json';
const release = JSON.parse(await readFile(resolve(root, releasePath)));
const sourceBytes = await readFile(resolve(root, release.precomputed.path));
assert.equal(digest(sourceBytes), release.precomputed.sha256);
const source = JSON.parse(sourceBytes);
const captions = {
  'starting-hit':'AXE starting hit: naphthyl group on the dimethoxyquinazoline scaffold.',
  'scaffold-rewrite':'AWT: replace naphthyl with pyrazolylphenyl; add a 2-methyl group.',
  'fragment-merge':'AWZ: replace phenyl with thiophene and merge the bicyclic heterocycle.',
  'aww-graph':'AWW: install benzyl alcohol and the 5,8-dihydro core; inherited arm pose.',
  'aww-designer-intent':'AWW: benzyl alcohol and 5,8-dihydro core; orient the arm toward the Tyr884 backbone contact.',
  'aww-phe890-response':'Same AWW ligand, held fixed: select a Phe890 rotamer that clears the arm.',
  'finish-bay-293':'BAY-293: move thiophene attachment; alcohol to N-methylamine.',
};
const states = [];
let previousHeavyIds = null, previousGraph = null, activeHighlight = [];
for (const [index, entry] of release.checkpoints.entries()) {
  const raw = await readFile(resolve(root, entry.path));
  assert.equal(digest(raw), entry.sha256);
  const decoded = entry.encoding === 'gzip' ? gunzipSync(raw) : raw;
  assert.equal(digest(decoded), entry.canonicalSha256);
  const campaign = JSON.parse(decoded);
  const snapshot = campaign.objects.snapshots[entry.snapshotId];
  assert.equal(campaign.objects.commits[entry.commitId].snapshotId, entry.snapshotId);
  const heavy = snapshot.graph.atoms.filter(a => a.record === 'HETATM'
    && ['AXE','AWT','AWZ','AWW','AXH'].includes(a.residueName) && a.element !== 'H');
  const ids = new Set(heavy.map(a => a.atomId));
  const graph = JSON.stringify([...ids].sort());
  if (graph !== previousGraph) {
    activeHighlight = previousHeavyIds ? [...ids].filter(id => !previousHeavyIds.has(id)) : [];
    previousHeavyIds = ids; previousGraph = graph;
  }
  states.push({ stage:entry.id, checkpoint:entry.path, checkpointSha256:entry.sha256,
    snapshotId:entry.snapshotId, ligandCode:heavy[0].residueName,
    heavyAtomCount:heavy.length,
    highlightedAtomIds:entry.id === 'aww-phe890-response' ? [] : activeHighlight.slice(),
    caption:captions[entry.id] });
  assert.equal(source.actions[index].review.designStage, entry.id);
  assert.equal(source.actions[index].review.calculationPolicy, 'none');
}
assert.deepEqual(states.map(s => s.heavyAtomCount), [27,29,31,31,31,31,32]);
assert.deepEqual(states.map(s => s.highlightedAtomIds.length), [0,6,12,15,15,0,17]);
if (chemicalMap) for (const state of states) {
  const mapped = chemicalMap.states.find(s => s.stage === state.stage);
  assert.equal(mapped.checkpointSha256, state.checkpointSha256);
  assert.equal(mapped.snapshotId, state.snapshotId);
  state.highlightedAtomIds = mapped.highlightedAtomIds;
  state.highlightedAtomNames = mapped.highlightedAtomNames;
}
const script = buildPocketInterfaceStory(source, {
  sourcePath:release.precomputed.path, sourceSha256:release.precomputed.sha256 });
if (aligned) script.actions.splice(1,0,{ action:'view.setDepictionAlignment',
  args:{referenceSmarts}, caption:'Keep the eight shared scaffold atoms aligned in the 2D drawings',
  expect:{'depictionAlignment.enabled':true,'depictionAlignment.alignedAtoms':8} });
let stage;
for (const [index, action] of script.actions.entries()) {
  if (action.action === 'campaign.import') stage = states.find(s => s.stage === action.review.designStage);
  if (action.action === 'view.highlightAtoms') {
    action.args.atomIds = stage.highlightedAtomIds;
    action.caption = stage.caption;
    action.expect = { 'highlightedAtoms.cameraPreserved':true,
      'highlightedAtoms.displayContextPreserved':true };
    stage.reviewIndex = index + 1;
  }
}
script.label = 'SOS1 chemical edits in the Molarium interface' + (aligned ? ' · aligned scaffold' : '');
validateActionScript(script);
await mkdir(output, { recursive:true });
const scriptBytes = Buffer.from(JSON.stringify(script, null, 2) + '\n');
await writeFile(resolve(output, 'presentation.action-script.json'), scriptBytes);
await writeFile(resolve(output, 'capture-plan.json'), JSON.stringify({
  schema:'molarium.sos1-interface-figure-plan/v1',
  sourceReplaySha256:release.precomputed.sha256,
  presentationSha256:digest(scriptBytes),
  ...(aligned ? {depictionAlignment:{referenceSmarts,atomNames:['C1','C2','N6','C11','N8','C3','N7','C12'],
    policy:'RDKit constrained 2D scaffold depiction; all 3D coordinates and stereochemistry unchanged'}} : {}),
  ...(chemicalMap ? {chemicalChangeMap:{path:chemicalMapPath,sha256:digest(chemicalMapBytes),authorDecision:chemicalMap.authorDecision}} : {}),
  highlightMeaning:chemicalMap ? 'Orange marks added atoms and local normalized chemical differences in the retained PDB-derived graphs, not equivalent Kekule representations or reassigned atom IDs. This is not a reaction mechanism. AWW highlights persist during placement and clear for receptor-only response.' : 'Orange marks heavy atoms outside the registered atom-lineage conserved subgraph relative to the preceding chemical graph. AWW highlights persist through ligand placement and are cleared for the receptor-only panel. This is not a reaction mechanism or a unique chemical atom mapping.',
  calculationPolicy:'none', coordinatePolicy:'exact saved campaigns; no interpolation or optimization',
  selectedStages:['starting-hit','scaffold-rewrite','fragment-merge',
    'aww-designer-intent','aww-phe890-response','finish-bay-293'], states,
}, null, 2) + '\n');
console.log(JSON.stringify({ output, steps:script.actions.length,
  states:states.map(s => ({stage:s.stage, reviewIndex:s.reviewIndex, highlights:s.highlightedAtomIds.length})) }, null, 2));
