import assert from 'node:assert/strict';
import { canonicalJson, cloneRecord, sha256Object } from './integrity.mjs';
import { createCampaign, storeSnapshot, storeActionScript, appendEvent, commitMolecule,
  recordDecision, finalizeCampaign, verifyCampaign, campaignSummary } from './ledger.mjs';
import { validateActionScript, replayActionScript } from './replay.mjs';
import { buildMovieManifest, verifyMovieManifest, expandMovieFrames } from './movie.mjs';
import { CHEMIST_ACTIONS_SCHEMA } from '../chemist-actions.mjs';

const HUMAN = { id:'chemist.alex', type:'human', displayName:'Alex Chemist' };
const AGENT = { id:'agent.sol', type:'agent', displayName:'Sol' };
const SOURCE = { id:'source.paper', type:'publication', title:'Example medicinal chemistry paper',
  locator:'doi:10.0000/example' };

function campaign() {
  return createCampaign({ campaignId:'test-campaign', title:'Test campaign',
    createdAt:'2026-08-30T12:00:00.000Z', actors:[HUMAN, AGENT], sources:[SOURCE],
    application:{ version:'test' } });
}

async function populatedCampaign() {
  const value = campaign();
  const start = await appendEvent(value, { occurredAt:'2026-08-30T12:00:00.000Z',
    kind:'campaign.started', actorId:HUMAN.id, sourceIds:[SOURCE.id],
    payload:{ objective:'Improve a reference ligand without erasing rejected designs.' } });
  const referenceSnapshot = await storeSnapshot(value, { label:'Reference', canonicalSmiles:'CCO',
    externalRefs:[{ sourceId:SOURCE.id, compound:'1' }], properties:{ status:'reported' } });
  const reference = await commitMolecule(value, { snapshotId:referenceSnapshot,
    message:'Record the reported starting compound', actorId:HUMAN.id,
    occurredAt:'2026-08-30T12:01:00.000Z', sourceIds:[SOURCE.id] });
  const hypothesis = await appendEvent(value, { occurredAt:'2026-08-30T12:02:00.000Z',
    kind:'hypothesis.proposed', actorId:AGENT.id, parentEventIds:[start.eventId],
    subjectIds:[reference], payload:{ statement:'Replacing the terminal group may reduce clearance.' } });
  const actionScriptId = await storeActionScript(value, { label:'Replace terminal oxygen', actions:[
    { action:'view.setMode', args:{ mode:'build' }, caption:'Open Design.' },
    { action:'selection.replace', args:{ atomIds:['ligand:A2'] }, caption:'Select the oxygen.' },
    { action:'chemistry.setAtom', args:{ element:'N', formalCharge:0 }, caption:'Change O to N.' },
    { action:'chemistry.finish', args:{}, caption:'Finish the chemical state.' },
  ], expectedStartSnapshotId:referenceSnapshot });
  const analogueSnapshot = await storeSnapshot(value, { label:'Analogue', canonicalSmiles:'CCN' });
  const analogue = await commitMolecule(value, { snapshotId:analogueSnapshot, parents:[reference],
    branch:'series.amines', message:'Prepare the terminal amine analogue', actorId:AGENT.id,
    occurredAt:'2026-08-30T12:03:00.000Z', actionScriptId,
    hypothesisIds:[hypothesis.eventId], sourceIds:[SOURCE.id] });
  const result = await appendEvent(value, { occurredAt:'2026-08-30T12:04:00.000Z',
    kind:'measurement.recorded', actorId:HUMAN.id, branch:'series.amines',
    subjectIds:[analogue], sourceIds:[SOURCE.id], payload:{ endpoint:'clearance', value:80,
      unit:'mL/min/kg', qualifier:'reported' } });
  await recordDecision(value, { targetCommitId:analogue, disposition:'not-progressed',
    reasonCodes:['clearance'], rationale:'Clearance remained above the project threshold.',
    actorId:HUMAN.id, occurredAt:'2026-08-30T12:05:00.000Z', sourceIds:[SOURCE.id],
    evidenceIds:[result.eventId], branch:'series.amines' });
  return { value, start, referenceSnapshot, reference, analogueSnapshot, analogue, actionScriptId };
}

assert.equal(canonicalJson({ z:1, a:{ y:2, x:3 } }), canonicalJson({ a:{ x:3, y:2 }, z:1 }));
assert.equal(await sha256Object({ b:2, a:1 }), await sha256Object({ a:1, b:2 }));
assert.throws(() => canonicalJson({ bad:Number.NaN }), /non-finite/);
assert.throws(() => { const cyclic = {}; cyclic.self = cyclic; canonicalJson(cyclic); }, /cycles/);
assert.throws(() => canonicalJson(new Date()), /plain JSON/);

assert.throws(() => createCampaign({ campaignId:'bad', title:'Bad',
  createdAt:'2026-08-30T00:00:00Z', actors:[{ id:'x', type:'robot', displayName:'X' }] }),
  /actor type/);
assert.throws(() => createCampaign({ campaignId:'bad', title:'Bad',
  createdAt:'2026-08-30T00:00:00Z', actors:[HUMAN],
  sources:[{ id:'x', type:'publication', title:'' }] }), /requires a title/);

const first = campaign();
const event1 = await appendEvent(first, { occurredAt:'2026-08-30T12:00:00.000Z',
  kind:'observation.recorded', actorId:HUMAN.id, payload:{ value:1 } });
const event2 = await appendEvent(first, { occurredAt:'2026-08-30T12:00:00.000Z',
  recordedAt:'2026-08-30T12:00:01.000Z', kind:'observation.recorded', actorId:HUMAN.id,
  payload:{ value:1 } });
assert.notEqual(event1.eventId, event2.eventId, 'repeated observations receive distinct identities');
await assert.rejects(() => appendEvent(first, { occurredAt:'2026-08-30T12:00:00.000Z',
  kind:'observation.recorded', actorId:HUMAN.id, payload:{ value:1 } }), /Duplicate design event/);

const { value, analogue, actionScriptId } = await populatedCampaign();
assert.equal((await verifyCampaign(value)).valid, true);
assert.equal(value.branches['series.amines'], analogue);
assert.deepEqual(campaignSummary(value).byDisposition, {
  progressed:0, 'not-progressed':1, deferred:0, failed:0, duplicate:0, superseded:0, archived:0,
});
assert.ok(value.objects.actionScripts[actionScriptId]);

const tamperedEventId = cloneRecord(value);
tamperedEventId.events[0].eventId = 'event:0000';
const { entrySha256:ignored, ...tamperedBody } = tamperedEventId.events[0];
tamperedEventId.events[0].entrySha256 = await sha256Object(tamperedBody);
tamperedEventId.events[1].previousEntrySha256 = tamperedEventId.events[0].entrySha256;
const { entrySha256:ignored2, ...secondBody } = tamperedEventId.events[1];
tamperedEventId.events[1].entrySha256 = await sha256Object(secondBody);
assert.match((await verifyCampaign(tamperedEventId)).reason, /event ID mismatch/);

const tamperedSnapshot = cloneRecord(value);
const snapshotKey = Object.keys(tamperedSnapshot.objects.snapshots)[0];
tamperedSnapshot.objects.snapshots[snapshotKey].label = 'Tampered';
assert.match((await verifyCampaign(tamperedSnapshot)).reason, /snapshot hash mismatch/);

const tamperedDecision = cloneRecord(value);
const decision = tamperedDecision.events.find((entry) => entry.kind === 'decision.recorded');
decision.payload.disposition = 'quietly-deleted';
const decisionIndex = decision.index;
for (let index = decisionIndex; index < tamperedDecision.events.length; index++) {
  const entry = tamperedDecision.events[index];
  entry.previousEntrySha256 = index ? tamperedDecision.events[index - 1].entrySha256 : null;
  const { entrySha256, ...body } = entry;
  entry.entrySha256 = await sha256Object(body);
}
assert.match((await verifyCampaign(tamperedDecision)).reason, /event ID mismatch|decision vocabulary/);

await finalizeCampaign(value, { finalizedAt:'2026-08-30T12:06:00.000Z', actorId:HUMAN.id });
assert.equal((await verifyCampaign(value)).valid, true);
await assert.rejects(() => storeSnapshot(value, { label:'Late', canonicalSmiles:'C' }), /immutable/);
const finalizedTamper = cloneRecord(value);
finalizedTamper.title = 'Rewritten history';
assert.match((await verifyCampaign(finalizedTamper)).reason, /campaign hash mismatch/);

const script = value.objects.actionScripts[actionScriptId];
assert.equal(validateActionScript(script), script);
assert.throws(() => validateActionScript({ schema:script.schema,
  actions:[{ action:'chemistry.setAtom', args:{ privateRoute:{ module:'internal' } } }] }),
  /Chemist Actions boundary/);
assert.throws(() => validateActionScript({ schema:script.schema,
  actions:[{ action:'coordinates.teleport', args:{} }] }), /unavailable route/);
assert.throws(() => validateActionScript({ schema:script.schema, actions:[
  { action:'chemistry.createBond', args:{ atomIds:[{ $binding:'newAtom' }, 'a'], order:1 } },
] }), /undeclared replay binding/);

const calls = [];
let tick = 0;
const fakeApi = Object.freeze({ schema:CHEMIST_ACTIONS_SCHEMA,
  async execute(request) { calls.push(cloneRecord(request)); return {
    schema:CHEMIST_ACTIONS_SCHEMA, requestId:request.requestId, action:request.action,
    status:'completed', result:{ accepted:true, action:request.action },
  }; } });
const replay = await replayActionScript(fakeApi, script, {
  now:() => `2026-08-30T12:10:0${tick++}.000Z`, monotonicNow:() => tick * 10,
});
assert.equal(replay.status, 'completed');
assert.equal(calls.length, script.actions.length);
assert.deepEqual(calls.map((entry) => entry.action), script.actions.map((entry) => entry.action));
assert.ok(calls.every((entry) => entry.requestId.startsWith('story-')));

const bindingScript = { schema:script.schema, label:'Captured atom result', actions:[
  { action:'chemistry.addAtom', args:{ attachedToAtomId:'a', element:'O' },
    capture:{ oxygen:'addedAtomId' } },
  { action:'chemistry.createBond', args:{ atomIds:['b', { $binding:'oxygen' }], order:1 } },
] };
const bindingCalls = [];
const bindingApi = Object.freeze({ schema:CHEMIST_ACTIONS_SCHEMA, async execute(request) {
  bindingCalls.push(cloneRecord(request));
  return { result:request.action === 'chemistry.addAtom' ? { addedAtomId:'new-oxygen' } : {} };
} });
const bindingReplay = await replayActionScript(bindingApi, bindingScript);
assert.equal(bindingReplay.bindings.oxygen, 'new-oxygen');
assert.deepEqual(bindingCalls[1].args.atomIds, ['b', 'new-oxygen']);

let failTick = 0;
const failingApi = Object.freeze({ schema:CHEMIST_ACTIONS_SCHEMA,
  async execute(request) {
    if (request.action === 'selection.replace') throw new Error('selection unavailable');
    return { result:{} };
  } });
const failedReplay = await replayActionScript(failingApi, script, {
  now:() => `2026-08-30T12:20:0${failTick++}.000Z`, monotonicNow:() => failTick * 5,
});
assert.equal(failedReplay.status, 'failed');
assert.equal(failedReplay.steps.at(-1).action, 'selection.replace');
assert.match(failedReplay.steps.at(-1).error, /selection unavailable/);

const cueEvent = value.events.find((entry) => entry.kind === 'decision.recorded');
const movie = await buildMovieManifest({ campaign:value, title:'Test campaign movie',
  createdAt:'2026-08-30T12:07:00.000Z', width:1280, height:720, fps:10, cues:[
    { title:'Starting point', durationMs:500, commitId:Object.keys(value.objects.commits)[0] },
    { title:'Decision', durationMs:1000, eventId:cueEvent.eventId, commitId:analogue },
  ] });
assert.equal((await verifyMovieManifest(movie, value)).valid, true);
const frames = expandMovieFrames(movie);
assert.equal(frames.length, 15);
assert.deepEqual(frames, expandMovieFrames(movie), 'frame expansion is deterministic');
assert.equal(frames[0].frame, 1);
assert.equal(frames.at(-1).cueProgress, 1);

const badMovie = cloneRecord(movie);
badMovie.cues[0].commitId = 'commit:missing';
const { movieSha256, ...badMovieBody } = badMovie;
badMovie.movieSha256 = await sha256Object(badMovieBody);
assert.match((await verifyMovieManifest(badMovie, value)).reason, /commit missing/);

const other = cloneRecord(value);
other.campaignId = 'other';
assert.match((await verifyMovieManifest(movie, other)).reason, /campaign linkage/);

console.log(`design-history tests passed: ${value.events.length} events, ${frames.length} movie frames`);
