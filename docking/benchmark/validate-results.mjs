import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null;
};
const resultsName = valueAfter('--input') || 'benchmark-results.v0.1.json';
const scoredName = valueAfter('--scored') || resultsName.replace(/\.json$/, '.scored.json');
const resultBytes = await readFile(path.join(root, resultsName));
const results = JSON.parse(resultBytes);
const scored = JSON.parse(await readFile(path.join(root, scoredName), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.v0.1.json'), 'utf8'));
const runInputBytes = await readFile(path.join(root, 'run-input.v0.1.json'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const allowedOutcomes = new Set([
  'success-feasible', 'success-infeasible-negative-control', 'chemistry-invalid',
  'parameterization-unsupported', 'reference-contact-unavailable', 'no-feasible-pose',
  'excessive-strain-warning', 'ambiguous-unresolved', 'runtime-failure',
  'preparation-blocked', 'repeat-disagreement', 'unexpected-contact-transfer',
]);
const allowedPreRunOutcomes = new Set([
  'chemistry-invalid', 'parameterization-unsupported', 'reference-contact-unavailable',
  'ambiguous-unresolved', 'runtime-failure',
]);
assert.equal(results.datasetId, manifest.datasetId);
assert.equal(results.runInputSha256, sha256(runInputBytes), 'run-input hash changed after execution');
assert.equal(scored.sourceResultSha256, sha256(resultBytes), 'scoring does not match the result file');
assert.deepEqual(scored.cases.map((entry) => entry.caseId),
  results.results.map((entry) => entry.caseId));
assert.equal(new Set(results.results.map((entry) => entry.caseId)).size, results.results.length);
if (results.mode === 'registered') assert.equal(results.results.length, manifest.cases.length,
  'a registered report must retain every frozen case');

const caseById = new Map(manifest.cases.map((entry) => [entry.id, entry]));
for (const record of results.results) {
  const registered = caseById.get(record.caseId);
  assert.ok(registered, `${record.caseId}: unregistered result`);
  assert.ok(allowedOutcomes.has(record.terminalOutcome), `${record.caseId}: unknown terminal outcome`);
  assert.equal(record.inputCaseSha256,
    sha256(JSON.stringify(JSON.parse(runInputBytes).cases.find((entry) => entry.id === record.caseId))),
  `${record.caseId}: executed input differs from the registered case`);
  if (record.terminalOutcome === 'preparation-blocked') {
    assert.ok(record.preparation.blockers.length, `${record.caseId}: blocker outcome has no blocker`);
    continue;
  }
  if (record.terminalOutcome === 'parameterization-unsupported') {
    assert.equal((record.repeats || []).length, 0,
      `${record.caseId}: unsupported parameterization unexpectedly produced repeats`);
    continue;
  }
  for (const repeat of record.repeats || []) {
    if (!repeat.run) {
      assert.ok(allowedPreRunOutcomes.has(repeat.terminalOutcome)
        || repeat.terminalOutcome === 'success-infeasible-negative-control',
      `${record.caseId}: a missing browser run has no valid terminal explanation`);
      assert.ok(repeat.captured || repeat.terminalOutcome === 'runtime-failure',
        `${record.caseId}: pre-run termination is missing reference-capture evidence`);
      continue;
    }
    assert.ok(repeat.run, `${record.caseId}: missing browser run record`);
    assert.equal(repeat.run.labbook.valid, true, `${record.caseId}: labbook hash chain failed`);
    assert.ok(repeat.selectedLigand.atoms.every((atom) =>
      [atom.x, atom.y, atom.z].every(Number.isFinite)), `${record.caseId}: non-finite coordinates`);
    assert.ok(repeat.geometrySanity, `${record.caseId}: geometry sanity audit is missing`);
    if (repeat.terminalOutcome !== 'excessive-strain-warning')
      assert.equal(repeat.geometrySanity.acceptable, true,
        `${record.caseId}: a numerically suspect pose was reported without a warning`);
    assert.ok(repeat.geometrySanity.minimumBondLengthAngstrom >= 0.5);
    assert.ok(repeat.geometrySanity.maximumBondLengthAngstrom <= 2.6);
    assert.equal(repeat.run.topPoses[0].rank, 1);
    assert.equal(repeat.run.topPoses[0].atoms.length,
      registered.posePropagationMap.productHeavyAtoms);
  }
  if (registered.tier === 'adversarial-negative') {
    assert.notEqual(record.terminalOutcome, 'unexpected-contact-transfer',
      `${record.caseId}: the negative control manufactured a transferable feature`);
    assert.ok((record.repeats || []).every((repeat) =>
      repeat.terminalOutcome === 'success-infeasible-negative-control'),
    `${record.caseId}: a completed negative repeat manufactured a transferable feature`);
  }
}

for (const entry of scored.cases.filter((caseEntry) => caseEntry.tier === 'paired-crystal')) {
  const record = results.results.find((result) => result.caseId === entry.caseId);
  if (!(record.repeats || []).some((repeat) => repeat.run?.topPoses?.length)) continue;
  assert.equal(entry.pairedCrystal.symmetryCorrection, false);
  assert.equal(entry.pairedCrystal.receptorAlignmentScope, 'ligand-assigned protein chain');
  assert.ok(entry.pairedCrystal.receptorAlignmentAtoms >= 20);
  assert.ok(Number.isFinite(entry.pairedCrystal.receptorAlignmentRmsdAngstrom));
  assert.ok(entry.pairedCrystal.receptorAlignmentRmsdAngstrom < 5,
    `${entry.caseId}: receptor alignment is too poor for a pose-accuracy claim`);
  assert.ok(entry.pairedCrystal.repeats.every((repeat) =>
    Number.isFinite(repeat.top1.labelMappedHeavyAtomRmsdAngstrom)
      && repeat.top1.maximumInheritedCoordinateResidualAngstrom < 1e-5));
  assert.ok(Number.isFinite(entry.pairedCrystal.top5MedianMinimumHeavyAtomRmsdAngstrom));
  assert.ok(Number.isFinite(entry.pairedCrystal.top5BestObservedHeavyAtomRmsdAngstrom));
  assert.ok(entry.pairedCrystal.top5BestObservedHeavyAtomRmsdAngstrom
    <= entry.pairedCrystal.top5MedianMinimumHeavyAtomRmsdAngstrom);
}
console.log(`Bioisostere benchmark results: PASS (${results.results.length} ${results.mode} cases)`);
