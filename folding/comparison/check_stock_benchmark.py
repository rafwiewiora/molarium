"""Verify public stock-page evidence and recompute scores without inference."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import tempfile
import zipfile
from score_stock_localfold import score


def check(review):
    evidence = json.loads((review / 'evidence.json').read_text())
    raw = (review / 'evidence.zip').read_bytes()
    if hashlib.sha256(raw).hexdigest() != evidence['archiveSha256']:
        raise ValueError('Evidence archive hash differs')
    scores_raw = (review / 'scores.json').read_bytes()
    if hashlib.sha256(scores_raw).hexdigest() != evidence['scoresSha256']:
        raise ValueError('Published scores hash differs')
    published = json.loads(scores_raw)
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        with zipfile.ZipFile(review / 'evidence.zip') as archive:
            names = archive.namelist()
            if len(set(names)) != len(names) or len(names) > 4000:
                raise ValueError('Duplicate or excessive evidence members')
            for name in names:
                path = PurePosixPath(name)
                if path.is_absolute() or '..' in path.parts or '\\' in name:
                    raise ValueError('Archive member escapes evidence directory')
            if sum(info.file_size for info in archive.infolist()) > 256 * 1024 * 1024:
                raise ValueError('Expanded evidence exceeds the declared artifact budget')
            manifest = json.loads(archive.read('archive-manifest.json'))
            if set(manifest) != set(names) - {'archive-manifest.json'}:
                raise ValueError('Evidence inventory differs')
            for name, record in manifest.items():
                data = archive.read(name)
                if len(data) != record['bytes'] or hashlib.sha256(data).hexdigest() != record['sha256']:
                    raise ValueError(f'Incomplete/corrupt evidence member: {name}')
            archive.extractall(root)
        plan_file = root / 'frozen-plan/plan.json'
        if hashlib.sha256(plan_file.read_bytes()).hexdigest() != published['planSha256']:
            raise ValueError('Frozen plan hash differs')
        if (root / 'independent-scores.json').read_bytes() != scores_raw:
            raise ValueError('Archive and public score JSON differ')
        plan = json.loads(plan_file.read_text())
        rows = published['poses']
        if len(rows) != len(plan['jobs']) or [r['index'] for r in rows] != list(range(len(plan['jobs']))):
            raise ValueError('Planned prediction denominator differs')
        checked = 0
        for job, row in zip(plan['jobs'], rows):
            if (row['caseId'], row['model'], row['seed']) != (job['caseId'], job['model'], job['seed']):
                raise ValueError('Prediction identity differs')
            if row['status'] != 'complete':
                continue
            for name, digest in row['analysisScripts'].items():
                if manifest['independent-analysis-source/' + name]['sha256'] != digest:
                    raise ValueError('Analysis source record differs from the archived source')
            actual = score(plan_file, root / 'reference-evidence', job['index'], root / f'predictions/{job["index"]:03d}')
            if abs(actual['ligandRmsdA'] - row['ligandRmsdA']) > 1e-8 or actual['limitedValidityPass'] != row['limitedValidityPass']:
                raise ValueError('Independent crystal score differs')
            checked += 1
        if checked != published['completed'] or checked != evidence['completed']:
            raise ValueError('Completed prediction count differs')
        for summary in published['summary']:
            done = [r for r in rows if (r['caseId'], r['model']) == (summary['caseId'], summary['model']) and r['status'] == 'complete']
            if summary['complete'] != len(done) or summary['posesWithin2A'] != sum(r['ligandRmsdA'] < 2 for r in done):
                raise ValueError('Summary success counts differ')
            if summary['limitedValidityPassingHits'] != sum(r['ligandRmsdA'] < 2 and r['limitedValidityPass'] for r in done):
                raise ValueError('Summary validity counts differ')
    return {'status': 'pass', 'recomputedPredictions': checked,
            'plannedPredictions': len(rows), 'scope': published['status'],
            'neuralForwards': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('review', type=Path)
    args = parser.parse_args()
    print(json.dumps(check(args.review)))
