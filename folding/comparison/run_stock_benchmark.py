"""Execute frozen stock-page jobs sequentially; never reuse consumed attempts."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
from datetime import datetime, timezone


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    temp.replace(path)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--plan', required=True, type=Path)
    p.add_argument('--repository', required=True, type=Path)
    p.add_argument('--upstream-root', required=True, type=Path)
    p.add_argument('--launcher', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--start-index', type=int, default=0)
    p.add_argument('--require-vendor', required=True, choices=['apple', 'nvidia'])
    p.add_argument('--prepare-only', action='store_true', help='freeze and verify the batch; no Chrome or inference')
    args = p.parse_args()
    plan_raw = args.plan.read_bytes()
    original_plan_sha256 = hashlib.sha256(plan_raw).hexdigest()
    plan = json.loads(plan_raw)
    if plan['steps'] != 200 or plan['recycles'] != 3 or plan['seeds'] != list(range(10)):
        raise ValueError('This batch requires the frozen 200-step, 3-recycle, 10-seed protocol')
    if not 0 <= args.start_index < len(plan['jobs']):
        raise ValueError('start-index is outside the frozen job set')
    if any(args.output.resolve().is_relative_to(root.resolve()) for root in [args.plan.parent, args.upstream_root]):
        raise ValueError('Output must be outside the input plan and pristine upstream directories')
    # Check the selection BEFORE any GPU work, then freeze all consumed inputs.
    references = {}
    for pair in plan['pairs']:
        for key in ['nativeScoreFile', 'referenceFile']:
            if Path(pair[key]).is_absolute() or '..' in Path(pair[key]).parts or '\\' in pair[key]:
                raise ValueError('Reference path must stay inside the repository')
        source = args.repository / pair['nativeScoreFile']
        if sha(source) != pair['nativeScoreSha256']:
            raise ValueError('Native selection source changed')
        hits = [r for r in json.loads(source.read_text())['poses']
                if r['caseId'] == pair['caseId'] and r.get('status') == 'complete'
                and 'native-' + pair['model'] in r['method'] and r['ligandRmsdA'] < 2]
        if not hits or min(r['ligandRmsdA'] for r in hits) != pair['nativeBestA']:
            raise ValueError('A selected pair lacks its recorded same-model native <2 Å hit')
        for key, hash_key in [('nativeScoreFile', 'nativeScoreSha256'), ('referenceFile', 'referenceSha256')]:
            path = args.repository / pair[key]
            if sha(path) != pair[hash_key]:
                raise ValueError('Frozen reference evidence changed')
            references[pair[key]] = path
    for job in plan['jobs']:
        if Path(job['input']).is_absolute() or '..' in Path(job['input']).parts or '\\' in job['input']:
            raise ValueError('Inference input path must stay inside the plan directory')
        if sha(args.plan.parent / job['input']) != job['inputSha256']:
            raise ValueError('A planned inference input changed')
    args.output.mkdir(parents=True, exist_ok=False)
    frozen_source = args.output / 'source'
    frozen_source.mkdir()
    for name in ['run_stock_benchmark.py', 'score_stock_localfold.py', 'experimental_reference.py',
                 'pose_metrics.py', 'requirements-analysis.txt']:
        shutil.copyfile(Path(__file__).with_name(name), frozen_source / name)
    shutil.copyfile(args.launcher, frozen_source / 'run_stock_localfold.py')
    save(args.output / 'source-manifest.json', {p.name: sha(p) for p in frozen_source.iterdir()})
    shutil.copytree(args.plan.parent, args.output / 'frozen-plan')
    args.plan = args.output / 'frozen-plan' / args.plan.name
    for name, source in references.items():
        target = args.output / 'reference-evidence' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    args.repository = args.output / 'reference-evidence'
    args.launcher = frozen_source / 'run_stock_localfold.py'
    sys.path.insert(0, str(frozen_source.resolve()))
    from run_stock_localfold import verify_upstream
    upstream = verify_upstream(args.upstream_root.resolve())
    if upstream['revision'] != plan['sourceRevision']:
        raise ValueError('Upstream source differs from the frozen protocol')
    if sha(args.plan) != original_plan_sha256:
        raise ValueError('Plan changed while the batch was being frozen')
    for job in plan['jobs']:
        if sha(args.plan.parent / job['input']) != job['inputSha256']:
            raise ValueError('Frozen inference input differs from the preflight')
    for pair in plan['pairs']:
        for key, hash_key in [('nativeScoreFile', 'nativeScoreSha256'), ('referenceFile', 'referenceSha256')]:
            if sha(args.repository / pair[key]) != pair[hash_key]:
                raise ValueError('Frozen reference evidence differs from the preflight')
    if args.prepare_only:
        save(args.output / 'prepared.json', {'status': 'prepared-not-run', 'upstream': upstream,
            'planSha256': original_plan_sha256, 'jobs': len(plan['jobs']), 'neuralForwards': 0,
            'scope': 'Immutable source, inference inputs and native selection/reference evidence verified before GPU execution.'})
        print(json.dumps({'status': 'prepared-not-run', 'jobs': len(plan['jobs']), 'neuralForwards': 0}))
        return 0
    from score_stock_localfold import score
    expected_plan, expected_launcher = sha(args.plan), sha(args.launcher)
    report = {'status': 'running', 'startedAt': datetime.now(timezone.utc).isoformat(),
              'planSha256': expected_plan, 'launcherSha256': expected_launcher,
              'startIndex': args.start_index, 'planned': len(plan['jobs']) - args.start_index,
              'requireVendor': args.require_vendor, 'records': []}
    consecutive_errors = 0
    for job in plan['jobs'][args.start_index:]:
        if sha(args.plan) != expected_plan or sha(args.launcher) != expected_launcher:
            raise ValueError('Frozen plan or launcher changed during batch')
        index = job['index']
        directory = args.output / f'{index:03d}-{job["caseId"]}-{job["model"]}-seed{job["seed"]}'
        command = [sys.executable, '-B', str(args.launcher.resolve()),
                   '--upstream-root', str(args.upstream_root.resolve()),
                   '--job', str((args.plan.parent / job['input']).resolve()),
                   '--output', str(directory.resolve()), '--model', job['model'],
                   '--steps', str(plan['steps']), '--recycles', str(plan['recycles']),
                   '--timeout', '3600', '--require-vendor', args.require_vendor]
        record = {'index': index, 'caseId': job['caseId'], 'model': job['model'],
                  'seed': job['seed'], 'startedAt': datetime.now(timezone.utc).isoformat(),
                  'directory': directory.name, 'status': 'running'}
        report['records'].append(record)
        save(args.output / 'progress.json', report)
        print(json.dumps({k: record[k] for k in ['index', 'caseId', 'model', 'seed', 'status']}), flush=True)
        try:
            with (args.output / f'{index:03d}-launcher.log').open('x') as log:
                proc = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                                        start_new_session=True)
                try:
                    proc.wait(timeout=3900)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGTERM)
                    proc.wait(timeout=30)
                    raise RuntimeError('Owned run process group exceeded wall-clock limit')
            if proc.returncode != 0:
                raise RuntimeError(f'Original-page launcher returned {proc.returncode}')
            measured = score(args.plan, args.repository, index, directory)
            save(directory / 'score.json', measured)
            record.update({'status': 'complete', 'ligandRmsdA': measured['ligandRmsdA'],
                           'limitedValidityPass': measured['limitedValidityPass'],
                           'receiptSha256': sha(directory / 'receipt.json'),
                           'scoreSha256': sha(directory / 'score.json')})
            consecutive_errors = 0
        except Exception as exc:
            record.update({'status': 'failed', 'error': f'{type(exc).__name__}: {exc}'})
            consecutive_errors += 1
        finally:
            # Each invocation created this exact task-owned profile. Shards and
            # shader caches are disposable; all science/receipts remain intact.
            profile = directory / 'chrome-profile'
            if profile.is_dir() and not profile.is_symlink():
                shutil.rmtree(profile)
                save(directory / 'profile-retirement.json', {
                    'retiredAt': datetime.now(timezone.utc).isoformat(),
                    'path': 'chrome-profile', 'scope': 'Only the fresh task-owned browser cache/profile; all inputs, outputs and logs retained.'})
            record['finishedAt'] = datetime.now(timezone.utc).isoformat()
            save(args.output / 'progress.json', report)
            print(json.dumps(record), flush=True)
        if consecutive_errors >= 3:
            report['status'] = 'stopped-after-three-consecutive-errors'
            break
    else:
        report['status'] = 'finished-with-failures' if any(r['status'] != 'complete' for r in report['records']) else 'complete'
    report['finishedAt'] = datetime.now(timezone.utc).isoformat()
    save(args.output / 'progress.json', report)
    return 0 if report['status'] == 'complete' else 1


if __name__ == '__main__':
    raise SystemExit(main())
