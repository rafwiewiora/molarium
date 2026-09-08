import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';

const root=new URL('../../',import.meta.url);
const base=new URL('paper/revisions/2026-09-07-evidence-arrow-a24/',root);
const revision=new URL('paper/revisions/2026-09-08-readable-protocol-a25/',root);
const read=(dir,name)=>readFileSync(new URL(name,dir));
const json=(dir,name)=>JSON.parse(read(dir,name));
const sha=b=>createHash('sha256').update(b).digest('hex');
const release=json(root,'design-history/publications/sos1/designer-intent-2026-09-04/release.json');
const campaigns=release.checkpoints.map(entry=>{
  const bytes=read(root,entry.path);
  assert.equal(sha(bytes),entry.sha256);
  const decoded=entry.encoding==='gzip'?gunzipSync(bytes):bytes;
  assert.equal(sha(decoded),entry.canonicalSha256);
  return JSON.parse(decoded);
});
const snapshots=campaigns.map((c,i)=>c.objects.snapshots[release.checkpoints[i].snapshotId]);

test('six annotated listing bodies reproduce a24 pseudocode byte-for-byte',()=>{
  const tex=read(revision,'main.tex').toString();
  const blocks=[...tex.matchAll(/\\begin\{lstlisting\}\[style=sosreadable\]\n([\s\S]*?)\\end\{lstlisting\}/g)];
  assert.equal(blocks.length,6);
  assert.deepEqual(Buffer.from(blocks.map(m=>m[1]).join('')),read(base,'sos1-whole-movie-pseudocode.txt'));
  assert.match(tex,/not a separately executable script/);
  assert.match(tex,/not only assertions enforced by the script runner/);
  assert.match(tex,/partial public-action segments attached to individual campaign commits/);
  assert.match(tex,/not the entire commit graph/);
  for(const name of readdirSync(new URL('figures/',base)))
    assert.deepEqual(read(revision,'figures/'+name),read(base,'figures/'+name));
  for(const name of ['sos1-full-executable.action-script.json','sos1-checkpoint-review.action-script.json'])
    assert.deepEqual(read(revision,name),read(base,name));
  const evidence=json(revision,'protocol-evidence.json');
  assert.equal(sha(read(revision,'sos1-whole-movie-pseudocode.txt')),evidence.pseudocodeSha256);
  assert.equal(sha(read(revision,'sos1-full-executable.action-script.json')),evidence.sourceSha256);
  assert.equal(evidence.sourceActionCount,159);
});

test('Figure 2 panel mapping distinguishes unpictured graph-only checkpoint 4 from panel D',()=>{
  const evidence=json(revision,'protocol-evidence.json');
  assert.deepEqual(evidence.presentationRevision.panelToCheckpoint,{A:1,B:2,C:3,D:5,E:6,F:7});
  assert.equal(evidence.presentationRevision.unpicturedCheckpoint,4);
  assert.deepEqual(evidence.presentationRevision.stateTrace,[4,5,6]);
  const provenance=json(revision,'figures/fig2_sos1_designer_intent.provenance.json');
  assert.deepEqual(provenance.captures.map(c=>c.stage),[0,1,2,4,5,6].map(i=>release.checkpoints[i].id));
  const tex=read(revision,'main.tex').toString();
  assert.match(tex,/Panel D shows checkpoint 5, after the graph-only checkpoint 4/);
  assert.match(tex,/Same graph; ligand branch moves; receptor fixed/);
  assert.match(tex,/Same graph; ligand fixed; Phe890 moves/);
});

test('AWW trace matches frozen graph and coordinate changes',()=>{
  const [graphOnly,placed,response]=snapshots.slice(3,6);
  assert.deepEqual(graphOnly.graph,placed.graph);
  assert.deepEqual(placed.graph,response.graph);
  const positions=s=>new Map(s.coordinates.atomIds.map((id,i)=>[id,s.coordinates.positions[i]]));
  const before=positions(graphOnly),middle=positions(placed),after=positions(response);
  const isLigand=a=>a.record==='HETATM'&&a.residueName==='AWW';
  const changed=(a,b,id)=>JSON.stringify(a.get(id))!==JSON.stringify(b.get(id));
  const movingInPlacement=placed.graph.atoms.filter(a=>changed(before,middle,a.atomId));
  assert.equal(movingInPlacement.length,27);
  assert.ok(movingInPlacement.every(isLigand));
  const movingInResponse=response.graph.atoms.filter(a=>changed(middle,after,a.atomId));
  assert.equal(movingInResponse.length,13);
  assert.ok(movingInResponse.every(a=>a.residueName==='PHE'&&a.residueIndex===890));
  for(const atom of response.graph.atoms.filter(isLigand))
    assert.deepEqual(middle.get(atom.atomId),after.get(atom.atomId));
});

test('saved snapshots have real ancestry without implying complete automatic evidence history',()=>{
  assert.equal(new Set(campaigns.map(c=>c.campaignId)).size,1);
  const final=campaigns.at(-1),ancestors=[];
  let id=release.checkpoints.at(-1).commitId;
  while(id){
    assert.ok(!ancestors.includes(id),'acyclic ancestry');
    ancestors.push(id);
    const commit=final.objects.commits[id];
    assert.ok(commit);
    assert.ok(commit.parents.length<=1);
    id=commit.parents[0];
  }
  assert.equal(ancestors.length,9);
  for(const [i,campaign] of campaigns.entries()){
    const entry=release.checkpoints[i],commit=campaign.objects.commits[entry.commitId];
    assert.ok(ancestors.includes(entry.commitId));
    assert.equal(commit.snapshotId,entry.snapshotId);
    if(i>0&&i<6) assert.deepEqual(commit.parents,[release.checkpoints[i-1].commitId]);
    assert.deepEqual(commit.evidenceIds,[]);
    assert.deepEqual(commit.hypothesisIds,[]);
    const coverage=campaign.objects.actionScripts[commit.actionScriptId].coverage;
    assert.equal(coverage.complete,false);
    assert.equal(coverage.kind,'public-actions-only');
    assert.equal(coverage.directUiMutationsCapturedOnlyInSnapshot,true);
    if(i===3||i===4) assert.equal(coverage.auditTruncated,true);
    for(const [kind,items] of Object.entries(campaign.objects))
      for(const [key,value] of Object.entries(items))
        assert.deepEqual(final.objects[kind][key],value);
  }
  assert.ok(release.evidence.length>0,'numerical/source evidence is separately release-listed');
});
