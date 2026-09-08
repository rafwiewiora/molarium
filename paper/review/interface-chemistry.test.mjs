import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {validateActionScript} from '../../design-history/replay.mjs';

const root=new URL('../../',import.meta.url);
const data=new URL('design-history/publications/sos1/interface-chemistry-2026-09-07/',root);
const revision=new URL('paper/revisions/2026-09-07-interface-chemistry-a21/',root);
const base=new URL('paper/revisions/2026-09-07-figure-clarity-a20/',root);
const captures=new URL('paper/review/captures/2026-09-07-interface-chemistry-a21/',root);
const read=(dir,name)=>readFileSync(new URL(name,dir));
const json=(dir,name)=>JSON.parse(read(dir,name));
const sha=b=>createHash('sha256').update(b).digest('hex');

test('figure replay preserves all seven scientific imports and runs only display actions',()=>{
  const script=json(data,'presentation.action-script.json'); validateActionScript(script);
  const plan=json(data,'capture-plan.json');
  assert.equal(sha(read(data,'presentation.action-script.json')),plan.presentationSha256);
  const original=json(root,'design-history/publications/sos1/designer-intent-2026-09-04/checkpoint-review.action-script.json');
  assert.deepEqual(script.actions.filter(a=>a.action==='campaign.import'),original.actions);
  assert.ok(script.actions.every(a=>['campaign.import','view.setDisplay','view.focusComponent','view.highlightAtoms'].includes(a.action)));
  assert.equal(script.actions.filter(a=>a.action==='view.focusComponent').length,1);
  const release=json(root,'design-history/publications/sos1/designer-intent-2026-09-04/release.json');
  for(const [index,entry] of release.checkpoints.entries()) {
    const raw=read(root,entry.path); assert.equal(sha(raw),entry.sha256);
    const bytes=entry.encoding==='gzip'?gunzipSync(raw):raw;
    assert.equal(sha(bytes),entry.canonicalSha256);
    const snapshot=JSON.parse(bytes).objects.snapshots[entry.snapshotId];
    const heavy=snapshot.graph.atoms.filter(a=>a.record==='HETATM' &&
      ['AXE','AWT','AWZ','AWW','AXH'].includes(a.residueName) && a.element!=='H');
    assert.equal(heavy.length,plan.states[index].heavyAtomCount);
    assert.ok(plan.states[index].highlightedAtomIds.every(id=>heavy.some(a=>a.atomId===id)));
  }
});

test('six whole-tool captures contain the exact registered highlights and captions',()=>{
  const plan=json(data,'capture-plan.json');
  const provenance=json(revision,'figures/fig2_sos1_designer_intent.provenance.json');
  assert.equal(sha(read(revision,'figures/fig2_sos1_designer_intent.png')),provenance.figureSha256);
  assert.deepEqual(provenance.captures.map(c=>c.stage),plan.selectedStages);
  for(const c of provenance.captures) {
    const expected=plan.states.find(s=>s.stage===c.stage);
    assert.equal(sha(read(captures,c.stage+'.png')),c.imageSha256);
    assert.equal(sha(read(captures,c.stage+'.svg')),c.depictionSvgSha256);
    assert.equal(c.reviewIndex,expected.reviewIndex);
    assert.equal(c.caption,expected.caption);
    assert.deepEqual(c.highlightedAtomIds.slice().sort(),expected.highlightedAtomIds.slice().sort());
    assert.ok(c.expanded && c.docked);
    assert.equal(c.replayStatus,'completed');
    assert.equal(c.depiction.error,undefined);
  }
});

test('a21 preserves all text outside the caption and one typo; disclosures, pseudocode, Figure 4 survive',()=>{
  const manifest=json(revision,'edit-manifest.json');
  let expected=read(base,'main.tex').toString();
  for(const change of manifest.changes) expected=expected.replace(change.before,change.after);
  assert.equal(read(revision,'main.tex').toString(),expected);
  assert.match(expected,/Authorship note for Appendices A and B/);
  assert.match(expected,/unprefixed lines specify operations or checks/);
  assert.match(expected,/fig3_build_loop_compact\.pdf/);
  assert.match(expected,/This concept is analogous/);
  for(const n of ['sos1-whole-movie-pseudocode.txt','sos1-full-executable.action-script.json','sos1-checkpoint-review.action-script.json'])
    assert.deepEqual(read(base,n),read(revision,n));
  for(const n of ['fig1_molarium_interface.png','fig2_architecture.png','fig3_build_loop_compact.pdf','fig3_build_loop_compact.png','fig4_evidence_ladder_fixed.png','fig5_value_layers_fixed.png'])
    assert.deepEqual(read(base,'figures/'+n),read(revision,'figures/'+n));
});
