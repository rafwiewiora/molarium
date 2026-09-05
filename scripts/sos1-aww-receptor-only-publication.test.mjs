import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { commitMolecule, createCampaign, storeSnapshot } from
  '../design-history/ledger.mjs';
import { serializeCampaign } from '../design-history/live-campaign-store.mjs';
import { buildSos1AwwReceptorOnlyPublicationRecords, sha256,
  verifySos1AwwReceptorOnlyRun } from './sos1-aww-receptor-only-publication.mjs';

const root = await mkdtemp(join(tmpdir(), 'molarium-aww-publication-'));
const run = join(root, 'run');
await mkdir(run);
await mkdir(join(root, 'source'));

const campaign = createCampaign({ campaignId:'aww-publication-test',
  title:'AWW publication test', createdAt:'2026-09-04T00:00:00.000Z',
  actors:[{ id:'agent.test', type:'agent', displayName:'Test agent' }] });
let parent = null;
for (const [index, stateId] of ['AXE','AWT','AWZ'].entries()) {
  const snapshotId = await storeSnapshot(campaign, { label:stateId,
    graph:{ atoms:[{ atomId:`ligand:${stateId}:C1`, atomName:'C1', element:'C',
      formalCharge:0, record:'HETATM', residueName:stateId, chain:'A', residueIndex:1104 }],
      bonds:[] },
    coordinates:{ unit:'angstrom', atomIds:[`ligand:${stateId}:C1`],
      positions:[[index,0,0]] },
    properties:{ molecule:{ source:{ designRoute:{ stateId } } } } });
  parent = await commitMolecule(campaign, { snapshotId,
    parents:parent ? [parent] : [], branch:'main',
    message:index === 0 ? 'Capture the prepared 5OVE/AXE coordinate boundary'
      : index === 1 ? 'Freeze scaffold-rewrite prospective molecular state'
        : 'Freeze fragment-merge prospective molecular state',
    actorId:'agent.test', occurredAt:`2026-09-04T00:0${index}:00.000Z`,
    tags:['prospective'] });
}
const sourceBytes = Buffer.from(serializeCampaign(campaign));
const sourcePath = 'source/fragment-merge-campaign.json';
await writeFile(join(root, sourcePath), sourceBytes);

async function appendCheckpoint(key, filename, label, coordinate) {
  const snapshotId = await storeSnapshot(campaign, { label,
    graph:{ atoms:[{ atomId:'ligand:AWW:C1', atomName:'C1', element:'C',
      formalCharge:0, record:'HETATM', residueName:'AWW', chain:'A', residueIndex:1104 }],
      bonds:[] },
    coordinates:{ unit:'angstrom', atomIds:['ligand:AWW:C1'],
      positions:[[coordinate,0,0]] },
    properties:{ molecule:{ source:{ designRoute:{ stateId:'AWW' } } } } });
  const commitId = await commitMolecule(campaign, { snapshotId, parents:[parent], branch:'main',
    message:label, actorId:'agent.test', occurredAt:`2026-09-04T00:1${coordinate}:00.000Z`,
    tags:['prospective','AWW'] });
  parent = commitId;
  const bytes = Buffer.from(serializeCampaign(campaign));
  await writeFile(join(run, filename), bytes);
  return [key, { filename, bytes:bytes.length, sha256:sha256(bytes), commitId, snapshotId }];
}

const checkpointEntries = Object.fromEntries([
  await appendCheckpoint('graphOnly', 'aww-graph-campaign.json',
    'Freeze AWW graph before directional intent', 3),
  await appendCheckpoint('ligandIntent', 'aww-designer-ligand-intent-campaign.json',
    'Freeze explicit AWW ligand directional intent', 4),
  await appendCheckpoint('receptorResponse', 'aww-receptor-only-prediction-campaign.json',
    'Freeze receptor-only Phe890 response', 5),
]);

let sequence = 0;
const records = [];
const push = (requestId, action, args = {}, result = {}) => {
  const record = { schema:'molarium.chemist-actions/v1', sequence:++sequence,
    requestId, action, args, status:'completed', result };
  records.push(record);
  return record;
};
push('setup-import', 'campaign.import', {});
push('setup-verify', 'campaign.verify', {});
push('setup-resume', 'designRoute.resume', { routeId:'sos1-hit-only', stateId:'AWZ' });
push('setup-mode', 'view.setMode', { mode:'build' });
push('setup-reference', 'pose.captureReference', { mode:'propagate' });
push('apply-aww-graph', 'designRoute.applyStep', { stepId:'open-phe890-pocket' }, {
  designStep:{ referenceStateId:'AWZ', stateId:'AWW', inputKind:'molecular-graph-only' },
});
push('set-designer-aww-torsion', 'geometry.setInternalCoordinate', {
  atomIds:['aww:N7','aww:C12','aww:C15','aww:CX2'], value:173.5, moveConnected:true,
}, { internalCoordinate:{ kind:'torsion', moveConnected:true } });
push('record-designer-asn879-hypothesis', 'pose.addContact', {
  ligandAtom:{ componentId:'heterogen:A:1104::AWW', atomName:'N7' },
  receptorAtom:{ residueName:'ASN', chain:'A', residueIndex:879,
    insertionCode:'', atomName:'OD1' }, ligandRole:'donor',
}, { contact:{ required:true, origin:{ kind:'user-added-hydrogen-bond-hypothesis' } } });
push('record-designer-tyr884-hypothesis', 'pose.addContact', {
  ligandAtom:{ componentId:'heterogen:A:1104::AWW', atomName:'OX3' },
  receptorAtom:{ residueName:'TYR', chain:'A', residueIndex:884,
    insertionCode:'', atomName:'O' }, ligandRole:'donor',
}, { contact:{ required:true, origin:{ kind:'user-added-hydrogen-bond-hypothesis' } } });
const lockId = 'a'.repeat(64);
push('fix-designer-ligand-intent', 'pose.setDesignerLigandPoseFixed', {
  fixed:true, label:'AWW explicit directional intent',
}, { designerFixedLigandPose:{ active:true, lockId } });
push('enumerate-phe890', 'pose.enumerateSidechainRotamers', {
  receptorResidue:{ residueName:'PHE', chain:'A', residueIndex:890, insertionCode:'' },
  maximumCandidates:32,
}, { sidechainRotamers:{ method:'canonical-chi-grid-steric-prerank-v1',
  residue:{ residueName:'PHE', chain:'A', residueIndex:890, insertionCode:'' },
  generatedCandidateCount:8, designerFixedLigandPose:{ active:true, lockId },
  ligandPosePolicy:'designer-fixed; receptor branches were ranked without generating or reranking ligand poses' } });
push('apply-top-phe890-steric-rank', 'pose.applySidechainRotamer', {
  coordinateSha256:'b'.repeat(64), expectedInputCoordinateSha256:'c'.repeat(64),
  expectedSelectedCoordinateSha256:'b'.repeat(64),
}, { sidechainRotamer:{ residue:{ residueName:'PHE', chain:'A', residueIndex:890,
  insertionCode:'' }, chiDegrees:[-60,90], source:'canonical-chi-grid',
  designerFixedLigandPose:{ active:true, lockId },
  ligandPosePolicy:'designer-fixed; receptor-only branch applied' } });
push('inspect-ligand-after-phe', 'session.inspect', {
  scope:'ligand', includeCoordinates:true, maximumAtoms:256,
});
const currentRunRequestIds = records.slice(5).map((record) => record.requestId);
const audit = { schema:'molarium.chemist-actions/v1', protocol:
  'molarium.sos1-aww-receptor-only-prospective/v1',
  sourceCampaignSha256:sha256(sourceBytes), currentRunRequestIds, records };

const fixedLigand = { atomCount:31, bondCount:33,
  coordinateSha256:'d'.repeat(64), stateSha256:'e'.repeat(64) };
const boundary = { schema:'molarium.sos1-aww-receptor-only-prospective/v1',
  status:'declared-before-compute',
  source:{ stateId:'AWZ', kind:'exact-frozen-full-system-campaign',
    path:sourcePath, sha256:sha256(sourceBytes),
    coordinateLineage:'registered 5OVE/AXE coordinate boundary' },
  product:{ stateId:'AWW', graphInput:'reported molecular graph only' },
  designerIntent:{ action:'geometry.setInternalCoordinate',
    atomNames:['N7','C12','C15','CX2'], relativeRotationDegrees:180,
    moveConnected:true, hypothesesAreScoringResults:false },
  receptorPrediction:{ residue:{ residueName:'PHE', chain:'A', residueIndex:890 },
    ligandCoordinatesFixed:true }, laterStructureAccess:false };
const manifest = { schema:'molarium.sos1-aww-receptor-only-prospective/v1',
  status:'prediction-frozen-later-structures-unopened', publicationEligible:true,
  source:boundary.source,
  scientificContract:{ laterStructureAccess:false, receptorOnly:true,
    poseRefinementUsed:false, optimizationUsed:false,
    ligandIntentFrozenBeforeReceptorPrediction:true, ligandCoordinateEquality:true },
  fixedLigand:{ before:fixedLigand, after:fixedLigand, exactEquality:true },
  checkpoints:checkpointEntries };
const inspection = { schema:'molarium.sos1-aww-receptor-only-coordinate-evidence/v1',
  sourceCampaignSha256:sha256(sourceBytes),
  fixedLigand:{ before:fixedLigand, after:fixedLigand, exactEquality:true } };
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const validation = {
  schema:'molarium.sos1-aww-receptor-only-validation/v1',
  predictionManifestSha256:sha256(manifestBytes), accepted:true,
  predictionFrozenBeforeValidationAccess:true, measurementOnly:true,
  holdoutCoordinatesIncluded:false, failedChecks:[],
  checks:{
    phe890:{ accepted:true, circularDifferenceDegrees:4.2, toleranceDegrees:15 },
    designerInteraction:{ accepted:true, donorAcceptorDistanceAngstrom:2.8,
      maximumDistanceAngstrom:3.5 },
  },
};
for (const [name, value] of Object.entries({
  'prediction-manifest.json':manifest, 'boundary.json':boundary,
  'chemist-action-audit.json':audit, 'coordinate-inspections.json':inspection,
  'post-freeze-validation.json':validation,
})) await writeFile(join(run, name), `${JSON.stringify(value, null, 2)}\n`);

const verified = await verifySos1AwwReceptorOnlyRun(run, { root });
assert.equal(verified.runId, 'run');
assert.deepEqual(Object.keys(verified.checkpoints),
  ['graphOnly','ligandIntent','receptorResponse']);

const upstreamRecords = [];
const upstreamPush = (requestId, action, args = {}) => upstreamRecords.push({
  schema:'molarium.chemist-actions/v1', sequence:upstreamRecords.length + 1,
  requestId, action, args, status:'completed', result:{},
});
upstreamPush('route-load-hit', 'designRoute.load', { routeId:'sos1-hit-only' });
upstreamPush('route-enter-build', 'view.setMode', { mode:'build' });
upstreamPush('route-capture-hit', 'pose.captureReference', { mode:'propagate' });
upstreamPush('scaffold-rewrite-stage', 'designRoute.applyStep', {
  stepId:'scaffold-rewrite' });
upstreamPush('fragment-merge-stage', 'designRoute.applyStep', {
  stepId:'fragment-merge' });
upstreamPush('fragment-merge-capture-predicted-reference', 'pose.captureReference', {
  mode:'propagate' });
const upstreamAudit = { schema:'molarium.chemist-actions/v1',
  routeId:'sos1-hit-only', records:upstreamRecords };
const upstreamBytes = Buffer.from(`${JSON.stringify(upstreamAudit)}\n`);
const publication = await buildSos1AwwReceptorOnlyPublicationRecords(verified, {
  upstream:{ audit:upstreamAudit, auditBytes:upstreamBytes,
    sourceCampaignSha256:sha256(sourceBytes) },
});
assert.deepEqual(publication.campaignAssets.map((asset) => asset.id), [
  'starting-hit','scaffold-rewrite','fragment-merge','aww-graph',
  'aww-designer-intent','aww-phe890-response',
]);
assert.deepEqual(publication.review.actions.map((step) => step.action),
  Array(6).fill('campaign.import'));
assert.deepEqual(publication.review.actions.map((step) => step.args.preserveView),
  [false,true,true,true,true,true]);
assert.equal(publication.review.provenance.calculationPolicy, 'none');
assert.equal(publication.review.provenance.promotable, false);
assert.equal(publication.executable.actions[0].action, 'designRoute.load');
assert.equal(publication.executable.actions.some((step) =>
  step.action === 'campaign.import'), false);
assert.deepEqual(publication.executable.actions
  .filter((step) => step.action === 'designRoute.applyStep')
  .map((step) => step.args.stepId),
['scaffold-rewrite','fragment-merge','open-phe890-pocket']);
for (const action of ['geometry.setInternalCoordinate','pose.addContact',
  'pose.setDesignerLigandPoseFixed','pose.enumerateSidechainRotamers',
  'pose.applySidechainRotamer'])
  assert(publication.executable.actions.some((step) => step.action === action),
    `executable story omits ${action}`);
assert.equal(publication.executable.actions.some((step) =>
  ['pose.refine','pose.apply','optimization.run','calculation.run'].includes(step.action)), false);
const portableRotamer = publication.executable.actions.find((step) =>
  step.action === 'pose.applySidechainRotamer');
assert.deepEqual(portableRotamer.args, { chiDegrees:[-60,90] });
assert.equal(publication.declaration.scientificContract.laterCrystalCoordinatesUsed, false);
assert.deepEqual(publication.declaration.scientificContract.predictedDegreesOfFreedom,
  ['PHE A890 side chain']);
assert.equal(publication.declaration.scientificValidation.accepted, true);
assert(!/5OV[F-I]/.test(publication.executableBytes.toString()));

const rejectedValidation = structuredClone(validation);
rejectedValidation.accepted = false;
rejectedValidation.failedChecks = ['phe890'];
rejectedValidation.checks.phe890.accepted = false;
await writeFile(join(run, 'post-freeze-validation.json'),
  `${JSON.stringify(rejectedValidation, null, 2)}\n`);
await assert.rejects(() => verifySos1AwwReceptorOnlyRun(run, { root }),
  /scientific validation did not accept/);
await writeFile(join(run, 'post-freeze-validation.json'),
  `${JSON.stringify(validation, null, 2)}\n`);

const movedManifest = structuredClone(manifest);
movedManifest.fixedLigand.after = { ...fixedLigand, coordinateSha256:'f'.repeat(64) };
await writeFile(join(run, 'prediction-manifest.json'),
  `${JSON.stringify(movedManifest, null, 2)}\n`);
await assert.rejects(() => verifySos1AwwReceptorOnlyRun(run, { root }),
  /exact ligand-state equality/);
await writeFile(join(run, 'prediction-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`);

const prohibitedAudit = structuredClone(audit);
prohibitedAudit.records.push({ schema:'molarium.chemist-actions/v1',
  sequence:prohibitedAudit.records.length + 1, requestId:'forbidden-refine',
  action:'pose.refine', args:{ searchChains:8 }, status:'completed', result:{} });
prohibitedAudit.currentRunRequestIds.push('forbidden-refine');
await writeFile(join(run, 'chemist-action-audit.json'),
  `${JSON.stringify(prohibitedAudit, null, 2)}\n`);
await assert.rejects(() => verifySos1AwwReceptorOnlyRun(run, { root }),
  /ligand-moving or coupled calculation/);

console.log('SOS1 AWW receptor-only publication adapter: exact campaigns, public-action replay, calculation-free review, fixed ligand, and no holdouts PASS');
