"""Wait for existing stock attempts, then independently analyze them without inference.

No neural launcher, scheduler, network, git or deployment operation is invoked.
An unfinished stopped batch needs a separate audited recovery; this tool never
restarts it. Use a fresh output directory and a finite wait deadline.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

from analyze_rnp_sampling import analyze, timings
from assemble_stock_benchmark import assemble
from check_stock_benchmark import check
from merge_stock_attempts import merge
from summarize_rnp_stock import summarize


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    # Atomic progress replacement, confined to this new analysis attempt.
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    temporary.replace(path)


def readiness(batches):
    records = {}
    plan_bytes = None
    for batch in batches:
        raw = (batch / 'frozen-plan/plan.json').read_bytes()
        if plan_bytes is not None and raw != plan_bytes:
            raise ValueError('Different frozen plans')
        plan_bytes = raw
        progress = json.loads((batch / 'progress.json').read_bytes())
        if progress['planSha256'] != hashlib.sha256(raw).hexdigest():
            raise ValueError('Progress and frozen plan disagree')
        seen = set()
        jobs = json.loads(raw)['jobs']
        for row in progress['records']:
            index = row['index']
            if type(index) is not int or not 0 <= index < len(jobs) or any(row[k] != jobs[index][k] for k in ['caseId', 'model', 'seed']):
                raise ValueError('Prediction differs from frozen job identity')
            if row['status'] not in ['running', 'not-started', 'complete', 'failed']:
                raise ValueError('Unknown execution state')
            if index in seen or (index in records and records[index]['status'] == 'complete'):
                raise ValueError('Repeated completed prediction or overlapping attempt')
            seen.add(index)
            records[index] = row
    jobs = json.loads(plan_bytes)['jobs']
    complete = sum(row['status'] == 'complete' for row in records.values())
    terminal = sum(row['status'] in ['complete', 'failed'] for row in records.values())
    ready = set(records) == set(range(len(jobs))) and terminal == len(jobs)
    return {'ready': ready, 'planned': len(jobs), 'completed': complete, 'terminal': terminal,
            'latestBatchState': progress['status'], 'planSha256': hashlib.sha256(plan_bytes).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--batch', type=Path, action='append', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--wait-hours', type=float, default=0)
    parser.add_argument('--max-expanded-mib', type=int, default=1024)
    parser.add_argument('--max-members', type=int, default=12000)
    args = parser.parse_args()
    if not 0 <= args.wait_hours <= 48:
        raise ValueError('Wait must have a finite 0–48 hour bound')
    if len(args.batch) < 2:
        raise ValueError('Specify original and continuation attempts')
    args.output.mkdir(exist_ok=False)
    sources = {path.name: sha(path) for path in Path(__file__).parent.glob('*.py')}
    save(args.output / 'analysis-source-manifest.json', sources)
    started = datetime.now(timezone.utc).isoformat()
    deadline = time.monotonic() + args.wait_hours * 3600
    state = {'status': 'waiting', 'startedAt': started, 'newNeuralForwards': 0,
             'sourceAttempts': [str(path.resolve()) for path in args.batch], 'maximumWaitHours': args.wait_hours}
    try:
        while True:
            try:
                ready = readiness(args.batch)
            except json.JSONDecodeError:
                # Original progress writer can be observed between truncation and write.
                if time.monotonic() >= deadline:
                    raise
                time.sleep(2)
                continue
            state.update(ready)
            state['checkedAt'] = datetime.now(timezone.utc).isoformat()
            save(args.output / 'progress.json', state)
            if ready['ready']:
                break
            if ready['latestBatchState'] != 'running':
                raise RuntimeError('Latest batch stopped before all jobs were terminal; audited recovery needed, no restart attempted')
            if time.monotonic() >= deadline:
                raise TimeoutError('Finite wait deadline reached; existing science left untouched')
            time.sleep(min(60, max(0, deadline - time.monotonic())))
        if any(sha(Path(__file__).with_name(name)) != digest for name, digest in sources.items()):
            raise ValueError('Analysis source changed while waiting')
        state['status'] = 'analyzing'
        save(args.output / 'progress.json', state)
        stage = args.output / 'merged'
        merge(args.batch, stage)
        review = args.output / 'analysis'
        plan_file = stage / 'frozen-plan/plan.json'
        report = assemble(plan_file, stage / 'reference-evidence', None, stage, review)
        plan = json.loads(plan_file.read_bytes())
        summary = summarize(plan, report)
        if not summary['allSelected']['final']:
            raise ValueError('Final analysis unexpectedly contains unfinished jobs')
        score_sha = sha(review / 'scores.json')
        summary.update({'planSha256': report['planSha256'], 'scoresSha256': score_sha})
        save(review / 'similarity-summary.json', summary)
        sampling = analyze(plan, report)
        sampling.update({'planSha256': report['planSha256'], 'scoresSha256': score_sha,
                         'scriptSha256': sha(Path(__file__).with_name('analyze_rnp_sampling.py')),
                         'timing': timings(stage, plan, report)})
        save(review / 'selection-analysis.json', sampling)
        verified = check(review, args.max_expanded_mib * 1024**2, args.max_members)
        save(args.output / 'verification.json', verified)
        subprocess.run([sys.executable, str(Path(__file__).with_name('plot_rnp_sampling.py')),
                        '--analysis', str(review / 'selection-analysis.json'), '--output', str(review / 'sampling-plots')], check=True)
        subprocess.run([sys.executable, str(Path(__file__).with_name('plot_rnp_checkpoint.py')),
                        '--plan', str(plan_file), '--scores', str(review / 'scores.json'),
                        '--samples', str(len(plan['seeds'])), '--output', str(review / 'similarity-plots')], check=True)
        state.update({'status': 'complete', 'finishedAt': datetime.now(timezone.utc).isoformat(),
                      'verification': verified, 'publication': 'Not published; preserve and review this package before updating the draft PR.'})
        save(args.output / 'progress.json', state)
        return 0
    except Exception as exc:
        state.update({'status': 'needs-attention', 'error': f'{type(exc).__name__}: {exc}',
                      'finishedAt': datetime.now(timezone.utc).isoformat(), 'scienceRestarted': False})
        save(args.output / 'progress.json', state)
        raise


if __name__ == '__main__':
    raise SystemExit(main())
