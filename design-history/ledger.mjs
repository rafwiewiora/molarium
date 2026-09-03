import { cloneRecord, sha256Object } from './integrity.mjs';
import { validateActionScript } from './replay.mjs';

export const CAMPAIGN_SCHEMA = 'molarium.design-campaign/v1';
export const EVENT_SCHEMA = 'molarium.design-event/v1';
export const SNAPSHOT_SCHEMA = 'molarium.molecule-snapshot/v1';
export const COMMIT_SCHEMA = 'molarium.molecule-commit/v1';

export const EVENT_KINDS = Object.freeze([
  'campaign.started', 'observation.recorded', 'hypothesis.proposed',
  'molecule.committed', 'calculation.completed', 'measurement.recorded',
  'decision.recorded', 'branch.created', 'branch.merged', 'movie.cue',
  'campaign.completed',
]);

export const DECISION_DISPOSITIONS = Object.freeze([
  'progressed', 'not-progressed', 'deferred', 'failed', 'duplicate',
  'superseded', 'archived',
]);

export const DECISION_REASON_CODES = Object.freeze([
  'potency', 'selectivity', 'solubility', 'permeability', 'metabolism', 'clearance',
  'safety', 'genotoxicity', 'toxicity', 'synthetic-accessibility', 'strain',
  'contact-loss', 'no-feasible-pose', 'duplicate', 'lower-priority',
  'resource-limit', 'superseded', 'program-discontinued', 'other',
]);

export const ACTOR_TYPES = Object.freeze(['human', 'agent', 'system', 'import']);
export const SOURCE_TYPES = Object.freeze([
  'publication', 'structure', 'dataset', 'repository', 'conversation', 'notebook', 'other',
]);

function assertId(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:-]*$/i.test(value))
    throw new Error(`${label} must be a stable identifier`);
  return value;
}

function assertIso(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new Error(`${label} must be an ISO date-time`);
  return value;
}

function assertMutable(campaign) {
  if (campaign?.campaignSha256) throw new Error('A finalized campaign is immutable');
}

function indexById(entries, label) {
  const result = new Map();
  for (const entry of entries || []) {
    assertId(entry.id, `${label} ID`);
    if (result.has(entry.id)) throw new Error(`Duplicate ${label} ID: ${entry.id}`);
    result.set(entry.id, entry);
  }
  return result;
}

function validateActors(actors) {
  const indexed = indexById(actors, 'actor');
  for (const actor of indexed.values()) {
    if (!ACTOR_TYPES.includes(actor.type)) throw new Error(`Unsupported actor type: ${actor.type}`);
    if (typeof actor.displayName !== 'string' || !actor.displayName.trim())
      throw new Error(`Actor ${actor.id} requires a displayName`);
  }
  return indexed;
}

function validateSources(sources) {
  const indexed = indexById(sources, 'source');
  for (const source of indexed.values()) {
    if (!SOURCE_TYPES.includes(source.type)) throw new Error(`Unsupported source type: ${source.type}`);
    if (typeof source.title !== 'string' || !source.title.trim())
      throw new Error(`Source ${source.id} requires a title`);
  }
  return indexed;
}

function eventIdentityFrom(event) {
  return cloneRecord({ schema:EVENT_SCHEMA, occurredAt:event.occurredAt,
    recordedAt:event.recordedAt, kind:event.kind, actorId:event.actorId, branch:event.branch,
    parentEventIds:event.parentEventIds, subjectIds:event.subjectIds,
    sourceIds:event.sourceIds, payload:event.payload });
}

export function createCampaign({ campaignId, title, description = '', createdAt,
  actors = [], sources = [], application = {} }) {
  assertId(campaignId, 'campaignId');
  assertIso(createdAt, 'createdAt');
  if (typeof title !== 'string' || !title.trim()) throw new Error('A campaign requires a title');
  validateActors(actors); validateSources(sources);
  return {
    schema:CAMPAIGN_SCHEMA, campaignId, title:String(title), description:String(description),
    createdAt, finalizedAt:null, application:{ name:'Molarium', ...cloneRecord(application) },
    actors:cloneRecord(actors), sources:cloneRecord(sources),
    objects:{ snapshots:{}, commits:{}, actionScripts:{} },
    branches:{ main:null }, events:[], campaignSha256:null,
  };
}

export async function storeSnapshot(campaign, { label, canonicalSmiles = null, graph = null,
  coordinates = null, externalRefs = [], properties = {} }) {
  assertMutable(campaign);
  if (!canonicalSmiles && !graph && !coordinates && !(externalRefs || []).length)
    throw new Error('A molecule snapshot requires a graph, coordinates, SMILES, or external reference');
  const body = cloneRecord({ schema:SNAPSHOT_SCHEMA, label:String(label || 'molecule'),
    canonicalSmiles, graph, coordinates, externalRefs, properties });
  const hash = await sha256Object(body), snapshotId = `snapshot:${hash}`;
  if (campaign.objects.snapshots[snapshotId]
    && await sha256Object(campaign.objects.snapshots[snapshotId]) !== hash)
    throw new Error(`Snapshot collision: ${snapshotId}`);
  campaign.objects.snapshots[snapshotId] = body;
  return snapshotId;
}

export async function storeActionScript(campaign, { label, actions,
  expectedStartSnapshotId = null, expectedEndSnapshotId = null, compiler = null,
  coverage = null }) {
  assertMutable(campaign);
  if (!Array.isArray(actions) || !actions.length) throw new Error('An action script requires actions');
  const body = cloneRecord({ schema:'molarium.chemist-action-script/v1',
    label:String(label || 'chemist action script'), actions,
    expectedStartSnapshotId, expectedEndSnapshotId, compiler,
    ...(coverage == null ? {} : { coverage }) });
  validateActionScript(body);
  const hash = await sha256Object(body), scriptId = `script:${hash}`;
  campaign.objects.actionScripts[scriptId] = body;
  return scriptId;
}

export async function appendEvent(campaign, { occurredAt, recordedAt = occurredAt,
  kind, actorId, branch = 'main', parentEventIds = [], subjectIds = [], sourceIds = [],
  payload = {} }) {
  assertMutable(campaign);
  if (!EVENT_KINDS.includes(kind)) throw new Error(`Unsupported design event kind: ${kind}`);
  assertIso(occurredAt, 'occurredAt'); assertIso(recordedAt, 'recordedAt');
  const actors = validateActors(campaign.actors), sources = validateSources(campaign.sources);
  if (!actors.has(actorId)) throw new Error(`Unknown event actor: ${actorId}`);
  sourceIds.forEach((id) => { if (!sources.has(id)) throw new Error(`Unknown event source: ${id}`); });
  parentEventIds.forEach((id) => {
    if (!campaign.events.some((entry) => entry.eventId === id))
      throw new Error(`Unknown parent event: ${id}`);
  });
  const eventIdentity = cloneRecord({ schema:EVENT_SCHEMA, occurredAt, recordedAt, kind, actorId,
    branch, parentEventIds, subjectIds, sourceIds, payload });
  const eventId = `event:${await sha256Object(eventIdentity)}`;
  if (campaign.events.some((entry) => entry.eventId === eventId))
    throw new Error(`Duplicate design event: ${eventId}`);
  const body = cloneRecord({ ...eventIdentity, eventId, index:campaign.events.length,
    previousEntrySha256:campaign.events.at(-1)?.entrySha256 || null });
  const entry = { ...body, entrySha256:await sha256Object(body) };
  campaign.events.push(entry);
  return entry;
}

export async function commitMolecule(campaign, { snapshotId, parents = [], branch = 'main',
  message, actorId, occurredAt, recordedAt = occurredAt, actionScriptId = null,
  hypothesisIds = [], evidenceIds = [], sourceIds = [], tags = [] }) {
  assertMutable(campaign);
  if (!campaign.objects.snapshots[snapshotId]) throw new Error(`Unknown snapshot: ${snapshotId}`);
  parents.forEach((id) => {
    if (!campaign.objects.commits[id]) throw new Error(`Unknown parent commit: ${id}`);
  });
  if (actionScriptId && !campaign.objects.actionScripts[actionScriptId])
    throw new Error(`Unknown action script: ${actionScriptId}`);
  const body = cloneRecord({ schema:COMMIT_SCHEMA, snapshotId, parents, branch,
    message:String(message || ''), actionScriptId, hypothesisIds, evidenceIds, tags });
  const commitId = `commit:${await sha256Object(body)}`;
  campaign.objects.commits[commitId] = body;
  if (!Object.hasOwn(campaign.branches, branch)) campaign.branches[branch] = parents[0] || null;
  campaign.branches[branch] = commitId;
  await appendEvent(campaign, { occurredAt, recordedAt, kind:'molecule.committed', actorId,
    branch, subjectIds:[commitId, snapshotId], sourceIds,
    payload:{ commitId, snapshotId, parents, actionScriptId, message:body.message,
      hypothesisIds, evidenceIds, tags } });
  return commitId;
}

export async function createBranch(campaign, { branch, fromCommitId = null, actorId,
  occurredAt, recordedAt = occurredAt, sourceIds = [] }) {
  assertMutable(campaign);
  assertId(branch, 'branch');
  if (Object.hasOwn(campaign.branches, branch)) throw new Error(`Branch already exists: ${branch}`);
  if (fromCommitId !== null && !campaign.objects.commits[fromCommitId])
    throw new Error(`Unknown branch start commit: ${fromCommitId}`);
  const event = await appendEvent(campaign, { occurredAt, recordedAt, kind:'branch.created',
    actorId, branch, subjectIds:fromCommitId ? [fromCommitId] : [], sourceIds,
    payload:{ branch, fromCommitId } });
  campaign.branches[branch] = fromCommitId;
  return event;
}

export async function mergeBranch(campaign, { sourceBranch, targetBranch, snapshotId,
  actorId, occurredAt, recordedAt = occurredAt, actionScriptId = null, message,
  hypothesisIds = [], evidenceIds = [], sourceIds = [], tags = [] }) {
  assertMutable(campaign);
  assertId(sourceBranch, 'sourceBranch'); assertId(targetBranch, 'targetBranch');
  if (sourceBranch === targetBranch) throw new Error('Source and target branches must be distinct');
  if (!Object.hasOwn(campaign.branches, sourceBranch))
    throw new Error(`Unknown source branch: ${sourceBranch}`);
  if (!Object.hasOwn(campaign.branches, targetBranch))
    throw new Error(`Unknown target branch: ${targetBranch}`);
  const sourceCommitId = campaign.branches[sourceBranch];
  const targetCommitId = campaign.branches[targetBranch];
  if (!sourceCommitId) throw new Error(`Source branch has no head: ${sourceBranch}`);
  if (!targetCommitId) throw new Error(`Target branch has no head: ${targetBranch}`);
  if (!snapshotId) throw new Error('A merge requires an explicit snapshotId');
  if (!campaign.objects.snapshots[snapshotId]) throw new Error(`Unknown snapshot: ${snapshotId}`);
  const mergeCommitId = await commitMolecule(campaign, { snapshotId,
    parents:[targetCommitId, sourceCommitId], branch:targetBranch, message, actorId,
    occurredAt, recordedAt, actionScriptId, hypothesisIds,
    evidenceIds, sourceIds, tags });
  await appendEvent(campaign, { occurredAt, recordedAt, kind:'branch.merged', actorId,
    branch:targetBranch, subjectIds:[mergeCommitId, targetCommitId, sourceCommitId, snapshotId],
    sourceIds, payload:{ sourceBranch, targetBranch, sourceCommitId, targetCommitId,
      mergeCommitId, snapshotId, actionScriptId, message:String(message || ''),
      hypothesisIds, evidenceIds, tags } });
  return mergeCommitId;
}

export async function recordDecision(campaign, { targetCommitId, disposition, reasonCodes = [],
  rationale, actorId, occurredAt, recordedAt = occurredAt, sourceIds = [], evidenceIds = [],
  branch = 'main' }) {
  if (!campaign.objects.commits[targetCommitId]) throw new Error(`Unknown decision target: ${targetCommitId}`);
  if (!DECISION_DISPOSITIONS.includes(disposition))
    throw new Error(`Unsupported decision disposition: ${disposition}`);
  for (const reason of reasonCodes) if (!DECISION_REASON_CODES.includes(reason))
    throw new Error(`Unsupported decision reason: ${reason}`);
  return appendEvent(campaign, { occurredAt, recordedAt, kind:'decision.recorded', actorId,
    branch, subjectIds:[targetCommitId], sourceIds,
    payload:{ targetCommitId, disposition, reasonCodes, rationale:String(rationale || ''), evidenceIds } });
}

export async function finalizeCampaign(campaign, { finalizedAt, actorId }) {
  assertMutable(campaign); assertIso(finalizedAt, 'finalizedAt');
  await appendEvent(campaign, { occurredAt:finalizedAt, kind:'campaign.completed', actorId,
    payload:{ branchHeads:cloneRecord(campaign.branches) } });
  campaign.finalizedAt = finalizedAt;
  campaign.campaignSha256 = await sha256Object({ ...campaign, campaignSha256:null });
  return campaign;
}

export async function verifyCampaign(campaign) {
  try {
    if (campaign?.schema !== CAMPAIGN_SCHEMA) return { valid:false, reason:'schema mismatch' };
    assertId(campaign.campaignId, 'campaignId'); assertIso(campaign.createdAt, 'createdAt');
    const actors = validateActors(campaign.actors), sources = validateSources(campaign.sources);
    for (const [id, snapshot] of Object.entries(campaign.objects?.snapshots || {}))
      if (id !== `snapshot:${await sha256Object(snapshot)}`)
        return { valid:false, reason:`snapshot hash mismatch: ${id}` };
    for (const [id, script] of Object.entries(campaign.objects?.actionScripts || {}))
      if (id !== `script:${await sha256Object(script)}`)
        return { valid:false, reason:`action script hash mismatch: ${id}` };
    for (const [id, commit] of Object.entries(campaign.objects?.commits || {})) {
      if (id !== `commit:${await sha256Object(commit)}`)
        return { valid:false, reason:`commit hash mismatch: ${id}` };
      if (!campaign.objects.snapshots[commit.snapshotId])
        return { valid:false, reason:`commit snapshot missing: ${id}` };
      if (commit.actionScriptId && !campaign.objects.actionScripts[commit.actionScriptId])
        return { valid:false, reason:`commit script missing: ${id}` };
      if (commit.parents.some((parent) => !campaign.objects.commits[parent]))
        return { valid:false, reason:`commit parent missing: ${id}` };
    }
    let previousEntrySha256 = null;
    const eventIds = new Set();
    const committedIds = new Set();
    const derivedBranches = { main:null };
    for (let index = 0; index < campaign.events.length; index++) {
      const event = campaign.events[index], { entrySha256, ...body } = event;
      if (event.index !== index || event.previousEntrySha256 !== previousEntrySha256)
        return { valid:false, reason:`event chain mismatch at ${index}` };
      if (await sha256Object(body) !== entrySha256)
        return { valid:false, reason:`event hash mismatch at ${index}` };
      if (!EVENT_KINDS.includes(event.kind))
        return { valid:false, reason:`unsupported event kind at ${index}` };
      if (event.eventId !== `event:${await sha256Object(eventIdentityFrom(event))}`)
        return { valid:false, reason:`event ID mismatch at ${index}` };
      if (eventIds.has(event.eventId)) return { valid:false, reason:`duplicate event ID at ${index}` };
      if (!actors.has(event.actorId)) return { valid:false, reason:`unknown actor at ${index}` };
      if (event.sourceIds.some((id) => !sources.has(id)))
        return { valid:false, reason:`unknown source at ${index}` };
      if (event.parentEventIds.some((id) => !eventIds.has(id)))
        return { valid:false, reason:`future or missing parent event at ${index}` };
      if (event.kind === 'decision.recorded'
        && !campaign.objects.commits[event.payload?.targetCommitId])
        return { valid:false, reason:`decision target missing at ${index}` };
      if (event.kind === 'decision.recorded'
        && (!DECISION_DISPOSITIONS.includes(event.payload?.disposition)
          || event.payload?.reasonCodes?.some((code) => !DECISION_REASON_CODES.includes(code))))
        return { valid:false, reason:`decision vocabulary mismatch at ${index}` };
      if (event.kind === 'molecule.committed') {
        const commitId = event.payload?.commitId;
        const commit = campaign.objects.commits[commitId];
        if (!commit) return { valid:false, reason:`commit event target missing at ${index}` };
        const eventCommit = { schema:COMMIT_SCHEMA, snapshotId:event.payload?.snapshotId,
          parents:event.payload?.parents, branch:event.branch,
          message:event.payload?.message, actionScriptId:event.payload?.actionScriptId,
          hypothesisIds:event.payload?.hypothesisIds, evidenceIds:event.payload?.evidenceIds,
          tags:event.payload?.tags };
        if (await sha256Object(eventCommit) !== await sha256Object(commit))
          return { valid:false, reason:`commit event payload mismatch at ${index}` };
        if (await sha256Object(event.subjectIds)
          !== await sha256Object([commitId, commit.snapshotId]))
          return { valid:false, reason:`commit event subject mismatch at ${index}` };
        if (committedIds.has(commitId))
          return { valid:false, reason:`duplicate commit event at ${index}` };
        if (!Object.hasOwn(derivedBranches, commit.branch))
          derivedBranches[commit.branch] = commit.parents[0] || null;
        derivedBranches[commit.branch] = commitId;
        committedIds.add(commitId);
      }
      if (event.kind === 'branch.created') {
        const branch = event.payload?.branch, fromCommitId = event.payload?.fromCommitId;
        try { assertId(branch, 'branch'); }
        catch { return { valid:false, reason:`branch creation payload mismatch at ${index}` }; }
        if (event.branch !== branch || Object.hasOwn(derivedBranches, branch)
          || !Object.hasOwn(campaign.branches || {}, branch))
          return { valid:false, reason:`branch creation reference mismatch at ${index}` };
        if (fromCommitId !== null && !campaign.objects.commits[fromCommitId])
          return { valid:false, reason:`branch creation commit missing at ${index}` };
        const creationSubjects = fromCommitId ? [fromCommitId] : [];
        if (await sha256Object(event.subjectIds) !== await sha256Object(creationSubjects))
          return { valid:false, reason:`branch creation subject mismatch at ${index}` };
        derivedBranches[branch] = fromCommitId;
      }
      if (event.kind === 'branch.merged') {
        const { sourceBranch, targetBranch, sourceCommitId, targetCommitId,
          mergeCommitId, snapshotId } = event.payload || {};
        try { assertId(sourceBranch, 'sourceBranch'); assertId(targetBranch, 'targetBranch'); }
        catch { return { valid:false, reason:`branch merge payload mismatch at ${index}` }; }
        if (sourceBranch === targetBranch || event.branch !== targetBranch
          || !Object.hasOwn(campaign.branches || {}, sourceBranch)
          || !Object.hasOwn(campaign.branches || {}, targetBranch))
          return { valid:false, reason:`branch merge reference mismatch at ${index}` };
        const mergeCommit = campaign.objects.commits[mergeCommitId];
        if (!campaign.objects.commits[sourceCommitId]
          || !campaign.objects.commits[targetCommitId] || !mergeCommit)
          return { valid:false, reason:`branch merge commit missing at ${index}` };
        if (derivedBranches[sourceBranch] !== sourceCommitId
          || derivedBranches[targetBranch] !== mergeCommitId)
          return { valid:false, reason:`branch merge head mismatch at ${index}` };
        if (!campaign.objects.snapshots[snapshotId]
          || mergeCommit.snapshotId !== snapshotId
          || mergeCommit.branch !== targetBranch
          || mergeCommit.parents.length !== 2
          || mergeCommit.parents[0] !== targetCommitId
          || mergeCommit.parents[1] !== sourceCommitId)
          return { valid:false, reason:`branch merge commit mismatch at ${index}` };
        const mergeMetadata = { actionScriptId:event.payload?.actionScriptId,
          message:event.payload?.message, hypothesisIds:event.payload?.hypothesisIds,
          evidenceIds:event.payload?.evidenceIds, tags:event.payload?.tags };
        const commitMetadata = { actionScriptId:mergeCommit.actionScriptId,
          message:mergeCommit.message, hypothesisIds:mergeCommit.hypothesisIds,
          evidenceIds:mergeCommit.evidenceIds, tags:mergeCommit.tags };
        if (await sha256Object(mergeMetadata) !== await sha256Object(commitMetadata))
          return { valid:false, reason:`branch merge payload mismatch at ${index}` };
        const committedEvent = campaign.events[index - 1];
        if (committedEvent?.kind !== 'molecule.committed'
          || committedEvent.payload?.commitId !== mergeCommitId)
          return { valid:false, reason:`branch merge event order mismatch at ${index}` };
        if (await sha256Object(event.subjectIds)
          !== await sha256Object([mergeCommitId, targetCommitId, sourceCommitId, snapshotId]))
          return { valid:false, reason:`branch merge subject mismatch at ${index}` };
      }
      eventIds.add(event.eventId); previousEntrySha256 = entrySha256;
    }
    if (committedIds.size !== Object.keys(campaign.objects.commits).length)
      return { valid:false, reason:'one or more commits have no chained commit event' };
    if (await sha256Object(derivedBranches) !== await sha256Object(campaign.branches || {}))
      return { valid:false, reason:'branch heads do not match the event chain' };
    if (campaign.campaignSha256) {
      if (!campaign.finalizedAt) return { valid:false, reason:'finalizedAt is missing' };
      if (campaign.events.at(-1)?.kind !== 'campaign.completed')
        return { valid:false, reason:'campaign completion event is missing' };
      const actual = await sha256Object({ ...campaign, campaignSha256:null });
      if (actual !== campaign.campaignSha256)
        return { valid:false, reason:'campaign hash mismatch' };
    }
    return { valid:true, reason:null, events:campaign.events.length,
      commits:Object.keys(campaign.objects.commits).length,
      decisions:campaign.events.filter((entry) => entry.kind === 'decision.recorded').length };
  } catch (error) { return { valid:false, reason:String(error?.message || error) }; }
}

export function campaignSummary(campaign) {
  const decisions = campaign.events.filter((entry) => entry.kind === 'decision.recorded');
  const byDisposition = Object.fromEntries(DECISION_DISPOSITIONS.map((key) =>
    [key, decisions.filter((entry) => entry.payload.disposition === key).length]));
  return { campaignId:campaign.campaignId, title:campaign.title,
    commits:Object.keys(campaign.objects.commits).length, events:campaign.events.length,
    decisions:decisions.length, byDisposition, branches:Object.keys(campaign.branches).length,
    campaignSha256:campaign.campaignSha256 };
}
