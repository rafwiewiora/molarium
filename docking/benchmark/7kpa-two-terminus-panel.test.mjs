import assert from 'node:assert/strict';
import { deterministicHash, readPanelManifest, stableReplayPayload,
  validatePanelManifest, validatePanelResults } from './7kpa-two-terminus-panel.mjs';

const { manifest } = await readPanelManifest();
const validated = await validatePanelManifest(manifest);
assert.equal(validated.cases, 20);
assert.deepEqual(validated.loci, { pyridone:9, pyrrolidone:8, dual:3 });
assert.equal(deterministicHash({ b:2, a:1 }), deterministicHash({ a:1, b:2 }),
  'canonical hashes must not depend on object key insertion order');

const remapReplay = { chemistry:{ commits:[{ contactFeatureRemaps:[{
  at:'2026-08-23T00:00:00.000Z', committedEditId:'chem-edit-run-a',
  originatingCommittedEditId:'chem-edit-run-a', candidateAtomIds:['ligand:O3'],
  editLineage:[{ committedEditId:'chem-edit-run-a', boundaryAtomIds:['ligand:C28'] }],
}]}] } };
const replayWithOtherRunIds = structuredClone(remapReplay);
Object.assign(replayWithOtherRunIds.chemistry.commits[0].contactFeatureRemaps[0], {
  at:'2026-08-23T00:00:01.000Z', committedEditId:'chem-edit-run-b',
  originatingCommittedEditId:'chem-edit-run-b',
});
replayWithOtherRunIds.chemistry.commits[0].contactFeatureRemaps[0]
  .editLineage[0].committedEditId = 'chem-edit-run-b';
assert.equal(deterministicHash(stableReplayPayload(remapReplay)),
  deterministicHash(stableReplayPayload(replayWithOtherRunIds)),
  'replay hashes must exclude run-local contact-remap IDs and timestamps');
replayWithOtherRunIds.chemistry.commits[0].contactFeatureRemaps[0]
  .candidateAtomIds = ['ligand:S3'];
assert.notEqual(deterministicHash(stableReplayPayload(remapReplay)),
  deterministicHash(stableReplayPayload(replayWithOtherRunIds)),
  'replay hashes must retain the scientific contact-remap identity');
const exportReplayA = { candidateExportIntegrity:[{ id:'case:replay-1:pose-0', poseIndex:0,
  rank:1, feasible:true, coordinateSha256:'c'.repeat(64), numericSystemSha256:'s'.repeat(64) }] };
const exportReplayB = structuredClone(exportReplayA);
exportReplayB.candidateExportIntegrity[0].id = 'case:replay-2:pose-0';
assert.equal(deterministicHash(stableReplayPayload(exportReplayA)),
  deterministicHash(stableReplayPayload(exportReplayB)),
  'replay hashes must exclude the replay ordinal embedded in validation-export IDs');
exportReplayB.candidateExportIntegrity[0].coordinateSha256 = 'd'.repeat(64);
assert.notEqual(deterministicHash(stableReplayPayload(exportReplayA)),
  deterministicHash(stableReplayPayload(exportReplayB)),
  'replay hashes must retain every exported candidate coordinate hash');

const entry = manifest.cases[0];
const replay = { caseId:entry.id, caseInputSha256:deterministicHash(entry),
  terminalOutcome:'success-feasible', actions:[], chemistry:{ valid:true },
  contactMapping:[], refinement:{ selectedFeasible:true, selectedPhysicalKcalMol:0,
    selectedConstraintPenaltyKcalMol:0, selectedPhysicalComponents:{ ligandStrainKcalMol:0,
      lennardJonesKcalMol:0, stericClashes:0 }, selectedHydrogenBonds:[] },
  appliedPose:null, referenceGraphSha256:deterministicHash({ atoms:[], bonds:[] }),
  productGraphSha256:entry.expectedProductGraphSha256,
  expectedProductGraphSha256:entry.expectedProductGraphSha256, productGraphMatchesExpected:true,
  labbookAudit:{ valid:true, labbookSha256:'a'.repeat(64) }, runtime:{ totalMs:1 } };
replay.deterministicSha256 = deterministicHash(stableReplayPayload(replay));
const caseResult = { caseId:entry.id, caseInputSha256:replay.caseInputSha256,
  replays:[replay], replayAgreement:true };
const result = { schemaVersion:1, panelId:manifest.panelId, panelVersion:manifest.version,
  manifestSha256:deterministicHash(manifest), cases:[caseResult],
  resultsSha256:deterministicHash([caseResult]) };
assert.deepEqual(validatePanelResults(result, manifest), { cases:1, agreeing:1 });
const tampered = structuredClone(result);
tampered.cases[0].replays[0].productGraphMatchesExpected = false;
assert.throws(() => validatePanelResults(tampered, manifest), /replay hash/);
console.log('7KPA two-terminus panel harness: PASS');
