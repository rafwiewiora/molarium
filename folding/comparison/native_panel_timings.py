"""Summarize saved synchronized model-forward timings; never run inference."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import statistics
import zipfile


def summarize(phase):
    evidence_bytes = (phase / 'evidence.json').read_bytes()
    evidence = json.loads(evidence_bytes)
    raw = (phase / evidence['archive']['file']).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == evidence['archive']['sha256']
    cases = []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        declared = {f['file']: f for f in evidence['archive']['files']}
        def read(name):
            data = archive.read(name)
            assert hashlib.sha256(data).hexdigest() == declared[name]['sha256']
            assert len(data) == declared[name]['bytes']
            return data
        for case in evidence['cases']:
            case_id = case['caseId']
            receipt = json.loads(read(f'{case_id}/receipt.public.json'))
            if receipt['schema'] == 'molarium.native-assembled-cohort.v1':
                segments = [(f'{case_id}/recovery/{s["id"]}/native/forward-times.jsonl',
                             s['environment']['gpu']) for s in receipt['sources']]
            else:
                segments = [(f'{case_id}/outputs/forward-times.jsonl', receipt['environment']['gpu'])]
            records, sources = [], []
            for name, gpu in segments:
                data = read(name)
                rows = [json.loads(line) for line in data.splitlines() if line.strip()]
                assert rows and all(r['seconds'] > 0 for r in rows)
                records.extend(rows)
                sources.append({'file': name, 'sha256': hashlib.sha256(data).hexdigest(),
                                'gpu': gpu, 'forwards': len(rows)})
            assert len(records) == case['poses']
            values = [r['seconds'] for r in records]
            cases.append({'caseId': case_id, 'forwards': len(records),
                          'medianSeconds': statistics.median(values), 'minSeconds': min(values),
                          'maxSeconds': max(values),
                          'peakReservedBytes': max(r['peakReservedBytes'] for r in records),
                          'sources': sources, 'recordsInSourceCallOrder': records})
    return {'schema': 'molarium.native-panel-forward-timings.v1',
            'evidenceSha256': hashlib.sha256(evidence_bytes).hexdigest(),
            'boundary': 'CUDA-synchronized official model forward, including sampling and confidence; excludes checkpoint loading, input featurization, CLI startup and output writing. Records are not assigned to individual seeds.',
            'comparisonLimit': 'Native GPU/precision differs from browser runs; browser elapsed times have different boundaries. These numbers alone are not a browser/native speedup measurement.',
            'cases': cases}


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--phase', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    a.output.write_text(json.dumps(summarize(a.phase), indent=2, allow_nan=False) + '\n')
