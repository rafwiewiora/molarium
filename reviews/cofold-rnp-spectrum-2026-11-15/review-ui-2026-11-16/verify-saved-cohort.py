"""Verify saved full-cohort browser receipts against original library records.

Read-only UI evidence validation; no browser, model, network or scheduler calls.
"""
import argparse
import collections
import hashlib
import importlib.util
import json
from pathlib import Path


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def read(p):
    return json.loads(p.read_bytes())


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--cohort', required=True, type=Path)
    p.add_argument('--exports', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    a = p.parse_args()
    receipt, frozen = read(a.cohort / 'receipt.json'), read(a.cohort / 'frozen-plan.json')
    manifest_path = a.exports / 'manifest.json'
    manifest, manifest_sha = read(manifest_path), sha(manifest_path)
    assert receipt['status'] == 'complete' and receipt['passed'] == 48 and receipt['failed'] == 0
    assert receipt['sourcePlanSha256'] == sha(a.cohort / 'frozen-plan.json')
    assert receipt['exportManifestSha256'] == manifest_sha == frozen['exportManifestSha256']
    assert receipt['samplesPerCase'] == manifest['samplesPerCase'] == frozen['samplesPerCase']
    assert len(frozen['caseIds']) == len(set(frozen['caseIds'])) == 48
    assert manifest['caseIds'] == frozen['caseIds']
    assert [r['caseId'] for r in receipt['records']] == frozen['caseIds']
    runner = a.cohort / 'source/runner.py'
    assert sha(runner) == frozen['runnerSha256']
    for name, digest in frozen['sources'].items():
        assert sha(a.cohort / 'source' / name) == digest, name
    assert sha(a.cohort / 'source/chrome-software-review.sh') == frozen['chromeWrapperSha256']
    spec = importlib.util.spec_from_file_location('consumed_ui_validator', runner)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert frozen['experimentPlanSha256'] == module.PLAN_SHA
    totals = collections.Counter()
    for row in receipt['records']:
        case = row['caseId']; result_path = a.cohort / 'cases' / case / 'result.json'
        assert row['status'] == 'pass' and row.get('exitCode', 0) == 0
        assert sha(result_path) == row['resultSha256']
        result = read(result_path)
        module.validate_result(result, manifest, manifest_sha, case, a.exports)
        assert result['isolatedInferenceTimingInvented'] is False
        for entry in [e for e in manifest['libraries'] if e['caseId'] == case]:
            q = a.exports / entry['file']; assert sha(q) == entry['sha256'] and q.stat().st_size == entry['bytes']
            bundle = read(q)
            assert bundle['decisions'] == []
        totals['cases'] += 1
        totals['predictionRecords'] += result['renderedUniquePredictions']
        totals['referenceInclusiveRecords'] += result['renderedReferenceInclusiveRecords']
        totals['gridPages'] += len(result['predictionPages']) + len(result['referencePages'])
    assert totals['predictionRecords'] == 48 * manifest['samplesPerCase']
    assert totals['referenceInclusiveRecords'] == 48 * (manifest['samplesPerCase'] + 1)
    assert receipt['newNeuralForwards'] == receipt['publicationActions'] == 0
    files = [{'file': str(q.relative_to(a.cohort)), 'bytes': q.stat().st_size, 'sha256': sha(q)}
             for q in sorted(a.cohort.rglob('*')) if q.is_file()]
    out = {'schema': 'molarium.stock-ui-saved-receipt-verification.v1', 'status': 'pass',
           'scope': 'Verify all saved actual-browser receipts, every pose page ID, original input hashes and frozen consumed sources. This does not rerun the UI or prove unobserved behavior.',
           'samplesPerCase': manifest['samplesPerCase'], **dict(totals),
           'sourceReceiptSha256': sha(a.cohort / 'receipt.json'),
           'exportManifestSha256': manifest_sha, 'verificationScriptSha256': sha(Path(__file__)),
           'newNeuralForwards': 0, 'newBrowserRuns': 0, 'scientificJudgements': 0,
           'files': files}
    assert not a.output.exists()
    a.output.write_text(json.dumps(out, indent=2) + '\n')
    print(json.dumps({k: v for k, v in out.items() if k != 'files'}, indent=2))


if __name__ == '__main__':
    main()
