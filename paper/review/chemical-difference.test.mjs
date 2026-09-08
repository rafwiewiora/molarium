import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {validateActionScript} from '../../design-history/replay.mjs';

const root=new URL('../../',import.meta.url);
const data=new URL('design-history/publications/sos1/interface-chemical-difference-2026-09-07/',root);
const revision=new URL('paper/revisions/2026-09-07-chemical-difference-a23/',root);
const base=new URL('paper/revisions/2026-09-07-aligned-chemistry-a22/',root);
const captures=new URL('paper/review/captures/2026-09-07-chemical-difference-a23/',root);
const read=(dir,name)=>readFileSync(new URL(name,dir));
const json=(dir,name)=>JSON.parse(read(dir,name));
const sha=b=>createHash('sha256').update(b).digest('hex');

test('chemical-difference presentation preserves all frozen scientific imports',()=>{
  const script=json(data,'presentation.action-script.json'); validateActionScript(script);
  const plan=json(data,'capture-plan.json');
  assert.equal(sha(read(data,'presentation.action-script.json')),plan.presentationSha256);
  assert.equal(sha(read(root,plan.chemicalChangeMap.path)),plan.chemicalChangeMap.sha256);
  const mapping=json(root,plan.chemicalChangeMap.path);
  assert.match(plan.chemicalChangeMap.authorDecision,/retained the existing graph and calculations/);
  for(const state of plan.states) {
    const mapped=mapping.states.find(s=>s.stage===state.stage);
    assert.equal(state.checkpointSha256,mapped.checkpointSha256);
    assert.deepEqual(state.highlightedAtomIds,mapped.highlightedAtomIds);
    assert.deepEqual(state.highlightedAtomNames,mapped.highlightedAtomNames);
  }
  const original=json(root,'design-history/publications/sos1/designer-intent-2026-09-04/checkpoint-review.action-script.json');
  assert.deepEqual(script.actions.filter(a=>a.action==='campaign.import'),original.actions);
  assert.ok(script.actions.every(a=>['campaign.import','view.setDisplay','view.focusComponent','view.highlightAtoms','view.setDepictionAlignment'].includes(a.action)));
  const audit=json(captures,'worker-audit.json');
  assert.equal(audit.results.length,7);
  for(const result of audit.results) {
    const state=plan.states.find(s=>s.stage===result.stage);
    assert.equal(sha(read(root,state.checkpoint)),result.checkpointSha256);
    assert.equal(result.checkpointSha256,state.checkpointSha256);
    assert.equal(result.sanitization,'strict RDKit sanitization; hydrogens removed after sanitization');
    assert.ok(result.maxScaffoldCoordinateDeviation<=0.001);
    if(result.alignment) assert.deepEqual(result.alignedAtomNames,plan.depictionAlignment.atomNames);
  }
});

test('six native screenshots match chemically mapped highlights and strict aligned depictions',()=>{
  const plan=json(data,'capture-plan.json');
  const audit=json(captures,'worker-audit.json');
  const provenance=json(revision,'figures/fig2_sos1_designer_intent.provenance.json');
  assert.equal(sha(read(revision,'figures/fig2_sos1_designer_intent.png')),provenance.figureSha256);
  assert.equal(sha(read(data,'capture-plan.json')),provenance.capturePlanSha256);
  assert.equal(sha(read(captures,'worker-audit.json')),provenance.workerAuditSha256);
  assert.deepEqual(provenance.chemicalChangeMap,plan.chemicalChangeMap);
  assert.deepEqual(provenance.captures.map(c=>c.stage),plan.selectedStages);
  assert.deepEqual(provenance.depictionAlignment,plan.depictionAlignment);
  for(const c of provenance.captures) {
    const expected=plan.states.find(s=>s.stage===c.stage);
    const checked=audit.results.find(s=>s.stage===c.stage);
    assert.equal(sha(read(captures,c.stage+'.png')),c.imageSha256);
    assert.equal(sha(read(captures,c.stage+'.svg')),c.svgSha256);
    assert.equal(c.reviewIndex,expected.reviewIndex);
    assert.equal(c.caption,expected.caption);
    assert.deepEqual(c.highlightedAtomIds.slice().sort(),expected.highlightedAtomIds.slice().sort());
    assert.ok(c.expanded && c.docked);
    assert.equal(c.replayStatus,'completed');
    assert.equal(c.depiction.error,undefined);
    assert.equal(Number(c.depiction.alignedAtoms),8);
    assert.equal(c.depiction.alignmentBackend,'RDKit shared-scaffold 2D coordinates');
    assert.equal(c.depiction.canonicalSmiles,checked.smiles);
    assert.equal(c.depiction.sanitization,checked.sanitization);
  }
});

test('a23 changes only two Figure 2 caption sentences and Figure 2 assets',()=>{
  const manifest=json(revision,'edit-manifest.json');
  assert.equal(manifest.changes.length,2);
  assert.equal(manifest.allOtherTextUnchanged,true);
  const [{before,after}]=manifest.changes;
  assert.equal(before,'Orange 2D highlights mark atoms outside the registered conserved atom-lineage subgraph relative to the preceding chemical graph; they do not depict a synthetic reaction mechanism.');
  assert.equal(after,String.raw`Orange 2D highlights mark added atoms and local chemical changes relative to the preceding structure; equivalent Kekul\'e representations and reassigned atom identifiers do not count as changes.`);
  assert.deepEqual(manifest.changes[1],{
    before:'(F) BAY-293: move the thiophene attachment, replace the alcohol with an N-methylamine, and restore the aromatic core.',
    after:'(F) BAY-293: move the thiophene attachment and replace the alcohol with an N-methylamine.'
  });
  let expected=read(base,'main.tex').toString();
  for(const change of manifest.changes) {
    assert.equal(expected.split(change.before).length,2);
    expected=expected.replace(change.before,change.after);
  }
  assert.equal(read(revision,'main.tex').toString(),expected);
  assert.equal(sha(read(base,'main.tex')),manifest.baseSourceSha256);
  assert.equal(sha(read(revision,'main.tex')),manifest.outputSha256);
  for(const name of readdirSync(new URL('figures/',base))) {
    if(!name.startsWith('fig2_sos1_designer_intent.'))
      assert.deepEqual(read(revision,'figures/'+name),read(base,'figures/'+name));
  }
  for(const name of ['sos1-whole-movie-pseudocode.txt','sos1-full-executable.action-script.json','sos1-checkpoint-review.action-script.json'])
    assert.deepEqual(read(revision,name),read(base,name));
});
