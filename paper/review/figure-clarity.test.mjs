import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import test from 'node:test';

const root=new URL('../../',import.meta.url);
const revision=new URL('paper/revisions/2026-09-07-figure-clarity-a20/',root);
const base=new URL('paper/revisions/2026-09-07-whole-movie-human-account-a19/',root);
const read=(dir,name)=>readFileSync(new URL(name,dir));
const json=(dir,name)=>JSON.parse(read(dir,name));
const sha=b=>createHash('sha256').update(b).digest('hex');
const text=read(revision,'main.tex').toString();

test('five graph depictions preserve ligand identities, heavy-atom counts and registered lineage changes',()=>{
  const p=json(revision,'figures/fig2_sos1_designer_intent.provenance.json');
  assert.equal(p.figureSha256,sha(read(revision,'figures/fig2_sos1_designer_intent.png')));
  assert.equal(p.builderSha256,sha(read(root,'paper/scripts/build-sos1-chemistry-figure.py')));
  assert.deepEqual(p.graphDepictions.map(d=>d.state),['AXE','AWT','AWZ','AWW','AXH']);
  assert.deepEqual(p.graphDepictions.map(d=>d.heavyAtoms),[27,29,31,31,32]);
  assert.deepEqual(p.graphDepictions.map(d=>d.highlightedAtomIds.length),[0,6,12,15,17]);
  const route=json(root,'design-history/structures/generated/sos1-prospective-campaign.json');
  for(let i=1;i<5;i++) assert.equal(p.graphDepictions[i].isomericSmiles,route.steps[i-1].productSmiles);
  assert.equal(p.checkpointSources.length,7);
  for(const source of p.checkpointSources) assert.equal(sha(read(root,source.path)),source.sha256);
  assert.match(text,/Orange marks regions outside the registered atom-lineage conserved subgraph/);
  assert.match(text,/5,8-dihydro core/);
  assert.match(text,/arrows connect endpoint states, not simulated paths/);
});

test('Figure 4 uses the vector redraw with unchanged text and a single cubic feedback arrow',()=>{
  const p=json(revision,'figures/fig3_build_loop_compact.provenance.json');
  assert.equal(p.pdfSha256,sha(read(revision,'figures/fig3_build_loop_compact.pdf')));
  const pdfText=execFileSync('pdftotext',[new URL('figures/fig3_build_loop_compact.pdf',revision).pathname,'-']).toString();
  for(const [heading,lines] of p.stages) {
    assert.ok(pdfText.includes(heading));
    for(const line of lines) assert.ok(pdfText.includes(line));
  }
  for(const line of p.footer) assert.ok(pdfText.includes(line));
  assert.match(text,/figures\/fig3_build_loop_compact\.pdf/);
  const builder=read(root,'paper/scripts/build-clean-feedback-figure.py').toString();
  assert.equal((builder.match(/path\.curveTo\(/g)||[]).length,1);
  assert.equal((builder.match(/head\(\(100,109\)/g)||[]).length,1);
});

test('the visible disclosure and comment convention are added without changing pseudocode or unrelated text',()=>{
  const manifest=json(revision,'edit-manifest.json');
  let reconstructed=read(base,'main.tex').toString();
  for(const change of manifest.changes) {
    assert.equal(reconstructed.split(change.before).length-1,1);
    reconstructed=reconstructed.replace(change.before,change.after);
  }
  assert.equal(text,reconstructed);
  assert.match(text,/Authorship note for Appendices A and B/);
  assert.match(text,/This appendix shares the AI-drafting and limited-human-editing disclosure/);
  assert.match(text,/unprefixed lines specify operations or checks/);
  assert.deepEqual(read(base,'sos1-whole-movie-pseudocode.txt'),read(revision,'sos1-whole-movie-pseudocode.txt'));
  assert.deepEqual(read(base,'sos1-full-executable.action-script.json'),read(revision,'sos1-full-executable.action-script.json'));
  for(const name of ['fig1_molarium_interface.png','fig2_architecture.png','fig4_evidence_ladder_fixed.png','fig5_value_layers_fixed.png'])
    assert.deepEqual(read(base,`figures/${name}`),read(revision,`figures/${name}`));
});
