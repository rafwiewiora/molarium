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
from score_stock_localfold import score


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
    args = p.parse_args()
    plan = json.loads(args.plan.read_text())
    if plan['steps'] != 200 or plan['recycles'] != 3 or plan['seeds'] != list(range(10)):
        raise ValueError('This batch requires the frozen 200-step, 3-recycle, 10-seed protocol')
    args.output.mkdir(parents=True, exist_ok=False)
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
