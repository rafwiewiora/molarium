"""Recompute the direct-entrypoint and dispatch evidence from preserved GPU bytes.

No inference runs here. NumPy compares the saved outputs with the same official
FP64 fixture; larger dispatch cases repeat independent native rows.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile
import numpy as np


def sha(data):
    return hashlib.sha256(data).hexdigest()


def archive(root, declaration):
    data = (root / declaration['file']).read_bytes()
    assert len(data) == declaration['bytes'] and sha(data) == declaration['sha256']
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        assert set(z.namelist()) == {f['file'] for f in declaration['files']}
        files = {f['file']: z.read(f['file']) for f in declaration['files']}
    for item in declaration['files']:
        assert len(files[item['file']]) == item['bytes']
        assert sha(files[item['file']]) == item['sha256']
    return files


def metrics(actual, expected):
    finite = bool(np.isfinite(actual).all())
    if not finite:
        return {'finite': False, 'relativeRms': None, 'maxAbs': None}
    delta = actual - expected
    return {'finite': True,
            'relativeRms': float(np.sqrt(np.sum(delta * delta) / np.sum(expected * expected))),
            'maxAbs': float(np.max(np.abs(delta)))}


def same_metrics(actual, reported):
    assert actual['finite'] == reported['finite']
    for key in ['relativeRms', 'maxAbs']:
        assert actual[key] is not None and reported[key] is not None
        assert abs(actual[key] - reported[key]) <= max(1e-12, abs(actual[key]) * 1e-9)


def evaluate(root):
    root = Path(root)
    evidence = json.loads((root / 'evidence.json').read_bytes())
    files = archive(root, evidence['archive'])
    precision_root = root.parent / 'production'
    precision_evidence = json.loads((precision_root / 'evidence.json').read_bytes())
    native_files = archive(precision_root, next(a for a in precision_evidence['archives']
                                               if a['file'] == 'reference-evidence.zip'))
    native_bytes = native_files['manifest.json']
    native = json.loads(native_bytes)
    native_blob = native_files['fixtures.bin']
    assert sha(native_blob) == native['blob']['sha256']
    cases = {c['id']: c for c in native['cases']}
    prior_bytes = (precision_root / 'comparison.json').read_bytes()
    prior = json.loads(prior_bytes)
    prior_index = {(r['caseId'], r['style'], r['shifted'], r['kind']): r
                   for r in prior['outputs']['records']}

    def expected(case_id):
        item = native['arrays'][cases[case_id]['expectedF64']]
        part = native_blob[item['byteOffset']:item['byteOffset'] + item['bytes']]
        assert len(part) == item['bytes'] and sha(part) == item['sha256']
        return np.frombuffer(part, dtype='<f8')

    summary = []
    for name in ['direct-transition-entrypoint001', 'transition-dispatch-before001',
                 'transition-dispatch-after001']:
        report = json.loads(files[name + '.json'])
        direct = name.startswith('direct')
        stage = 'before' if direct or not report['afterFix'] else 'after'
        source = files[f'{stage}/transition.js']
        receipt = files[f'{stage}/UPSTREAM.json']
        source_sha = report['transitionSourceSha256'] if direct else report['candidateSourceSha256']
        assert sha(source) == source_sha and sha(receipt) == report['sourceReceiptSha256']
        assert sha(files['direct-runner.mjs' if direct else 'dispatch-runner.mjs']) == report['runnerSha256']
        assert sha(native_bytes) == report['precisionManifestSha256']
        assert native['originalManifestSha256'] == report['originalManifestSha256']
        saved_receipt = json.loads(receipt)
        source_entry = next(f for f in saved_receipt['files'] if f['path'] == 'webgpu/af3/trunk/transition.js')
        assert source_entry['sha256'] == source_sha and source_entry['bytes'] == len(source)
        patch_manifest = json.loads(files[f'{stage}/patch-manifest.json'])
        patch = patch_manifest['patches'][0]
        assert patch['sha256'] == source_sha and sha(files[f'{stage}/patch.diff']) == patch['patchSha256']
        assert patch['upstreamSha256'] == sha(files['upstream-transition.txt'])
        if not direct:
            assert report['baselineSourceSha256'] == sha(files['upstream-transition.txt'])
        else:
            assert sha(prior_bytes) == report['priorComparisonSha256']
        blob = files[report['outputs']['file']]
        assert len(blob) == report['outputs']['bytes'] and sha(blob) == report['outputs']['sha256']
        assert len(report['records']) == len(report['outputs']['records'])
        offset = 0
        failures = 0
        for reported, descriptor in zip(report['records'], report['outputs']['records']):
            assert descriptor['byteOffset'] == offset
            part = blob[offset:offset + descriptor['bytes']]
            offset += descriptor['bytes']
            assert len(part) == descriptor['bytes'] and sha(part) == descriptor['sha256']
            actual = np.frombuffer(part, dtype='<f4').astype(np.float64)
            if direct:
                assert reported['caseId'] == descriptor['caseId']
                gold = expected(reported['caseId'])
                assert sha(part) == reported['outputSha256'] == reported['priorOutputSha256']
                assert sha(part) == prior_index[(reported['caseId'], 'fused', True, 'output')]['sha256']
                assert reported['exactPriorOutputMatch']
                unwritten = 0
            else:
                for key in ['rows', 'implementation', 'mode']:
                    assert reported[key] == descriptor[key]
                assert actual.size == reported['rows'] * reported['channels']
                gold = np.resize(expected(report['referenceCase']), actual.size)
                unwritten = int(np.sum(np.all(actual.reshape(reported['rows'], reported['channels']) == 0, axis=1)))
                assert unwritten == reported['unwrittenRows']
            measured = metrics(actual, gold)
            same_metrics(measured, reported)
            passes = measured['finite'] and not unwritten and measured['relativeRms'] <= 1e-4 and measured['maxAbs'] <= 2e-4
            assert bool(passes) == reported['passesF32Gate']
            failures += not passes
        assert offset == len(blob)
        summary.append({'measurement': name, 'records': len(report['records']),
                        'passes': len(report['records']) - failures, 'failures': failures})
    assert [r['failures'] for r in summary] == [0, 4, 2]
    return {'schema': 'molarium.transition-integration-analysis.v1',
            'rawMetricsRecomputed': sum(r['records'] for r in summary), 'summary': summary,
            'scope': 'Saved component GPU outputs only; no full-model or cross-vendor qualification.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    print(json.dumps(evaluate(args.directory), indent=2))
