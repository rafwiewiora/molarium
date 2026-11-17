"""Verify public stock-page evidence and recompute scores without inference."""
import argparse
import hashlib
import io
import json
import re
from pathlib import Path, PurePosixPath
import tempfile
import zipfile
from score_stock_localfold import score


def check(review, max_expanded_bytes=256*1024*1024, max_members=4000):
    # Larger frozen cohorts can opt into an explicit finite artifact budget.
    # Neither this option nor archive size changes relaxes scientific checks.
    if not 0<max_expanded_bytes<=2*1024**3 or not 0<max_members<=20000:
        raise ValueError('Finite evidence budget required (at most 2 GiB / 20,000 members)')
    evidence = json.loads((review / 'evidence.json').read_text())
    if evidence.get('archiveParts'):
        chunks = []
        for part in evidence['archiveParts']:
            path = PurePosixPath(part['file'])
            if path.is_absolute() or len(path.parts) != 1 or '..' in path.parts or '\\' in part['file']:
                raise ValueError('Archive part must be a sibling file')
            data = (review / part['file']).read_bytes()
            if len(data) != part['bytes'] or hashlib.sha256(data).hexdigest() != part['sha256']:
                raise ValueError('Archive part is incomplete or corrupt')
            chunks.append(data)
        raw = b''.join(chunks)
    else:
        raw = (review / 'evidence.zip').read_bytes()
    if hashlib.sha256(raw).hexdigest() != evidence['archiveSha256']:
        raise ValueError('Evidence archive hash differs')
    scores_raw = (review / 'scores.json').read_bytes()
    if hashlib.sha256(scores_raw).hexdigest() != evidence['scoresSha256']:
        raise ValueError('Published scores hash differs')
    published = json.loads(scores_raw)
    frames_seen, vendors, browsers = set(), set(), set()
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names = archive.namelist()
            if len(set(names)) != len(names) or len(names) > max_members:
                raise ValueError('Duplicate or excessive evidence members')
            for name in names:
                path = PurePosixPath(name)
                if path.is_absolute() or '..' in path.parts or '\\' in name:
                    raise ValueError('Archive member escapes evidence directory')
            if sum(info.file_size for info in archive.infolist()) > max_expanded_bytes:
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
        merge_file=root/'source-attempts/merge-receipt.json'
        if merge_file.is_file():
            merge=json.loads(merge_file.read_bytes());source_complete={}
            if merge['planSha256']!=published['planSha256']or merge['newNeuralForwards']!=0:raise ValueError('Merged storage provenance differs')
            canonical=json.loads((root/'consumed-batch-source/source-manifest.json').read_bytes())
            for source in merge['sources']:
                if not re.fullmatch(r'attempt-[0-9]{3}',source['id']):raise ValueError('Invalid source attempt identity')
                progress_bytes=(root/'source-attempts'/(source['id']+'.progress.json')).read_bytes()
                code_bytes=(root/'source-attempts'/(source['id']+'.source-manifest.json')).read_bytes()
                if hashlib.sha256(progress_bytes).hexdigest()!=source['progressSha256']or hashlib.sha256(code_bytes).hexdigest()!=source['sourceManifestSha256']or json.loads(code_bytes)!=canonical:
                    raise ValueError('Original source attempt hashes differ')
                for record in json.loads(progress_bytes)['records']:
                    if record['status']!='complete':continue
                    if record['index']in source_complete:raise ValueError('Repeated completed prediction in source history')
                    source_complete[record['index']]=record
            if set(source_complete)!={r['index']for r in rows if r['status']=='complete'}:raise ValueError('Merged completion history differs')
            for row in rows:
                if row['status']!='complete':continue
                original=source_complete[row['index']];attempt=root/f'predictions/{row["index"]:03d}'
                if original['receiptSha256']!=hashlib.sha256((attempt/'receipt.json').read_bytes()).hexdigest()or original['scoreSha256']!=row['initialScoreSha256']:
                    raise ValueError('Merged prediction differs from its original checkpoint')
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
            if actual['confidence'] != row['confidence'] or actual['receiptSha256'] != row['receiptSha256']:
                raise ValueError('Published confidence or receipt differs from the original output')
            attempt = root / f'predictions/{job["index"]:03d}'
            receipt = json.loads((attempt / 'receipt.json').read_text())
            log = (attempt / 'upstream.log').read_text().splitlines()
            controls = [json.loads(line.split(': ', 1)[1]) for line in log if line.startswith('controls: ')]
            frames = [json.loads(line.split(': ', 1)[1]) for line in log if line.startswith('frames: ')]
            if len(controls) != 1 or controls[0] != receipt['observedControls']:
                raise ValueError('Original page controls differ from the receipt')
            if (controls[0]['model'], int(controls[0]['af3count']), int(controls[0]['recycles'])) != (
                    job['model'], plan['steps'], plan['recycles']):
                raise ValueError('Original page did not use the frozen sampling budget')
            if len(frames) != 1 or frames[0]['frames'] != plan['steps'] or len(frames[0]['perFrame']) != plan['steps']:
                raise ValueError('Original page did not retain the expected diffusion-step frames')
            device = receipt['actualFoldingDevice']
            if receipt.get('neuralInferenceCompleted') is not True or device['backend'] != 'webgpu' or device['profile']['software'] is not False:
                raise ValueError('Completed physical-WebGPU inference was not established')
            frames_seen.add(frames[0]['frames'])
            vendors.add(device['profile']['vendor'])
            browsers.add(receipt['browserVersion']['product'])
            checked += 1
        if checked != published['completed'] or checked != evidence['completed']:
            raise ValueError('Completed prediction count differs')
        for summary in published['summary']:
            done = [r for r in rows if (r['caseId'], r['model']) == (summary['caseId'], summary['model']) and r['status'] == 'complete']
            if summary['complete'] != len(done) or summary['posesWithin2A'] != sum(r['ligandRmsdA'] < 2 for r in done):
                raise ValueError('Summary success counts differ')
            if summary['limitedValidityPassingHits'] != sum(r['ligandRmsdA'] < 2 and r['limitedValidityPass'] for r in done):
                raise ValueError('Summary validity counts differ')
        sampling_file = review / 'selection-analysis.json'
        if sampling_file.is_file():
            from analyze_rnp_sampling import analyze, timings
            expected = analyze(plan, published)
            expected.update({'planSha256': published['planSha256'],
                             'scoresSha256': hashlib.sha256(scores_raw).hexdigest(),
                             'scriptSha256': hashlib.sha256(Path(__file__).with_name('analyze_rnp_sampling.py').read_bytes()).hexdigest(),
                             'timing': timings(root, plan, published, archived=True)})
            if json.loads(sampling_file.read_bytes()) != expected:
                raise ValueError('Sampling, confidence selection or timing analysis differs')
    return {'status': 'pass', 'recomputedPredictions': checked,
            'plannedPredictions': len(rows), 'scope': published['status'],
            'neuralForwards': 0, 'observedDiffusionFrames': sorted(frames_seen),
            'actualGpuVendors': sorted(vendors), 'browserVersions': sorted(browsers)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('review', type=Path)
    parser.add_argument('--max-expanded-mib',type=int,default=256)
    parser.add_argument('--max-members',type=int,default=4000)
    args = parser.parse_args()
    print(json.dumps(check(args.review,args.max_expanded_mib*1024*1024,args.max_members)))
