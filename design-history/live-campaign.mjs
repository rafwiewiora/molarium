import { cloneRecord, sha256Object } from './integrity.mjs';
import { actionScriptFromAudit } from './replay.mjs';
import {
  appendEvent,
  commitMolecule,
  createBranch,
  createCampaign,
  mergeBranch,
  recordDecision,
  storeActionScript,
  storeSnapshot,
  SNAPSHOT_SCHEMA,
  verifyCampaign,
} from './ledger.mjs';

export const LIVE_CAMPAIGN_COMPILER = Object.freeze({
  name:'Molarium live campaign compiler',
  version:'1',
});

function iso(value, label) {
  const result = value == null ? new Date().toISOString() : String(value);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an ISO date-time`);
  return result;
}

function text(value, fallback = '') {
  return value == null ? fallback : String(value);
}

function plainSource(source = {}) {
  const allowed = ['source', 'format', 'pdbId', 'pubchemCid', 'routeId', 'registeredRouteId',
    'componentId', 'chain', 'residueIndex', 'canonicalSmiles'];
  return Object.fromEntries(allowed.flatMap((key) => {
    const value = source?.[key];
    return value == null || !['string', 'number', 'boolean'].includes(typeof value)
      ? [] : [[key, value]];
  }));
}

function atomRecord(atom, index) {
  const atomId = text(atom?.designAtomId).trim();
  if (!atomId) throw new Error(`Molecule atom ${index + 1} has no persistent designAtomId`);
  const formalCharge = Number(atom.formalCharge ?? atom.charge ?? 0);
  if (!Number.isFinite(formalCharge))
    throw new Error(`Molecule atom ${index + 1} has an invalid formal charge`);
  const record = { atomId, element:text(atom.element), formalCharge };
  for (const key of ['atomName', 'record', 'residueName', 'chain', 'insertionCode', 'altLoc'])
    if (atom[key] != null && text(atom[key]) !== '') record[key] = text(atom[key]);
  for (const key of ['serial', 'residueIndex', 'isotope', 'occupancy'])
    if (Number.isFinite(Number(atom[key]))) record[key] = Number(atom[key]);
  if (atom.aromatic != null) record.aromatic = Boolean(atom.aromatic);
  if (atom.stereochemistry != null) record.stereochemistry = text(atom.stereochemistry);
  return record;
}

function bondRecord(bond, atoms, index) {
  const first = atoms[Number(bond?.a)], second = atoms[Number(bond?.b)];
  if (!first || !second) throw new Error(`Molecule bond ${index + 1} references an unavailable atom`);
  const record = { atomIds:[first.designAtomId, second.designAtomId], order:Number(bond.order ?? 1) };
  if (!Number.isFinite(record.order) || record.order <= 0)
    throw new Error(`Molecule bond ${index + 1} has an invalid order`);
  if (bond.aromatic != null) record.aromatic = Boolean(bond.aromatic);
  if (bond.stereochemistry != null) record.stereochemistry = text(bond.stereochemistry);
  return record;
}

/**
 * Compile the exact current molecular graph and coordinates into the canonical
 * snapshot body accepted by the design-campaign ledger. The application assigns
 * persistent designAtomId values before calling this boundary.
 */
export function snapshotPayloadFromMolecule(molecule, { label = null, provenance = {} } = {}) {
  if (!molecule?.atoms?.length) throw new Error('A current molecule is required for a campaign commit');
  const atoms = molecule.atoms.map(atomRecord);
  const atomIds = atoms.map((atom) => atom.atomId);
  if (new Set(atomIds).size !== atomIds.length)
    throw new Error('A campaign snapshot requires unique persistent atom IDs');
  const positions = molecule.atoms.map((atom, index) => {
    const position = [Number(atom.x), Number(atom.y), Number(atom.z)];
    if (!position.every(Number.isFinite))
      throw new Error(`Molecule atom ${index + 1} has invalid coordinates`);
    return position;
  });
  const canonicalSmiles = text(molecule.canonicalSmiles || molecule.smiles).trim() || null;
  return cloneRecord({
    label:text(label || molecule.name || 'Molecular state'),
    canonicalSmiles,
    graph:{ atoms, bonds:(molecule.bonds || []).map((bond, index) =>
      bondRecord(bond, molecule.atoms, index)) },
    coordinates:{ unit:'angstrom', atomIds, positions },
    externalRefs:[],
    properties:{
      molecule:{ name:text(molecule.name || 'Molecule'),
        charge:Number(molecule.charge ?? 0), multiplicity:Number(molecule.multiplicity ?? 1),
        pointGroup:text(molecule.pointGroup || 'C1'),
        symmetryNumber:Number(molecule.symmetryNumber ?? 1), source:plainSource(molecule.source) },
      provenance:cloneRecord(provenance || {}),
    },
  });
}

function comparableSnapshotState(snapshot) {
  return cloneRecord({ canonicalSmiles:snapshot?.canonicalSmiles || null,
    graph:snapshot?.graph || null, coordinates:snapshot?.coordinates || null,
    molecule:snapshot?.properties?.molecule || null });
}

export function moleculeFromSnapshot(snapshot) {
  if (snapshot?.schema !== SNAPSHOT_SCHEMA) throw new Error(`Expected ${SNAPSHOT_SCHEMA}`);
  const graphAtoms = snapshot.graph?.atoms, positions = snapshot.coordinates?.positions;
  const coordinateIds = snapshot.coordinates?.atomIds;
  if (!Array.isArray(graphAtoms) || !Array.isArray(positions)
    || !Array.isArray(coordinateIds) || graphAtoms.length !== positions.length
    || graphAtoms.length !== coordinateIds.length)
    throw new Error('Campaign snapshot does not contain a complete molecular graph and coordinates');
  const coordinates = new Map(coordinateIds.map((atomId, index) => [atomId, positions[index]]));
  const atoms = graphAtoms.map((record, index) => {
    const position = coordinates.get(record.atomId);
    if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite))
      throw new Error(`Campaign snapshot atom ${index + 1} has invalid coordinates`);
    const { atomId, ...properties } = cloneRecord(record);
    return { ...properties, charge:Number(properties.formalCharge ?? 0), designAtomId:atomId,
      x:position[0], y:position[1], z:position[2] };
  });
  const atomIndices = new Map(atoms.map((atom, index) => [atom.designAtomId, index]));
  const bonds = (snapshot.graph?.bonds || []).map((record, index) => {
    const [firstId, secondId] = record.atomIds || [];
    const a = atomIndices.get(firstId), b = atomIndices.get(secondId);
    if (!Number.isInteger(a) || !Number.isInteger(b))
      throw new Error(`Campaign snapshot bond ${index + 1} references an unavailable atom`);
    const first = atoms[a], second = atoms[b];
    return { a, b, order:Number(record.order ?? 1),
      distance:Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z),
      ...(record.aromatic == null ? {} : { aromatic:Boolean(record.aromatic) }),
      ...(record.stereochemistry == null ? {} : { stereochemistry:text(record.stereochemistry) }) };
  });
  const metadata = snapshot.properties?.molecule || {};
  return { name:text(metadata.name || snapshot.label || 'Campaign molecule'),
    smiles:text(snapshot.canonicalSmiles || ''), canonicalSmiles:snapshot.canonicalSmiles || null,
    charge:Number(metadata.charge ?? 0), multiplicity:Number(metadata.multiplicity ?? 1),
    pointGroup:text(metadata.pointGroup || 'C1'), symmetryNumber:Number(metadata.symmetryNumber ?? 1),
    source:cloneRecord(metadata.source || {}), atoms, bonds };
}

export async function moleculeMatchesSnapshot(molecule, snapshot) {
  if (!molecule || !snapshot) return false;
  const current = snapshotPayloadFromMolecule(molecule, { label:snapshot.label });
  return await sha256Object(comparableSnapshotState(current))
    === await sha256Object(comparableSnapshotState(snapshot));
}

export function moleculeFromCampaignCommit(campaign, commitId) {
  const commit = campaign?.objects?.commits?.[commitId];
  if (!commit) throw new Error(`Unknown campaign commit: ${commitId}`);
  const snapshot = campaign.objects?.snapshots?.[commit.snapshotId];
  if (!snapshot) throw new Error(`Campaign commit snapshot is unavailable: ${commit.snapshotId}`);
  return moleculeFromSnapshot(snapshot);
}

async function requireValidCampaign(campaign) {
  const verification = await verifyCampaign(campaign);
  if (!verification.valid) throw new Error(`Design campaign is invalid: ${verification.reason}`);
  if (campaign.campaignSha256) throw new Error('A finalized campaign is immutable');
}

function cloneCampaign(campaign) {
  if (!campaign) throw new Error('Start or import a design campaign first');
  return cloneRecord(campaign);
}

function completedAuditAfter(audit, lastAuditSequence = 0) {
  if (!Array.isArray(audit)) throw new Error('Chemist Actions audit must be an array');
  return audit.filter((record) => record?.status === 'completed'
    && Number.isInteger(record.sequence) && record.sequence > lastAuditSequence
    && !String(record.action || '').startsWith('campaign.'));
}

function maximumSequence(audit, floor = 0) {
  return Math.max(Number(floor) || 0, ...audit.map((record) =>
    Number.isInteger(record?.sequence) ? record.sequence : 0));
}

async function snapshotAndScript(campaign, { molecule, audit = [], branch,
  label = null, lastAuditSequence = 0, provenance = {} }) {
  const relevantAudit = completedAuditAfter(audit, lastAuditSequence);
  const committedThroughSequence = maximumSequence(audit, lastAuditSequence);
  const parentCommitId = campaign.branches[branch] || null;
  const firstRetainedSequence = audit.reduce((minimum, record) =>
    Number.isInteger(record?.sequence) && record.sequence > lastAuditSequence
      ? Math.min(minimum, record.sequence) : minimum, Number.POSITIVE_INFINITY);
  const auditTruncated = Number.isFinite(firstRetainedSequence)
    && firstRetainedSequence > Number(lastAuditSequence || 0) + 1;
  const payload = snapshotPayloadFromMolecule(molecule, { label, provenance:{
    ...cloneRecord(provenance || {}), branch, committedThroughSequence,
    includedAuditSequences:relevantAudit.map((record) => record.sequence),
  } });
  const snapshotId = await storeSnapshot(campaign, payload);
  let actionScriptId = null;
  if (relevantAudit.length) {
    const script = actionScriptFromAudit({ schema:'molarium.chemist-actions/v1',
      records:relevantAudit }, { label:`${payload.label} actions`, includeReadOnly:true,
      includeAuditMetadata:true, provenance:{ campaignId:campaign.campaignId, branch } });
    actionScriptId = await storeActionScript(campaign, { label:script.label,
      actions:script.actions, expectedStartSnapshotId:null,
      expectedEndSnapshotId:null, compiler:LIVE_CAMPAIGN_COMPILER,
      coverage:{ kind:'public-actions-only', complete:false,
        directUiMutationsCapturedOnlyInSnapshot:true, auditTruncated,
        firstRetainedSequence:Number.isFinite(firstRetainedSequence) ? firstRetainedSequence : null,
        lastCommittedSequence:Number(lastAuditSequence || 0),
        committedThroughSequence } });
  }
  return { snapshotId, actionScriptId, parentCommitId, committedThroughSequence };
}

export async function createLiveCampaign({ campaignId, title, description = '',
  actorId = 'chemist.local', actorDisplayName = 'Local chemist',
  createdAt = null, application = {} } = {}) {
  const occurredAt = iso(createdAt, 'createdAt');
  const campaign = createCampaign({ campaignId:text(campaignId), title:text(title),
    description:text(description), createdAt:occurredAt,
    actors:[{ id:text(actorId), type:'human', displayName:text(actorDisplayName) }],
    application:{ name:'Molarium', surface:'live-workbench', ...cloneRecord(application || {}) } });
  await appendEvent(campaign, { occurredAt, kind:'campaign.started', actorId:text(actorId),
    payload:{ title:campaign.title, surface:'live-workbench' } });
  await requireValidCampaign(campaign);
  return campaign;
}

export async function commitLiveMolecule(campaign, { molecule, audit = [], branch = 'main',
  message, label = null, actorId, occurredAt = null, lastAuditSequence = 0,
  hypothesisIds = [], evidenceIds = [], sourceIds = [], tags = [] } = {}) {
  const next = cloneCampaign(campaign);
  await requireValidCampaign(next);
  if (!Object.hasOwn(next.branches, branch)) throw new Error(`Unknown branch: ${branch}`);
  const timestamp = iso(occurredAt, 'occurredAt');
  const prepared = await snapshotAndScript(next, { molecule, audit, branch, label,
    lastAuditSequence, provenance:{ operation:'campaign.commitCurrent' } });
  const parents = prepared.parentCommitId ? [prepared.parentCommitId] : [];
  const commitId = await commitMolecule(next, { snapshotId:prepared.snapshotId,
    parents, branch, message, actorId, occurredAt:timestamp, actionScriptId:prepared.actionScriptId,
    hypothesisIds, evidenceIds, sourceIds, tags });
  await requireValidCampaign(next);
  return { campaign:next, commitId, snapshotId:prepared.snapshotId,
    actionScriptId:prepared.actionScriptId,
    committedThroughSequence:prepared.committedThroughSequence };
}

export async function createLiveBranch(campaign, { branch, fromCommitId = null,
  actorId, occurredAt = null, recordedAt = null, sourceIds = [] } = {}) {
  const next = cloneCampaign(campaign);
  await requireValidCampaign(next);
  const timestamp = iso(occurredAt, 'occurredAt');
  const event = await createBranch(next, { branch, fromCommitId, actorId,
    occurredAt:timestamp, recordedAt:recordedAt == null ? timestamp : iso(recordedAt, 'recordedAt'),
    sourceIds });
  await requireValidCampaign(next);
  return { campaign:next, event, branch, head:next.branches[branch] };
}

export async function mergeCurrentMolecule(campaign, { sourceBranch, targetBranch = 'main',
  molecule, audit = [], message = '', label = null, actorId, occurredAt = null,
  lastAuditSequence = 0, hypothesisIds = [], evidenceIds = [], sourceIds = [], tags = [] } = {}) {
  const next = cloneCampaign(campaign);
  await requireValidCampaign(next);
  const timestamp = iso(occurredAt, 'occurredAt');
  const prepared = await snapshotAndScript(next, { molecule, audit, branch:targetBranch,
    label:label || message || `Merge ${sourceBranch} into ${targetBranch}`,
    lastAuditSequence, provenance:{ operation:'campaign.mergeBranch', sourceBranch, targetBranch } });
  const commitId = await mergeBranch(next, { sourceBranch, targetBranch,
    snapshotId:prepared.snapshotId, actorId, occurredAt:timestamp,
    actionScriptId:prepared.actionScriptId, message, hypothesisIds, evidenceIds, sourceIds, tags });
  await requireValidCampaign(next);
  return { campaign:next, commitId, snapshotId:prepared.snapshotId,
    actionScriptId:prepared.actionScriptId,
    committedThroughSequence:prepared.committedThroughSequence };
}

export async function recordLiveCampaignDecision(campaign, args = {}) {
  const next = cloneCampaign(campaign);
  await requireValidCampaign(next);
  const event = await recordDecision(next, { ...cloneRecord(args),
    occurredAt:iso(args.occurredAt, 'occurredAt') });
  await requireValidCampaign(next);
  return { campaign:next, event };
}

export function deriveLastAuditSequence(campaign) {
  return Math.max(0, ...Object.values(campaign?.objects?.actionScripts || {})
    .flatMap((script) => script.actions || [])
    .map((step) => Number.isInteger(step.auditSequence) ? step.auditSequence : 0));
}

export async function verifyLiveCampaign(campaign) {
  return verifyCampaign(cloneRecord(campaign));
}
