import assert from 'node:assert/strict';
import { cloneRecord } from './integrity.mjs';
import { verifyCampaign } from './ledger.mjs';
import {
  commitLiveMolecule,
  createLiveBranch,
  createLiveCampaign,
  deriveLastAuditSequence,
  mergeCurrentMolecule,
  moleculeFromCampaignCommit,
  moleculeMatchesSnapshot,
  recordLiveCampaignDecision,
  snapshotPayloadFromMolecule,
} from './live-campaign.mjs';
import { campaignStorageRecord, deserializeCampaign, serializeCampaign } from './live-campaign-store.mjs';

const T0 = '2026-09-02T12:00:00.000Z';
const molecule = { name:'ethylamine', smiles:'CCN', canonicalSmiles:'CCN', charge:0,
  multiplicity:1, pointGroup:'C1', symmetryNumber:1,
  source:{ source:'test fixture', chemistActionAudit:[{ ignored:true }] },
  atoms:[
    { designAtomId:'design:c1', element:'C', x:0, y:0, z:0 },
    { designAtomId:'design:c2', element:'C', x:1.5, y:0, z:0 },
    { designAtomId:'design:n1', element:'N', formalCharge:0, x:2.7, y:0.4, z:0 },
  ], bonds:[{ a:0, b:1, order:1 }, { a:1, b:2, order:1 }] };
const audit = [
  { sequence:1, requestId:'a1', action:'view.setMode', args:{ mode:'build' }, status:'completed' },
  { sequence:2, requestId:'a2', action:'campaign.create', args:{ campaignId:'ignored' }, status:'completed' },
  { sequence:3, requestId:'a3', action:'selection.clear', args:{}, status:'failed' },
  { sequence:4, requestId:'a4', action:'selection.clear', args:{}, status:'completed' },
];

const firstPayload = snapshotPayloadFromMolecule(molecule, { label:'first' });
const secondPayload = snapshotPayloadFromMolecule(cloneRecord(molecule), { label:'first' });
assert.deepEqual(firstPayload, secondPayload);
assert.deepEqual(firstPayload.coordinates.atomIds, ['design:c1','design:c2','design:n1']);
assert.equal(firstPayload.properties.molecule.source.chemistActionAudit, undefined);
const chargedPayload = snapshotPayloadFromMolecule({ ...molecule,
  atoms:molecule.atoms.map((atom, index) => index === 2
    ? { ...atom, formalCharge:undefined, charge:1, occupancy:0.75, altLoc:'A' } : atom) });
assert.equal(chargedPayload.graph.atoms[2].formalCharge, 1);
assert.equal(chargedPayload.graph.atoms[2].occupancy, 0.75);
assert.equal(chargedPayload.graph.atoms[2].altLoc, 'A');
assert.equal(moleculeFromCampaignCommit({ objects:{ commits:{ charged:{ snapshotId:'charged' } },
  snapshots:{ charged:{ ...chargedPayload, schema:'molarium.molecule-snapshot/v1' } } } },
  'charged').atoms[2].charge, 1);
const proteinPayload = snapshotPayloadFromMolecule({ ...molecule,
  source:{ format:'pdb', pdbId:'5OVE' },
  atoms:[
    { designAtomId:'protein:n', element:'N', atomName:'N', record:'ATOM',
      residueName:'GLY', residueIndex:1, chain:'A', x:0, y:0, z:0 },
    { designAtomId:'protein:ca', element:'C', atomName:'CA', record:'ATOM',
      residueName:'GLY', residueIndex:1, chain:'A', x:1.4, y:0, z:0 },
    { designAtomId:'ligand:c', element:'C', atomName:'C1', record:'HETATM',
      residueName:'LIG', residueIndex:2, chain:'A', x:2.8, y:0, z:0 },
  ], bonds:[{ a:0, b:1, order:1 }] });
const restoredProtein = moleculeFromCampaignCommit({ objects:{
  commits:{ protein:{ snapshotId:'protein' } },
  snapshots:{ protein:{ ...proteinPayload, schema:'molarium.molecule-snapshot/v1' } },
} }, 'protein');
assert.equal(restoredProtein.prediction.kind, 'pdb-import');
assert.equal(restoredProtein.prediction.provider, 'campaign-checkpoint');
assert.equal(restoredProtein.source.pdbId, '5OVE');
assert.equal(restoredProtein.source.proteinAtoms, 2);
assert.equal(restoredProtein.source.residues, 1);
assert.equal(await moleculeMatchesSnapshot(restoredProtein,
  { ...proteinPayload, schema:'molarium.molecule-snapshot/v1' }), true,
  'derived viewer metadata must not change the canonical molecular snapshot');
assert.throws(() => snapshotPayloadFromMolecule({ ...molecule,
  atoms:molecule.atoms.map((atom) => ({ ...atom, designAtomId:null })) }), /persistent designAtomId/);

const initial = await createLiveCampaign({ campaignId:'ethylamine-design', title:'Ethylamine design',
  actorId:'chemist.test', actorDisplayName:'Test Chemist', createdAt:T0 });
assert.equal(initial.events[0].kind, 'campaign.started');
assert.equal((await verifyCampaign(initial)).valid, true);

const first = await commitLiveMolecule(initial, { molecule, audit, branch:'main',
  message:'capture starting design', actorId:'chemist.test', occurredAt:'2026-09-02T12:01:00.000Z' });
assert.equal(first.committedThroughSequence, 4);
assert.ok(first.actionScriptId);
const firstScript = first.campaign.objects.actionScripts[first.actionScriptId];
assert.deepEqual(firstScript.actions
  .map((step) => step.action), ['view.setMode','selection.clear']);
assert.equal(firstScript.expectedStartSnapshotId, null);
assert.equal(firstScript.expectedEndSnapshotId, null);
assert.deepEqual(firstScript.coverage, { kind:'public-actions-only', complete:false,
  directUiMutationsCapturedOnlyInSnapshot:true, auditTruncated:false,
  firstRetainedSequence:1, lastCommittedSequence:0, committedThroughSequence:4 });
const reconstructed = moleculeFromCampaignCommit(first.campaign, first.commitId);
assert.equal(await moleculeMatchesSnapshot(reconstructed,
  first.campaign.objects.snapshots[first.snapshotId]), true);
reconstructed.atoms[0].x += 0.25;
assert.equal(await moleculeMatchesSnapshot(reconstructed,
  first.campaign.objects.snapshots[first.snapshotId]), false);
assert.equal(deriveLastAuditSequence(first.campaign), 4);
assert.equal(Object.keys(initial.objects.commits).length, 0, 'commit transaction must not mutate its input');

const branch = await createLiveBranch(first.campaign, { branch:'series.fluoro',
  fromCommitId:first.commitId, actorId:'chemist.test', occurredAt:'2026-09-02T12:02:00.000Z' });
assert.equal(branch.head, first.commitId);
const branchMolecule = cloneRecord(molecule);
branchMolecule.atoms[2].x = 2.9;
const branchCommit = await commitLiveMolecule(branch.campaign, { molecule:branchMolecule,
  audit:[...audit, { sequence:5, requestId:'a5', action:'view.setMode',
    args:{ mode:'view' }, status:'completed' }], branch:'series.fluoro', message:'move branch',
  actorId:'chemist.test', occurredAt:'2026-09-02T12:03:00.000Z', lastAuditSequence:4 });
assert.deepEqual(branchCommit.campaign.objects.commits[branchCommit.commitId].parents, [first.commitId]);

const mainMolecule = cloneRecord(molecule); mainMolecule.atoms[0].y = 0.2;
const mainCommit = await commitLiveMolecule(branchCommit.campaign, { molecule:mainMolecule,
  audit, branch:'main', message:'main alternative', actorId:'chemist.test',
  occurredAt:'2026-09-02T12:04:00.000Z', lastAuditSequence:4 });
assert.equal(mainCommit.actionScriptId, null);

const merged = await mergeCurrentMolecule(mainCommit.campaign, { sourceBranch:'series.fluoro',
  targetBranch:'main', molecule:branchMolecule, audit, message:'select fluoro geometry',
  actorId:'chemist.test', occurredAt:'2026-09-02T12:05:00.000Z', lastAuditSequence:4 });
assert.deepEqual(merged.campaign.objects.commits[merged.commitId].parents,
  [mainCommit.commitId, branchCommit.commitId]);
const decision = await recordLiveCampaignDecision(merged.campaign, {
  targetCommitId:merged.commitId, disposition:'progressed', reasonCodes:['potency'],
  rationale:'Advance the selected branch', actorId:'chemist.test',
  occurredAt:'2026-09-02T12:06:00.000Z', branch:'main' });
assert.equal((await verifyCampaign(decision.campaign)).valid, true);
assert.equal(decision.event.kind, 'decision.recorded');

const beforeFailure = serializeCampaign(decision.campaign);
await assert.rejects(() => commitLiveMolecule(decision.campaign, { molecule:{ ...molecule,
  atoms:molecule.atoms.map((atom) => ({ ...atom, x:NaN })) }, audit, branch:'main',
  message:'invalid', actorId:'chemist.test', occurredAt:T0 }), /invalid coordinates/);
assert.equal(serializeCampaign(decision.campaign), beforeFailure,
  'failed transaction must not mutate the campaign');

const serialized = serializeCampaign(decision.campaign);
assert.deepEqual(deserializeCampaign(serialized), JSON.parse(serialized));
const record = campaignStorageRecord(decision.campaign, { activeBranch:'main', updatedAt:T0 });
assert.equal(record.campaignId, decision.campaign.campaignId);
assert.equal(record.activeBranch, 'main');
assert.equal(record.updatedAt, T0);
assert.deepEqual(deserializeCampaign(record.campaignJson), decision.campaign);

console.log(`live campaign tests passed: ${Object.keys(decision.campaign.objects.commits).length} commits, ${Object.keys(decision.campaign.branches).length} branches, persistent JSON round-trip`);
