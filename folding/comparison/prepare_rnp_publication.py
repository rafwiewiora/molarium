"""Prepare the final RnP report after the existing data-only finalizer succeeds.

No inference, scheduler, network, git or deployment operation is available here.
This is a separate reporting phase, not a replacement for the frozen finalizer.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time

from analyze_rnp_sampling import analyze
from diagnose_rnp_stock import diagnose, markdown
from export_stock_review import export
from summarize_rnp_stock import summarize


PLAN_SHA = '797454ec8d2766485a96cfb13326511f0333efa7b89bb656968f84b2844ad349'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    temporary.replace(path)


def require_final(plan, report):
    if (len(plan['pairs']) != 48 or len(plan['jobs']) != 480
            or plan['seeds'] != list(range(10)) or plan['steps'] != 200 or plan['recycles'] != 3):
        raise ValueError('Requires the full frozen 48-case, 480-prediction protocol')
    if any(not 0 <= pair['nativeBestA'] < 2 for pair in plan['pairs']):
        raise ValueError('Native-positive qualification changed')
    summary = summarize(plan, report)
    if report['status'] != 'complete' or not summary['allSelected']['final']:
        raise ValueError('Final publication rejects unfinished predictions')
    if report['planned'] != 480 or len(report['poses']) != 480:
        raise ValueError('Final planned denominator changed')
    complete = sum(row['status'] == 'complete' for row in report['poses'])
    failures = sum(row['status'] == 'failed' for row in report['poses'])
    if complete + failures != 480 or complete != report['completed']:
        raise ValueError('Terminal execution counts disagree')
    return summary


def rate(count, denominator, observed=True):
    return f'{count}/{denominator} ({100 * count / denominator:.2f}%)' if observed and denominator else 'unavailable'


def render_summary(plan, report, analysis, samples):
    """Render only a uniformly completed prefix; the publication CLI requires ten."""
    budget = analysis['allSelected'][samples - 1]
    if not budget['fullyProcessed']:
        raise ValueError('Cannot render an unfinished uniform sample budget')
    count = budget['observedCounts']
    lines = [f'# Recorded results at {samples} samples per case', '',
             f'{budget["completePredictions"]} completed predictions and {budget["executionFailures"]} failed executions '
             f'across {budget["plannedCases"]} planned cases. Failures remain in every planned denominator.', '',
             '| Selection | Cases |', '|---|---:|',
             '| Any geometric <2 Å pose, using the experimental answer | ' + rate(count['oracleGeometricHitCases'], budget['plannedCases']) + ' |',
             '| Any <2 Å pose passing limited stereo/clash checks | ' + rate(count['oracleLimitedValidityPassingHitCases'], budget['plannedCases']) + ' |',
             '| Highest reported ipTM, passing <2 Å pose | ' + rate(count['highestIptmLimitedValidityPassingHitCases'], budget['plannedCases'], budget['confidenceSelectionFullyObserved']) + ' |', '',
             'Any-hit selection is retrospective and uses the crystal answer. Confidence selection uses the highest '
             'archived ipTM and the lowest seed for ties, with no crystal or validity filtering before ranking. '
             'The upstream archive rounds ipTM to two decimals; ties do not recover unrounded confidence.', '',
             '| Uniform samples per case | Any geometric hit | Any passing hit | Confidence-selected passing hit |',
             '|---:|---:|---:|---:|']
    for n in [1, 3, 6, 10]:
        if n > samples:
            continue
        row = analysis['allSelected'][n - 1]
        counts = row['observedCounts']
        lines.append(f'| {n} | ' + rate(counts['oracleGeometricHitCases'], row['plannedCases'], row['fullyProcessed'])
                     + ' | ' + rate(counts['oracleLimitedValidityPassingHitCases'], row['plannedCases'], row['fullyProcessed'])
                     + ' | ' + rate(counts['highestIptmLimitedValidityPassingHitCases'], row['plannedCases'], row['confidenceSelectionFullyObserved']) + ' |')
    native = analysis['nativeLimitedValiditySubset'][samples - 1]
    lines += ['', f'{budget["plannedCases"] - count["oracleGeometricHitCases"]}/{budget["plannedCases"]} native-qualified cases '
              f'have no browser geometric <2 Å hit after {samples} planned samples.', '',
              'Among cases with a limited-diagnostic-passing native hit, any passing browser hit is '
              + rate(native['observedCounts']['oracleLimitedValidityPassingHitCases'], native['plannedCases'], native['fullyProcessed'])
              + f'. {budget["plannedCases"] - native["plannedCases"]} selected cases lack a native hit passing those limited checks.', '',
              f'{native["plannedCases"] - native["observedCounts"]["oracleLimitedValidityPassingHitCases"]}/{native["plannedCases"]} cases '
              'with a passing native hit have no passing browser hit at this sample budget.', '',
              '| Published training-similarity interval | Cases | Any passing hit | Confidence-selected passing hit |',
              '|---|---:|---:|---:|']
    for group, interval in zip(analysis['bySimilarityBin'], ['[0,25)', '[25,50)', '[50,75)', '[75,100]']):
        row = group['budgets'][samples - 1]
        counts = row['observedCounts']
        lines.append(f'| {interval} | {row["plannedCases"]} | '
                     + rate(counts['oracleLimitedValidityPassingHitCases'], row['plannedCases'], row['fullyProcessed'])
                     + ' | ' + rate(counts['highestIptmLimitedValidityPassingHitCases'], row['plannedCases'], row['confidenceSelectionFullyObserved']) + ' |')
    independence = analysis['independence']
    lines += ['', f'The {independence["cases"]} selected cases contain {independence["exactSequences"]} exact protein sequences '
              f'and {independence["publishedClusters"]} published clusters. Similarity is ligand SuCOS shape times '
              'pocket coverage to pre-June-2023 training examples, not sequence identity. The lowest-similarity '
              'bin has one case instead of the intended three; the shortfall is retained.', '',
              'This is a selected native-positive reconstruction cohort. Native predictions were reused and '
              'independently rescored; their historical cached ligand topology and RDKit version are unavailable. '
              'Deterministic declared-SMILES/name reconstruction is explicit. Native/browser preparation and '
              'sampling differ. These counts establish neither population accuracy nor numerical implementation parity. '
              'The stereo/clash diagnostics are limited checks, not full physical validation.', '',
              'Protocol: pristine LocalFold, raw declared SMILES, query plus up to 255 unique published MSA rows, '
              '200 diffusion steps, and three additional recycles/four trunk passes. Experimental references '
              'are used only for scoring/display in the frame of all observed corresponding Cα atoms; '
              'there is no pocket fit or independent ligand alignment.', '',
              '[All case-level outcomes and confidence ties](diagnostics-first10/README.md) · '
              '[All original poses for local human review](review-libraries/README.md) · '
              '[Original assembly notes and case table](assembly-README.md) · '
              '[Sampling and launcher-time plots](sampling-plots/manifest.json) · '
              '[Similarity plot](similarity-plots/manifest.json)', '',
              'Launcher timing includes browser startup, available asset loading, folding, confidence and '
              'archive checks. Concurrent analysis and system conditions affect it. It is not isolated GPU '
              'kernel timing, screening throughput, or a cross-device speed comparison.', '']
    return '\n'.join(lines)


def prepare(finalizer, output, repository):
    state = json.loads((finalizer / 'progress.json').read_bytes())
    if state['status'] != 'complete':
        raise ValueError('The existing independent finalizer is not complete')
    plan_path = finalizer / 'merged/frozen-plan/plan.json'
    if sha(plan_path) != PLAN_SHA:
        raise ValueError('Wrong frozen experiment')
    plan = json.loads(plan_path.read_bytes())
    source = finalizer / 'analysis'
    report = json.loads((source / 'scores.json').read_bytes())
    if report['planSha256'] != PLAN_SHA:
        raise ValueError('Score/plan identity changed')
    summary = require_final(plan, report)
    verification = json.loads((finalizer / 'verification.json').read_bytes())
    if (verification['status'] != 'pass' or verification['scope'] != 'complete'
            or verification['plannedPredictions'] != 480
            or verification['recomputedPredictions'] != report['completed']
            or verification['neuralForwards'] != 0
            or verification['actualGpuVendors'] != ['apple']
            or verification['observedDiffusionFrames'] != [200]):
        raise ValueError('Final raw-output verification does not qualify the full experiment')
    if state.get('verification') != verification:
        raise ValueError('Finalizer completion and verification record disagree')
    evidence = json.loads((source / 'evidence.json').read_bytes())
    if (evidence['scoresSha256'] != sha(source / 'scores.json')
            or evidence['scope'] != 'complete' or evidence['planned'] != 480):
        raise ValueError('Final evidence identity changed')
    analysis = json.loads((source / 'selection-analysis.json').read_bytes())
    expected = analyze(plan, report)
    for key, value in expected.items():
        if analysis.get(key) != value:
            raise ValueError('Final selection analysis changed: ' + key)
    if analysis['scoresSha256'] != sha(source / 'scores.json'):
        raise ValueError('Selection analysis uses different scores')
    output.mkdir()
    checkpoint = output / 'checkpoint-480'
    shutil.copytree(source, checkpoint)
    shutil.copyfile(checkpoint / 'README.md', checkpoint / 'assembly-README.md')
    score_sha = sha(checkpoint / 'scores.json')
    for samples in [3, 6, 10]:
        result = diagnose(plan, report, samples)
        result.update({'planSha256': PLAN_SHA, 'scoresSha256': score_sha,
                       'scriptSha256': sha(Path(__file__).with_name('diagnose_rnp_stock.py'))})
        folder = checkpoint / f'diagnostics-first{samples}'
        folder.mkdir()
        save(folder / 'diagnostics.json', result)
        (folder / 'README.md').write_text(markdown(result))
    cases = [pair['caseId'] for pair in plan['pairs']]
    attribution = repository / 'reviews/cofold-rnp-spectrum-2026-11-15/dataset-attribution.json'
    manifest = export(checkpoint, checkpoint / 'review-libraries', cases, 10, 1024, 12000, attribution)
    if manifest['caseIds'] != cases or len(manifest['libraries']) != 96:
        raise ValueError('Full review cohort coverage changed')
    # The historical exporter describes posthoc examples. This new report covers
    # every pre-inference selected case, so its README needs that precise scope.
    lines = ['# Review the entire frozen cohort', '',
             'All 48 cases selected before inference are included, with all ten planned samples. '
             'No cases were chosen or omitted after seeing the results. This is still a selected '
             'native-positive cohort, not a blinded or population accuracy study.', '',
             'Download a JSON, open the [Molarium Foldarium reviewer](https://molarium.org/vendor/foldarium/library-review.html), '
             'and choose **Import library JSON**. Preferences and notes remain local; use '
             '**Export library + decisions** to save them. Each case has a prediction-only file and '
             'a separate experimental-reference file. No correctness labels or preferred poses are embedded.', '',
             '| Case | Predictions only | Include experimental reference |', '|---|---|---|']
    lines += [f'| {case} | [JSON]({case}.predictions.library.json) | [JSON]({case}.with-reference.library.json) |' for case in cases]
    lines += ['', 'Original PDB strings and explicit ligand graphs are preserved. Alignment is display-only. '
              'Failed executions remain listed. Isolated inference time is unavailable; source launcher '
              'times remain provenance. Experimental references never enter inference.', '',
              '[Export manifest and source attribution](manifest.json) · '
              '[Whole-cohort selection certificate](cohort-selection.json)', '']
    (checkpoint / 'review-libraries/README.md').write_text('\n'.join(lines))
    save(checkpoint / 'review-libraries/cohort-selection.json', {
        'scope': 'Every case from the pre-inference frozen plan; no posthoc case selection.',
        'planSha256': PLAN_SHA, 'caseIds': cases, 'samplesPerCase': 10,
        'exportManifestSha256': sha(checkpoint / 'review-libraries/manifest.json'),
        'readmeSha256': sha(checkpoint / 'review-libraries/README.md'),
        'reportPreparerSha256': sha(Path(__file__))})
    command = ['node', str(repository / 'folding/comparison/check_stock_review.mjs'),
               '--review', str(checkpoint), '--exports', str(checkpoint / 'review-libraries'),
               '--plan', str(plan_path), '--repository', str(finalizer / 'merged/reference-evidence'),
               '--components', str(finalizer / 'merged/frozen-plan/components'), '--attribution', str(attribution)]
    alignment = json.loads(subprocess.check_output(command, text=True))
    if alignment['status'] != 'pass' or alignment['cases'] != 48 or alignment['uniquePredictions'] != report['completed']:
        raise ValueError('Full coordinate/graph/alignment review check failed')
    save(checkpoint / 'review-libraries/alignment-check.json', alignment)
    (checkpoint / 'README.md').write_text(render_summary(plan, report, analysis, 10))
    save(checkpoint / 'final-summary.json', {**summary, 'planSha256': PLAN_SHA, 'scoresSha256': score_sha})
    save(output / 'source-verification.json', verification)
    receipt = {'schema': 'molarium.rnp-publication-preparation.v1', 'status': 'prepared-for-review',
               'newNeuralForwards': 0, 'sourceFinalizerVerificationSha256': sha(finalizer / 'verification.json'),
               'sourceScoresSha256': score_sha, 'reportPreparerSha256': sha(Path(__file__)),
               'publicationActions': 0, 'reviewRequired': 'Inspect final tables, diagnostics, plots and browser workflow before PR readiness/merge.',
               'files': [{'path': str(p.relative_to(output)), 'bytes': p.stat().st_size, 'sha256': sha(p)}
                         for p in sorted(output.rglob('*')) if p.is_file()]}
    save(output / 'receipt.json', receipt)
    return receipt


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--finalizer', type=Path, required=True)
    p.add_argument('--finalizer-pid', type=int, required=True)
    p.add_argument('--repository', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--deadline', required=True, help='Finite UTC reporting deadline, ISO8601')
    a = p.parse_args()
    deadline = datetime.fromisoformat(a.deadline.replace('Z', '+00:00'))
    now = datetime.now(timezone.utc)
    if deadline.utcoffset() is None or not 0 < (deadline - now).total_seconds() <= 24 * 3600:
        raise ValueError('Reporting wait needs a future deadline within 24 hours')
    a.output.mkdir()
    source_pins = {q.name: sha(q) for q in Path(__file__).parent.glob('*.py')}
    save(a.output / 'source-pins.json', source_pins)
    verifier_names = ['folding/comparison/check_stock_review.mjs',
                      'vendor/foldarium/library-format.js',
                      'vendor/foldarium/library-alignment.js',
                      'vendor/foldarium/library-chemistry.js',
                      'reviews/cofold-rnp-spectrum-2026-11-15/dataset-attribution.json']
    verifier_pins = {name: sha(a.repository / name) for name in verifier_names}
    save(a.output / 'verifier-pins.json', verifier_pins)
    state = {'status': 'waiting', 'newNeuralForwards': 0, 'publicationActions': 0,
             'finalizerPid': a.finalizer_pid, 'deadline': deadline.isoformat()}
    try:
        while True:
            if datetime.now(timezone.utc) >= deadline:
                raise TimeoutError('Finite reporting deadline reached; science left untouched')
            progress = json.loads((a.finalizer / 'progress.json').read_bytes())
            state.update({'sourceState': progress['status'], 'checkedAt': datetime.now(timezone.utc).isoformat()})
            save(a.output / 'progress.json', state)
            if progress['status'] == 'complete':
                break
            if progress['status'] not in ['waiting', 'analyzing']:
                raise RuntimeError('Existing finalizer needs attention; no restart attempted')
            try:
                command = subprocess.check_output(['ps', '-p', str(a.finalizer_pid), '-o', 'command='], text=True)
            except subprocess.CalledProcessError:
                command = ''
            if 'finalize_rnp_stock.py' not in command or str(a.finalizer) not in command:
                if json.loads((a.finalizer / 'progress.json').read_bytes())['status'] == 'complete':
                    break
                raise RuntimeError('Expected finalizer process is not live; no restart attempted')
            time.sleep(30)
        if any(sha(Path(__file__).with_name(name)) != h for name, h in source_pins.items()):
            raise ValueError('Frozen reporting source changed')
        if any(sha(a.repository / name) != h for name, h in verifier_pins.items()):
            raise ValueError('Coordinate/graph verifier source changed while waiting')
        state['status'] = 'preparing'
        save(a.output / 'progress.json', state)
        receipt = prepare(a.finalizer, a.output / 'publication', a.repository)
        if (any(sha(Path(__file__).with_name(name)) != h for name, h in source_pins.items())
                or any(sha(a.repository / name) != h for name, h in verifier_pins.items())):
            raise ValueError('Reporting/verifier source changed during preparation')
        state.update({'status': 'prepared-for-review', 'finishedAt': datetime.now(timezone.utc).isoformat(),
                      'receiptSha256': sha(a.output / 'publication/receipt.json'),
                      'publicationActions': receipt['publicationActions']})
        save(a.output / 'progress.json', state)
    except Exception as exc:
        state.update({'status': 'needs-attention', 'error': f'{type(exc).__name__}: {exc}',
                      'scienceRestarted': False, 'finishedAt': datetime.now(timezone.utc).isoformat()})
        save(a.output / 'progress.json', state)
        raise


if __name__ == '__main__':
    main()
