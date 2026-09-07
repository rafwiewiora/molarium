import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const base = new URL('../../reviews/design-remediation-2026-09-06/', import.meta.url);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function readAttempt(id) {
  const directory = new URL(`${id}/`, base);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory)));
  assert.equal(manifest.schema, 'molarium.design-remediation-archive/v1');
  assert.equal(manifest.acceptance, 'passed-source-stable-development-regression');
  assert.deepEqual(manifest.findings, ['DV-01','DV-02','DV-03']);
  assert.deepEqual(manifest.files.map((entry) => entry.path),
    ['result.json.gz','source-bundle.json.gz','parp2-reference.pdb.gz']);
  const files = {};
  for (const entry of manifest.files) {
    const compressed = await readFile(new URL(entry.path, directory));
    assert.equal(compressed.length, entry.bytes);
    assert.equal(sha256(compressed), entry.sha256);
    const bytes = gunzipSync(compressed);
    assert.equal(bytes.length, entry.decodedBytes);
    assert.equal(sha256(bytes), entry.decodedSha256);
    files[entry.path] = bytes;
  }
  const raw = JSON.parse(files['result.json.gz']);
  const sources = JSON.parse(files['source-bundle.json.gz']);
  assert.equal(raw.status, 'passed');
  assert.deepEqual(raw.provenance.sourceSha256AtCompletion, raw.provenance.sourceSha256);
  assert.deepEqual(manifest.sourceSha256, raw.provenance.sourceSha256);
  assert.deepEqual(Object.keys(sources).sort(), Object.keys(manifest.sourceSha256).sort());
  for (const [path, source] of Object.entries(sources)) {
    assert.equal(source.encoding, 'utf8');
    assert.equal(sha256(source.content), source.sha256);
    assert.equal(source.sha256, manifest.sourceSha256[path]);
  }
  assert.equal(sha256(files['parp2-reference.pdb.gz']),
    raw.provenance.parp2Reference.filteredPdbSha256);
  assert.equal(raw.protocol.searchChains, 64);
  assert.equal(raw.protocol.featureSeedingProtocol, 'v5');
  assert(raw.records.length > 0);
  return raw;
}

test('source-stable intermediate fix remains a separate, byte-verifiable observation', async () => {
  const raw = await readAttempt('api-a03');
  assert.equal(raw.checks.requiredAndOmittedIntentPreserved, true);
  assert.equal(raw.checks.unavailableRequiredRefinementRejected, true);
  assert.equal(raw.checks.explicitOmissionRecovery.feasible, 23);
  assert.equal(raw.checks.explicitOmissionRecovery.candidates, 64);
  assert.equal(raw.checks.explicitOmissionRecovery.motionPolicy.protectedAtomIds.length, 19);
  assert.equal(raw.checks.explicitOmissionRecovery.motionPolicy.affectedRotorReleasedAtomIds.length, 5);
  assert.equal(raw.checks.changedRequirementInvalidatesCandidate, true);
  assert.equal(raw.checks.liveGeometryAfterReceptorMotion, true);
  assert.equal(raw.checks.fluorineOptionalWithExplicitOverride, true);
  assert(raw.records.some((entry) => entry.action === 'pose.refine'
    && /selected contact.*no role-compatible/i.test(entry.error || '')));
  assert(raw.records.some((entry) => entry.action === 'pose.apply' && entry.error));
});

for (const attempt of ['api-a04', 'api-a05']) test(`${attempt}: full original contacts survive; genuine feature deletion still fails closed`, async () => {
  const raw = await readAttempt(attempt);
  assert.equal(raw.protocol.regressionVersion, 2);
  assert.equal(raw.checks.requiredAndOmittedIntentPreserved, true);
  assert.equal(raw.checks.originalContactSetRecovery.feasible, 23);
  assert.equal(raw.checks.originalContactSetRecovery.candidates, 64);
  assert.equal(raw.checks.originalContactSetRecovery.requiredContactIds.length, 2);
  assert.equal(raw.checks.originalContactSetRecovery.motionPolicy.protectedAtomIds.length, 19);
  const motion = raw.checks.originalContactSetRecovery.motionPolicy;
  assert.equal(motion.affectedRotorReleasedAtomIds.length, 5);
  assert(motion.affectedRotorReleasedAtomIds.every((id) => motion.releasedInheritedAtomIds.includes(id)));
  assert(motion.releasedInheritedAtomIds.every((id) => !motion.protectedAtomIds.includes(id)));
  assert.equal(raw.checks.unchangedSingleDonorHydrogenPreserved.preserved.length, 1);
  assert.equal(raw.checks.unchangedSingleDonorHydrogenPreserved.preserved[0].maximumDisplacementAngstrom, 0);
  assert.equal(raw.checks.genuineFeatureRemovalContactIds.length, 2);
  assert.equal(raw.checks.unavailableRequiredRefinementRejected, true);
  assert.equal(raw.checks.changedRequirementInvalidatesCandidate, true);
  assert.equal(raw.checks.fluorineOptionalWithExplicitOverride, true);
  const baseline = raw.records.find((entry) => entry.action === 'session.inspect').response.result;
  const water = baseline.contacts.find((contact) => contact.label.includes('N7'));
  const applyIndex = raw.records.findIndex((entry) => entry.action === 'pose.apply' && !entry.error);
  assert(applyIndex > 0);
  assert(!raw.records.slice(0, applyIndex).some((entry) => entry.action === 'pose.setContact'
    && entry.args.contactId === water.contactId && entry.args.required === false));
  const applied = raw.records.slice(applyIndex + 1).find((entry) => entry.action === 'session.inspect').response.result;
  for (const before of baseline.contacts.filter((contact) => contact.required)) {
    const after = applied.contacts.find((contact) => contact.contactId === before.contactId);
    assert(after.required && after.available && after.hydrogenBond.satisfied);
  }
  const negativeIndex = raw.records.findIndex((entry) => entry.action === 'pose.refine'
    && /selected contact.*no role-compatible/i.test(entry.error || ''));
  assert(negativeIndex > applyIndex);
  const negativeState = raw.records.slice(0,negativeIndex).filter((entry) => entry.action === 'session.inspect').at(-1).response.result;
  assert.equal(negativeState.contacts.filter((contact) => contact.required && !contact.available).length, 2);
});

for (const attempt of ['api-a03', 'api-a04', 'api-a05']) test(`${attempt}: archived live geometry independently follows inspected coordinates`, async () => {
  const raw = await readAttempt(attempt);
  const distance = (a,b) => Math.hypot(...a.map((value,index) => value-b[index]));
  let snapshots = 0, measured = 0, unsatisfied = 0;
  for (const record of raw.records.filter((entry) => entry.action === 'session.inspect')) {
    const state = record.response.result;
    const byId = new Map(state.atoms.map((atom) => [atom.atomId, atom.coordinatesAngstrom]));
    snapshots++;
    for (const contact of state.contacts) {
      const actual = contact.hydrogenBond;
      assert.equal(actual.geometrySource, 'current-molecule-coordinates');
      if (!actual.measurable) { assert.equal(actual.satisfied, false); continue; }
      const [d,h,a] = ['donor','hydrogen','acceptor'].map((role) => {
        const participant = actual.participants[role], coordinates = byId.get(participant.atomId);
        assert(coordinates, 'Measured participants must survive the inspection cap');
        assert.deepEqual(participant.coordinatesAngstrom, coordinates);
        return coordinates;
      });
      const da = distance(d,a), ha = distance(h,a), dh = distance(d,h);
      const angle = Math.acos(Math.max(-1,Math.min(1,(dh*dh+ha*ha-da*da)/(2*dh*ha))))*180/Math.PI;
      assert(Math.abs(actual.donorAcceptorDistanceAngstrom-da) < 1e-9);
      assert(Math.abs(actual.hydrogenAcceptorDistanceAngstrom-ha) < 1e-9);
      assert(Math.abs(actual.dhaAngleDegrees-angle) < 1e-8);
      assert.equal(actual.satisfied,
        actual.available && da>=2.4 && da<=3.5 && ha>=1.2 && ha<=2.7 && angle>=120);
      if (!actual.satisfied) unsatisfied++;
      measured++;
    }
  }
  assert(snapshots >= 5 && measured >= 10 && unsatisfied > 0);
  assert(raw.checks.liveGeometryAfterRelaxation.maximumHaChangeAngstrom > 0.001);
});
