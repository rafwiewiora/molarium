"""Compare fixed sample budgets and confidence selection without crystal-informed ranking.

This consumes already independently checked scores; it never runs inference.
Rates remain absent until a whole group has a uniform, terminal sample budget.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import statistics

from summarize_rnp_stock import summarize


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def analyze(plan, report):
    summarize(plan, report)  # Identity, score and strict-threshold checks.
    pairs = plan['pairs']
    identities = [(p['caseId'], p['model']) for p in pairs]
    if not identities or len(set(identities)) != len(identities):
        raise ValueError('Empty or repeated case/model pair')
    seeds = plan['seeds']
    if seeds != list(range(len(seeds))) or not seeds:
        raise ValueError('Expected the predeclared contiguous seed budget starting at zero')
    grouped = {identity: [] for identity in identities}
    indices = set()
    if [job['index'] for job in plan['jobs']] != list(range(len(plan['jobs']))):
        raise ValueError('Prediction indices must follow the frozen job order')
    for row in report['poses']:
        identity = (row['caseId'], row['model'])
        if identity not in grouped or row['index'] in indices:
            raise ValueError('Unknown case or repeated prediction index')
        indices.add(row['index'])
        grouped[identity].append(row)
    for rows in grouped.values():
        if sorted(r['seed'] for r in rows) != seeds:
            raise ValueError('Every case must retain its exact planned seeds')

    def group(selected):
        by_budget = []
        for budget in range(1, len(seeds) + 1):
            case_rows = []
            for pair in selected:
                rows = [r for r in grouped[pair['caseId'], pair['model']] if r['seed'] < budget]
                done = [r for r in rows if r['status'] == 'complete']
                terminal = all(r['status'] in ['complete', 'failed'] for r in rows)
                confidence = []
                missing_confidence = []
                for row in done:
                    value = row.get('confidence', {}).get('iptm')
                    if type(value) not in [int, float] or not math.isfinite(value) or not 0 <= value <= 1:
                        missing_confidence.append(row['seed'])
                    else:
                        confidence.append(row)
                # Do not filter on RMSD, stereochemistry or clashes before ranking.
                ranked = max(confidence, key=lambda r: (r['confidence']['iptm'], -r['seed'])) if confidence else None
                case_rows.append({
                    'caseId': pair['caseId'], 'model': pair['model'],
                    'terminal': terminal, 'completed': len(done),
                    'executionFailures': sum(r['status'] == 'failed' for r in rows),
                    'missingConfidenceSeeds': missing_confidence,
                    'oracleGeometricHit': any(r['within2A'] for r in done),
                    'oracleLimitedValidityPassingHit': any(r['within2A'] and r['limitedValidityPass'] for r in done),
                    'highestIptmSeed': ranked['seed'] if ranked else None,
                    'highestIptm': ranked['confidence']['iptm'] if ranked else None,
                    'selectedLigandRmsdA': ranked['ligandRmsdA'] if ranked else None,
                    'selectedLimitedValidityPass': ranked['limitedValidityPass'] if ranked else None,
                    'selectedGeometricHit': bool(ranked and ranked['within2A']),
                    'selectedLimitedValidityPassingHit': bool(ranked and ranked['within2A'] and ranked['limitedValidityPass']),
                })
            final = bool(selected) and all(r['terminal'] for r in case_rows)
            confidence_final = final and not any(r['missingConfidenceSeeds'] for r in case_rows)
            counts = {
                'oracleGeometricHitCases': sum(r['oracleGeometricHit'] for r in case_rows),
                'oracleLimitedValidityPassingHitCases': sum(r['oracleLimitedValidityPassingHit'] for r in case_rows),
                'highestIptmGeometricHitCases': sum(r['selectedGeometricHit'] for r in case_rows),
                'highestIptmLimitedValidityPassingHitCases': sum(r['selectedLimitedValidityPassingHit'] for r in case_rows),
            }
            by_budget.append({
                'samplesPerCase': budget, 'seeds': seeds[:budget],
                'plannedCases': len(selected), 'terminalCases': sum(r['terminal'] for r in case_rows),
                'completePredictions': sum(r['completed'] for r in case_rows),
                'executionFailures': sum(r['executionFailures'] for r in case_rows),
                'missingConfidencePredictions': sum(len(r['missingConfidenceSeeds']) for r in case_rows),
                'fullyProcessed': final, 'confidenceSelectionFullyObserved': confidence_final,
                'observedCounts': counts,
                'rates': {key: value / len(selected) if (confidence_final if key.startswith('highestIptm') else final) else None
                          for key, value in counts.items()},
                'cases': case_rows,
            })
        return by_budget

    return {
        'schema': 'molarium.rnp-sampling-analysis.v1',
        'allSelected': group(pairs),
        'nativeLimitedValiditySubset': group([p for p in pairs if p['nativeHasStereoClashPassingHit']]),
        'bySimilarityBin': [{'bin': i, 'budgets': group([p for p in pairs if p['similarityBin'] == i])} for i in range(4)],
        'independence': {'cases': len(pairs), 'exactSequences': len({p['sequenceSha256'] for p in pairs}),
                         'publishedClusters': len({p['cluster'] for p in pairs})},
        'definitions': {
            'confidenceSelection': 'Largest reported ipTM; lowest seed breaks ties. No crystal, validity or clash filtering before ranking. Missing or nonfinite confidence suppresses confidence-based rates for that budget.',
            'oracle': 'Any hit within the fixed seed prefix uses the experimental answer and is a retrospective best-of-N statistic.',
            'failures': 'Execution failures remain in the planned denominator. A case with all executions failed is a miss for both selections.',
            'partial': 'Observed counts may increase. Rates are emitted only once every planned prediction in the group and seed prefix is terminal.',
            'scope': 'Native-positive reconstruction cohort; related sequences and clusters remain present. Descriptive counts, not population accuracy or implementation parity.',
            'validity': 'Limited stereochemical-identity and severe protein–ligand clash diagnostics, not full physical validation.',
        },
    }


def distribution(values):
    values = sorted(values)
    if not values:
        return {'count': 0}
    def quantile(fraction):
        position = (len(values) - 1) * fraction
        lower = int(position)
        return values[lower] + (values[min(lower + 1, len(values) - 1)] - values[lower]) * (position - lower)
    return {'count': len(values), 'minimum': values[0], 'p25': quantile(.25),
            'median': statistics.median(values), 'p75': quantile(.75), 'maximum': values[-1], 'sum': sum(values)}


def timings(batch, plan, report, archived=False):
    """Read hash-bound launcher wall times, not kernel-only inference timings."""
    if archived:
        directories = {r['index']: f'predictions/{r["index"]:03d}' for r in report['poses']}
    else:
        progress = json.loads((batch / 'progress.json').read_bytes())
        directories = {r['index']: r['directory'] for r in progress['records']}
    rows = []
    for row in report['poses']:
        if row['status'] != 'complete':
            continue
        relative = Path(directories[row['index']])
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Timing directory escapes the supplied batch')
        path = batch / relative / 'receipt.json'
        if sha(path) != row['receiptSha256']:
            raise ValueError('Timing receipt differs from independently scored receipt')
        receipt = json.loads(path.read_bytes())
        elapsed = receipt['elapsedSeconds']
        if type(elapsed) not in [int, float] or not math.isfinite(elapsed) or elapsed <= 0:
            raise ValueError('Invalid recorded launcher duration')
        job = plan['jobs'][row['index']]
        input_path = Path(job['input'])
        if input_path.is_absolute() or '..' in input_path.parts:
            raise ValueError('Timing input escapes the frozen plan')
        input_file = batch / 'frozen-plan' / input_path
        if sha(input_file) != job['inputSha256']:
            raise ValueError('Timing input differs from frozen input')
        sequence = json.loads(input_file.read_bytes())['sequences'][0]['protein']['sequence']
        rows.append({k: row[k] for k in ['index', 'caseId', 'model', 'seed']} | {
            'proteinResidues': len(sequence), 'launcherElapsedSeconds': elapsed,
            'receiptSha256': row['receiptSha256'], 'inputSha256': job['inputSha256'],
            'startedAt': receipt['startedAt'], 'finishedAt': receipt['finishedAt'],
        })
    return {'schema': 'molarium.rnp-launcher-timing.v1', 'predictions': rows,
            'launcherSeconds': distribution([r['launcherElapsedSeconds'] for r in rows]),
            'byProteinLength': [{'interval': f'[{lower},{upper})',
                                 'launcherSeconds': distribution([r['launcherElapsedSeconds'] for r in rows if lower <= r['proteinResidues'] < upper])}
                                for lower, upper in [(60, 200), (200, 400), (400, 701)]],
            'definition': 'Recorded launcher wall time includes page/browser startup, available asset loading, folding, confidence calculation and archive checks. It excludes subsequent independent scoring and does not isolate GPU kernel time. Fresh browser profiles, caches and system conditions affect it; this single-device run is not a cross-hardware speed comparison.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--scores', type=Path, required=True)
    parser.add_argument('--batch', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    raw = args.plan.read_bytes()
    report = json.loads(args.scores.read_bytes())
    if hashlib.sha256(raw).hexdigest() != report['planSha256']:
        raise ValueError('Frozen plan identity mismatch')
    plan = json.loads(raw)
    result = analyze(plan, report)
    result.update({'planSha256': report['planSha256'], 'scoresSha256': sha(args.scores),
                   'scriptSha256': sha(Path(__file__))})
    if args.batch:
        result['timing'] = timings(args.batch, plan, report)
    with args.output.open('x') as output:
        json.dump(result, output, indent=2, allow_nan=False)
        output.write('\n')
    print(json.dumps({'output': str(args.output), 'fullyProcessedSampleBudgets': [r['samplesPerCase'] for r in result['allSelected'] if r['fullyProcessed']]}))
