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
const energyOptions = { implicitSolvent:'obc2', nonbondedCutoffNm:1.0,
  constraintMode:'none' };
const allowedResponseAtoms = ['CG','CD1','CD2','CE1','CE2','CZ'].map((atomName) => ({
  residueName:'PHE', chain:'A', residueIndex:890, insertionCode:'', atomName,
}));

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
push('inspect-staged-aww', 'session.inspect', { scope:'ligand', includeCoordinates:true }, {
  scope:'ligand', truncated:false,
  atoms:['C12','C15','CX4','CX5','CX15','CX16'].map((atomName) => ({
    atomName, atomId:`aww:${atomName}`, residueName:'AWW', chain:'A', residueIndex:1104,
  })),
});
push('record-designer-asn879-hypothesis', 'pose.addContact', {
  ligandAtom:{ componentId:'heterogen:A:1104::AWW', atomName:'N7' },
  receptorAtom:{ residueName:'ASN', chain:'A', residueIndex:879,
    insertionCode:'', atomName:'OD1' }, ligandRole:'donor',
}, { contact:{ required:true, origin:{ kind:'user-added-hydrogen-bond-hypothesis' } } });
push('record-designer-tyr884-hypothesis', 'pose.addContact', {
  ligandAtom:{ componentId:'heterogen:A:1104::AWW', atomName:'OX3' },
  receptorAtom:{ residueName:'TYR', chain:'A', residueIndex:884,
    insertionCode:'', atomName:'O' }, ligandRole:'donor',
}, { contact:{ required:true, origin:{ kind:'user-added-hydrogen-bond-hypothesis' },
  contactId:'designer-ox3-tyr884',
  resolvedAtomIds:{ ligand:'aww:OX3', receptor:'protein:A:884:O' } } });
push('align-designer-aww-branch-to-tyr884', 'geometry.alignBranchToContact', {
  axisAtomIds:['aww:C12','aww:C15'],
  solution:'best-directional', contactId:'designer-ox3-tyr884',
  designerPrimaryRotationDegrees:150,
  coupledAxisAtomIds:[['aww:CX4','aww:CX5'],['aww:CX15','aww:CX16']],
  allowedResponseAtoms,
}, { designerBranchContact:{ externalReferenceCoordinatesUsed:false,
  coordinateOrigin:'current-visible-molecule', solution:'best-directional',
  contactId:'designer-ox3-tyr884',
  orderedAxisAtomIds:['aww:C12','aww:C15'],
  coupledAxisAtomIds:[['aww:CX4','aww:CX5'],['aww:CX15','aww:CX16']],
  allowedResponseAtoms,
  allowedResponseResidues:[{ residueName:'PHE', chain:'A', residueIndex:890,
    insertionCode:'' }],
  selected:{ designerPrimaryRotationDegrees:150,
    contactGeometry:{ donorAcceptorDistanceAngstrom:2.9,
      hydrogenAcceptorDistanceAngstrom:1.9, dhaAngleDegrees:160,
      carbonylAcceptorAngleDegrees:120 },
    contacts:{ outsideAllowedResponseContactCount:0, contactsByResidue:[] } } } });
const lockId = 'a'.repeat(64);
push('fix-designer-ligand-intent', 'pose.setDesignerLigandPoseFixed', {
  fixed:true, label:'AWW explicit directional intent',
}, { designerFixedLigandPose:{ active:true, lockId } });
const candidateOneHash = 'b'.repeat(64), candidateTwoHash = 'c'.repeat(64);
const enumeratedCandidates = [
  { rank:1, source:'canonical-chi-grid', chiDegrees:[-60,90],
    coordinateSha256:candidateOneHash },
  { rank:2, source:'canonical-chi-grid', chiDegrees:[180,90],
    coordinateSha256:candidateTwoHash },
];
push('enumerate-all-phe890', 'pose.enumerateSidechainRotamers', {
  receptorResidue:{ residueName:'PHE', chain:'A', residueIndex:890, insertionCode:'' },
  maximumCandidates:64,
}, { sidechainRotamers:{ method:'canonical-chi-grid-steric-prerank-v1',
  residue:{ residueName:'PHE', chain:'A', residueIndex:890, insertionCode:'' },
  generatedCandidateCount:2, candidates:enumeratedCandidates,
  designerFixedLigandPose:{ active:true, lockId },
  ligandPosePolicy:'designer-fixed; receptor branches were ranked without generating or reranking ligand poses' } });
push('apply-phe890-1', 'pose.applySidechainRotamer', {
  coordinateSha256:candidateOneHash, expectedInputCoordinateSha256:'d'.repeat(64),
  expectedSelectedCoordinateSha256:candidateOneHash,
}, { sidechainRotamer:{ residue:{ residueName:'PHE', chain:'A', residueIndex:890,
  insertionCode:'' }, chiDegrees:[-60,90], source:'canonical-chi-grid',
  designerFixedLigandPose:{ active:true, lockId },
  ligandPosePolicy:'designer-fixed; receptor-only branch applied' } });
push('energy-phe890-1', 'calculation.run', {
  job:'energy', method:'openmm', options:energyOptions,
}, { calculation:{ job:'energy', method:'openmm', movedHeavyAtomCount:0,
  maximumDisplacementAngstrom:0, finalEnergy:-10, unit:'kcal/mol' } });
push('apply-phe890-2', 'pose.applySidechainRotamer', {
  coordinateSha256:candidateTwoHash, expectedInputCoordinateSha256:'d'.repeat(64),
  expectedSelectedCoordinateSha256:candidateTwoHash,
}, { sidechainRotamer:{ residue:{ residueName:'PHE', chain:'A', residueIndex:890,
  insertionCode:'' }, chiDegrees:[180,90], source:'canonical-chi-grid',
  designerFixedLigandPose:{ active:true, lockId },
  ligandPosePolicy:'designer-fixed; receptor-only branch applied' } });
push('energy-phe890-2', 'calculation.run', {
  job:'energy', method:'openmm', options:energyOptions,
}, { calculation:{ job:'energy', method:'openmm', movedHeavyAtomCount:0,
  maximumDisplacementAngstrom:0, finalEnergy:-12, unit:'kcal/mol' } });
push('apply-energy-selected-phe890', 'pose.applySidechainRotamer', {
  chiDegrees:[180,90], expectedInputCoordinateSha256:'d'.repeat(64),
  expectedSelectedCoordinateSha256:candidateTwoHash,
}, { sidechainRotamer:{ residue:{ residueName:'PHE', chain:'A', residueIndex:890,
  insertionCode:'' }, chiDegrees:[180,90], source:'canonical-chi-grid',
  selectedCoordinateSha256:candidateTwoHash,
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
  designerIntent:{ action:'geometry.alignBranchToContact',
    orderedAxisAtomNames:['C12','C15'], designerPrimaryRotationDegrees:150,
    coupledAxisAtomNames:[['CX4','CX5'],['CX15','CX16']],
    directionalContact:{ ligandAtom:'AWW OX3', receptorAtom:'TYR A884 O',
      contactIdSource:'result.contact.contactId from the preceding pose.addContact action' },
    solution:'best-directional', currentSceneCoordinatesOnly:true,
    externalReferenceCoordinatesUsed:false,
    allowedResponseAtoms,
    hypothesesAreScoringResults:false },
  receptorPrediction:{ residue:{ residueName:'PHE', chain:'A', residueIndex:890 },
    energy:{ job:'energy', method:'openmm', options:energyOptions,
      coordinatePolicy:'fixed-coordinate single-point; no optimization or dynamics' },
    everyEnumeratedCandidateEvaluated:true, ligandCoordinatesFixed:true },
  laterStructureAccess:false };
const candidateInspection = (hash) => ({ truncated:false,
  atoms:[{ atomId:'ligand:AWW:C1', atomName:'C1', residueName:'AWW',
    residueIndex:1104, coordinatesAngstrom:[0,0,0] }], bonds:[] });
const candidateValues = [
  { ordinal:1, rank:1, source:'canonical-chi-grid', chiDegrees:[-60,90],
    coordinateSha256:candidateOneHash, severeClashes:0, fullSystemEnergy:-10,
    energyUnit:'kcal/mol' },
  { ordinal:2, rank:2, source:'canonical-chi-grid', chiDegrees:[180,90],
    coordinateSha256:candidateTwoHash, severeClashes:0, fullSystemEnergy:-12,
    energyUnit:'kcal/mol' },
];
const candidateDescriptors = [];
for (const candidate of candidateValues) {
  const value = { ...candidate, coordinatesSaved:true,
    ligand:candidateInspection(candidate.coordinateSha256),
    pocket:candidateInspection(candidate.coordinateSha256),
    energy:{ job:'energy', method:'openmm', options:energyOptions,
      assertedZeroCoordinateMotion:true,
      result:{ movedHeavyAtomCount:0, maximumDisplacementAngstrom:0 } } };
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const filename = `phe890-candidate-${String(candidate.ordinal).padStart(2, '0')}.json`;
  await writeFile(join(run, filename), bytes);
  candidateDescriptors.push({ filename, bytes:bytes.length, sha256:sha256(bytes) });
}
const currentRecords = records.slice(5);
const energyRecords = currentRecords.filter((record) => record.action === 'calculation.run');
const boundaryBytes = Buffer.from(`${JSON.stringify(boundary, null, 2)}\n`);
const boundaryDescriptor = { filename:'boundary.json', bytes:boundaryBytes.length,
  sha256:sha256(boundaryBytes) };
const manifest = { schema:'molarium.sos1-aww-receptor-only-prospective/v1',
  status:'prediction-frozen-later-structures-unopened', publicationEligible:true,
  source:boundary.source,
  scientificContract:{ laterStructureAccess:false, receptorOnly:true,
    poseRefinementUsed:false, optimizationUsed:false,
    ligandIntentFrozenBeforeReceptorPrediction:true, ligandCoordinateEquality:true,
    everyEnumeratedReceptorCandidateEvaluated:true,
    designerFixedLigandPoseLockId:lockId },
  designerFixedLigandPose:{ active:true, lockId },
  fixedLigand:{ before:fixedLigand, after:fixedLigand, exactEquality:true },
  phe890Selection:{ generatedCandidateCount:2, evaluatedCandidateCount:2,
    everyGeneratedCandidateEvaluated:true, candidateFiles:candidateDescriptors,
    selectedCoordinateSha256:candidateTwoHash, selectedFullSystemEnergy:-12 },
  checkpoints:checkpointEntries,
  boundary:boundaryDescriptor,
  evidence:{ boundary:boundaryDescriptor, audit:null, coordinateInspections:null,
    phe890Candidates:candidateDescriptors },
  currentRun:{ actionCount:currentRecords.length, currentRunRequestIds,
    firstSequence:currentRecords[0].sequence, lastSequence:currentRecords.at(-1).sequence,
    actions:currentRecords.map((record) => record.action),
    energyCalculations:energyRecords.map((record) => ({ requestId:record.requestId,
      job:record.args.job, method:record.args.method, options:record.args.options,
      movedHeavyAtomCount:0, maximumDisplacementAngstrom:0,
      assertedZeroCoordinateMotion:true })), prohibitedActionsObserved:[] } };
const inspection = { schema:'molarium.sos1-aww-receptor-only-coordinate-evidence/v1',
  sourceCampaignSha256:sha256(sourceBytes),
  designerFixedLigandPose:{ active:true, lockId },
  fixedLigand:{ before:fixedLigand, after:fixedLigand, exactEquality:true },
  phe890CandidateFiles:candidateDescriptors.map((file, index) => ({
    ordinal:index + 1, coordinateSha256:[candidateOneHash,candidateTwoHash][index], file,
  })),
  inspections:{ stagedLigand:{ atoms:['C12','C15','CX4','CX5','CX15','CX16']
    .map((atomName) => ({ atomName, atomId:`aww:${atomName}`, residueName:'AWW',
      residueIndex:1104 })) } } };
const inspectionBytes = Buffer.from(`${JSON.stringify(inspection, null, 2)}\n`);
const auditBytes = Buffer.from(`${JSON.stringify(audit, null, 2)}\n`);
manifest.evidence.audit = { filename:'chemist-action-audit.json',
  bytes:auditBytes.length, sha256:sha256(auditBytes) };
manifest.evidence.coordinateInspections = { filename:'coordinate-inspections.json',
  bytes:inspectionBytes.length, sha256:sha256(inspectionBytes) };
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
for (const action of ['geometry.alignBranchToContact','pose.addContact',
  'pose.setDesignerLigandPoseFixed','pose.enumerateSidechainRotamers',
  'pose.applySidechainRotamer'])
  assert(publication.executable.actions.some((step) => step.action === action),
    `executable story omits ${action}`);
assert.equal(publication.executable.actions.some((step) =>
  ['geometry.setInternalCoordinate','pose.refine','pose.apply','optimization.run']
    .includes(step.action)), false);
const executableActions = publication.executable.actions.map((step) => step.action);
const contactIndices = executableActions.flatMap((action, index) =>
  action === 'pose.addContact' ? [index] : []);
const alignmentIndex = executableActions.indexOf('geometry.alignBranchToContact');
const lockIndex = executableActions.indexOf('pose.setDesignerLigandPoseFixed');
assert.equal(contactIndices.length, 2);
assert(contactIndices.every((index) => index < alignmentIndex));
assert(alignmentIndex < lockIndex);
assert.deepEqual(publication.executable.actions[alignmentIndex].args.axisAtomSelectors,
  ['C12','C15'].map((atomName) => ({ componentId:'heterogen:A:1104::AWW', atomName })));
assert.equal(Object.hasOwn(publication.executable.actions[alignmentIndex].args, 'axisAtomIds'), false);
const portableRotamer = publication.executable.actions.find((step) =>
  step.action === 'pose.applySidechainRotamer');
assert.deepEqual(portableRotamer.args, { chiDegrees:[-60,90] });
assert.equal(publication.declaration.scientificContract.laterCrystalCoordinatesUsed, false);
assert.deepEqual(publication.declaration.scientificContract.predictedDegreesOfFreedom,
  ['PHE A890 side chain']);
assert.equal(publication.declaration.scientificValidation.accepted, true);
assert(!/5OV[F-I]/.test(publication.executableBytes.toString()));

const legacyBoundary = structuredClone(boundary);
legacyBoundary.designerIntent = { action:'geometry.setInternalCoordinate',
  atomNames:['N7','C12','C15','CX2'], relativeRotationDegrees:180,
  moveConnected:true, hypothesesAreScoringResults:false };
await writeFile(join(run, 'boundary.json'),
  `${JSON.stringify(legacyBoundary, null, 2)}\n`);
await assert.rejects(() => verifySos1AwwReceptorOnlyRun(run, { root }),
  /prospective boundary byte count changed|prospective boundary bytes changed/);
await writeFile(join(run, 'boundary.json'), `${JSON.stringify(boundary, null, 2)}\n`);

const legacyAudit = structuredClone(audit);
const legacyAlignment = legacyAudit.records.find((record) =>
  record.action === 'geometry.alignBranchToContact');
legacyAlignment.action = 'geometry.setInternalCoordinate';
legacyAlignment.args = { atomIds:['aww:N7','aww:C12','aww:C15','aww:CX2'],
  value:173.5, moveConnected:true };
legacyAlignment.result = { internalCoordinate:{ kind:'torsion', moveConnected:true } };
await writeFile(join(run, 'chemist-action-audit.json'),
  `${JSON.stringify(legacyAudit, null, 2)}\n`);
await assert.rejects(() => verifySos1AwwReceptorOnlyRun(run, { root }),
  /current-run.*actions|deeply equal|action audit|audit.*changed/i);
await writeFile(join(run, 'chemist-action-audit.json'),
  `${JSON.stringify(audit, null, 2)}\n`);

const wrongOrderAudit = structuredClone(audit);
const wrongOrderAlignment = wrongOrderAudit.records.find((record) =>
  record.action === 'geometry.alignBranchToContact');
const firstContact = wrongOrderAudit.records.find((record) => record.action === 'pose.addContact');
[wrongOrderAlignment.sequence, firstContact.sequence] =
  [firstContact.sequence, wrongOrderAlignment.sequence];
await writeFile(join(run, 'chemist-action-audit.json'),
  `${JSON.stringify(wrongOrderAudit, null, 2)}\n`);
await assert.rejects(() => verifySos1AwwReceptorOnlyRun(run, { root }),
  /current-run actions|current-run sequences|ordered graph\/contact\/directional-geometry\/lock\/Phe response|action audit|audit.*changed/i);
await writeFile(join(run, 'chemist-action-audit.json'),
  `${JSON.stringify(audit, null, 2)}\n`);

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
  /currentRunRequestIds|legacy torsion, ligand-moving action, or coupled relaxation|action audit|audit.*changed/i);

console.log('SOS1 AWW receptor-only publication adapter: exact campaigns, public-action replay, calculation-free review, fixed ligand, and no holdouts PASS');
