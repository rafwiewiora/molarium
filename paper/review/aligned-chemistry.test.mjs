import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {validateActionScript} from '../../design-history/replay.mjs';

const root=new URL('../../',import.meta.url);
const data=new URL('design-history/publications/sos1/interface-aligned-chemistry-2026-09-07/',root);
const revision=new URL('paper/revisions/2026-09-07-aligned-chemistry-a22/',root);
const base=new URL('paper/revisions/2026-09-07-interface-chemistry-a21/',root);
const captures=new URL('paper/review/captures/2026-09-07-aligned-chemistry-a22/',root);
const read=(dir,name)=>readFileSync(new URL(name,dir));
const json=(dir,name)=>JSON.parse(read(dir,name));
const sha=b=>createHash('sha256').update(b).digest('hex');

test('aligned presentation preserves science and adds only a 2D scaffold alignment',()=>{
  const script=json(data,'presentation.action-script.json'); validateActionScript(script);
  const plan=json(data,'capture-plan.json');
  assert.equal(sha(read(data,'presentation.action-script.json')),plan.presentationSha256);
  const original=json(root,'design-history/publications/sos1/designer-intent-2026-09-04/checkpoint-review.action-script.json');
  assert.deepEqual(script.actions.filter(a=>a.action==='campaign.import'),original.actions);
  assert.ok(script.actions.every(a=>['campaign.import','view.setDisplay','view.focusComponent','view.highlightAtoms','view.setDepictionAlignment'].includes(a.action)));
  const alignment=script.actions.filter(a=>a.action==='view.setDepictionAlignment');
  assert.equal(alignment.length,1);
  assert.equal(alignment[0].args.referenceSmarts,plan.depictionAlignment.referenceSmarts);
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
  assert.match(audit.results.find(r=>r.stage==='scaffold-rewrite').smiles,/cn\[nH\]c/);
});

test('all six full-tool screenshots have aligned strictly sanitized native depictions',()=>{
  const plan=json(data,'capture-plan.json');
  const audit=json(captures,'worker-audit.json');
  const provenance=json(revision,'figures/fig2_sos1_designer_intent.provenance.json');
  assert.equal(sha(read(revision,'figures/fig2_sos1_designer_intent.png')),provenance.figureSha256);
  assert.equal(sha(read(captures,'worker-audit.json')),provenance.workerAuditSha256);
  assert.deepEqual(provenance.captures.map(c=>c.stage),plan.selectedStages);
  assert.deepEqual(provenance.depictionAlignment,plan.depictionAlignment);
  assert.match(provenance.sourceCodeSha256['rdkit-worker.js'],/^[a-f0-9]{64}$/);
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

test('a22 manuscript and all other figure assets are byte-identical to a21',()=>{
  assert.deepEqual(read(revision,'main.tex'),read(base,'main.tex'));
  const manifest=json(revision,'edit-manifest.json');
  assert.equal(manifest.baseSourceSha256,manifest.outputSha256);
  assert.deepEqual(manifest.changes,[]);
  assert.equal(manifest.allTextUnchanged,true);
  for(const name of readdirSync(new URL('figures/',base))) {
    if(!name.startsWith('fig2_sos1_designer_intent.'))
      assert.deepEqual(read(revision,'figures/'+name),read(base,'figures/'+name));
  }
  for(const name of ['sos1-whole-movie-pseudocode.txt','sos1-full-executable.action-script.json','sos1-checkpoint-review.action-script.json'])
    assert.deepEqual(read(revision,name),read(base,name));
});
