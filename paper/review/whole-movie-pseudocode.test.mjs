import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const revision = new URL('paper/revisions/2026-09-07-whole-movie-human-account-a19/', root);
const release = new URL('design-history/publications/sos1/designer-intent-2026-09-04/', root);
const read = (base, name) => readFileSync(new URL(name, base));
const json = (base, name) => JSON.parse(read(base, name));
const sha = value => createHash('sha256').update(value).digest('hex');
const source = json(release, 'executable.action-script.json');
const text = read(revision, 'main.tex').toString();
const pseudo = read(revision, 'sos1-whole-movie-pseudocode.txt').toString();
const evidence = json(revision, 'protocol-evidence.json');
const gz = name => JSON.parse(gunzipSync(read(release, `evidence/${name}`)));

test('one whole-movie pseudocode listing is mapped to all 159 actions and all seven saved states', () => {
  assert.equal(sha(read(release, 'executable.action-script.json')), evidence.sourceSha256);
  assert.deepEqual(read(revision, 'sos1-full-executable.action-script.json'), read(release, 'executable.action-script.json'));
  assert.deepEqual(read(revision, 'sos1-checkpoint-review.action-script.json'), read(release, 'checkpoint-review.action-script.json'));
  const stages = json(release, 'checkpoint-review.action-script.json').actions;
  assert.deepEqual(evidence.checkpointMapping.map(s => s.id), stages.map(s => s.review.designStage));
  const indices = evidence.checkpointMapping.flatMap(s => {
    const [start, end] = s.sourceActionRangeInclusive;
    return Array.from({length: end-start+1}, (_, i) => start+i);
  });
  assert.deepEqual(indices, Array.from({length: 159}, (_, i) => i));
  assert.equal(evidence.directlyExecutable, false);
  assert.equal(evidence.newScientificCalculations, false);
  assert.equal(sha(pseudo), evidence.pseudocodeSha256);
  const printed = text.match(/\\begin\{lstlisting\}\[[^\n]*label=\{lst:sos1api\}[^\n]*\]\n([\s\S]*?)\\end\{lstlisting\}/);
  assert.equal(printed?.[1], pseudo);
  assert.equal((text.match(/label=\{lst:sos1api\}/g) || []).length, 1);
  assert.match(text, /not a separately executable script/);
  assert.match(text, /Human account: decisions and outcomes/);
  assert.doesNotMatch(text, /Candidate evaluation and results|Native executable action records/);
});

test('the condensed loops preserve defining input choices and fixed-choice replay semantics', () => {
  assert.deepEqual(source.actions.filter(a => a.action === 'designRoute.applyStep').map(a => a.args.stepId),
    ['scaffold-rewrite', 'fragment-merge', 'open-phe890-pocket', 'finish-bay-293']);
  for (const action of ['protein.prepare', 'pose.captureReference', 'pose.refine', 'pose.apply',
    'protein.parameterize', 'optimization.run', 'pose.addContact', 'geometry.alignBranchToContact',
    'pose.setDesignerLigandPoseFixed', 'pose.enumerateSidechainRotamers', 'pose.applySidechainRotamer',
    'calculation.run', 'history.undo']) assert.ok(pseudo.includes(action));
  assert.equal(source.actions.filter(a => a.action === 'calculation.run').length, 13);
  assert.equal(source.actions.filter(a => a.action === 'history.undo').length, 13);
  for (const a of source.actions.filter(a => a.action === 'pose.refine')) {
    assert.deepEqual(a.args, {execution:'serial', featureSeedingProtocol:'v5', searchChains:8});
  }
  const placement = source.actions[38].args;
  assert.equal(placement.designerPrimaryRotationDegrees, 150);
  assert.deepEqual(placement.upstreamRotationRangeDegrees, [0,60]);
  assert.deepEqual(placement.allowedResponseAtoms.map(a => a.atomName), ['CG','CD1','CD2','CE1','CE2','CZ']);
  assert.match(pseudo, /primary=C12--C15:\+150, upstream=N7--C12:0\.\.60/);
  assert.match(pseudo, /lowest finite energy among zero-severe-clash states/);
  assert.match(pseudo, /replay reapplies the recorded choice; publication verification/);
  assert.match(pseudo, /fresh calculations/);
  assert.deepEqual(source.actions[138].args.chiDegrees, [-180,90]);
  assert.match(pseudo, /chi=\[-180,90\]/);
  assert.match(pseudo, /setDesignerLigandPoseFixed\(false\)[\s\S]*applyStep\(finish-bay-293\)/);
});

test('new human-account outcomes agree with saved candidate evidence, without running molecules', () => {
  const files = readdirSync(new URL('evidence/', release)).filter(n => /phe890-candidate-\d+\.json\.gz$/.test(n));
  const candidates = files.map(gz);
  assert.equal(candidates.length, 13);
  assert.equal(candidates.filter(c => c.severeClashes === 0).length, 2);
  assert.equal(candidates.find(c => c.source === 'input').severeClashes, 11);
  const winner = candidates.filter(c => c.severeClashes === 0 && Number.isFinite(c.fullSystemEnergy))
    .sort((a,b) => a.fullSystemEnergy-b.fullSystemEnergy)[0];
  assert.deepEqual(winner.chiDegrees, [-180,90]);
  const bay = gz('026-candidate-gate.json.gz');
  assert.equal(bay.candidateCount, 8);
  assert.equal(bay.feasibleCount, 3);
  assert.equal(bay.candidateGateSummary.filter(c => c.spatialFeatures.some(f => !f.satisfied)).length, 4);
  assert.equal(bay.candidateGateSummary.filter(c => !c.physicalFeasible).length, 1);
  assert.match(text, /two have zero severe clashes; the unchanged input has 11/);
  assert.match(text, /four others violate feature retention and one fails the physical-feasibility check/);
  const aww = gz('024-prediction-manifest.json.gz');
  assert.equal(aww.designerBranchContact.selected.contacts.outsideAllowedResponseContactCount, 0);
  assert.equal(aww.designerBranchContact.selected.contacts.allowedResponseContactCount, 11);
  assert.equal(aww.designerBranchContact.selected.contactGeometry.donorAcceptorDistanceAngstrom.toFixed(3), '2.829');
  assert.equal(aww.designerBranchContact.selected.contactGeometry.dhaAngleDegrees.toFixed(3), '155.288');
});

test('the edit manifest preserves all unrelated manuscript text and all six figure assets', () => {
  const manifest = json(revision, 'edit-manifest.json');
  const base = new URL(`${manifest.baseRevision}/`, root);
  let original = read(base, 'main.tex').toString();
  assert.equal(sha(original), manifest.baseSourceSha256);
  assert.equal(manifest.changes.length, 2);
  for (const change of manifest.changes) {
    assert.equal(original.split(change.before).length - 1, 1);
    original = original.replace(change.before, change.after);
  }
  assert.equal(original, text);
  for (const name of readdirSync(new URL('figures/', base)))
    assert.deepEqual(read(base, `figures/${name}`), read(revision, `figures/${name}`));
});
