"""Separate sampling, validity and reported-confidence ties in a completed seed prefix.

This is descriptive analysis of independently checked output, not a causal test
of preparation, precision or inference kernels. It never runs a neural model.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import statistics

from analyze_rnp_sampling import analyze


def diagnose(plan, report, samples):
    selection = analyze(plan, report)
    if not 1 <= samples <= len(selection['allSelected']):
        raise ValueError('Sample prefix outside the frozen plan')
    budget = selection['allSelected'][samples - 1]
    if not budget['fullyProcessed']:
        raise ValueError('Every case in the seed prefix must be terminal')
    cases = []
    for pair, case in zip(plan['pairs'], budget['cases']):
        rows = [r for r in report['poses'] if (r['caseId'], r['model']) == (pair['caseId'], pair['model']) and r['seed'] < samples]
        complete = [r for r in rows if r['status'] == 'complete']
        hit = lambda r: r['within2A'] and r['limitedValidityPass']
        selected = next((r for r in complete if r['seed'] == case['highestIptmSeed']), None)
        top = [r for r in complete if r.get('confidence', {}).get('iptm') == case['highestIptm']] if selected else []
        confidence_complete = not case['missingConfidenceSeeds']
        if not complete:
            category = 'all-executions-failed'
        elif not case['oracleGeometricHit']:
            category = 'no-geometric-hit'
        elif not case['oracleLimitedValidityPassingHit']:
            category = 'geometric-hits-fail-limited-diagnostics'
        elif not confidence_complete:
            category = 'confidence-unavailable'
        elif case['selectedLimitedValidityPassingHit']:
            category = 'selected-passing-hit'
        else:
            category = 'passing-hit-not-selected'
        ranking_detail = None
        if category == 'passing-hit-not-selected':
            ranking_detail = 'passing-hit-tied-at-highest-reported-iptm' if any(map(hit, top)) else 'passing-hits-have-strictly-lower-reported-iptm'
        cases.append({
            'caseId': pair['caseId'], 'model': pair['model'], 'similarity': pair['similarity'],
            'similarityBin': pair['similarityBin'], 'cluster': pair['cluster'],
            'sequenceSha256': pair['sequenceSha256'], 'nativeBestA': pair['nativeBestA'],
            'nativeHasStereoClashPassingHit': pair['nativeHasStereoClashPassingHit'],
            'category': category, 'rankingDetail': ranking_detail,
            'completePredictions': len(complete), 'executionFailures': case['executionFailures'],
            'geometricHitSeeds': [r['seed'] for r in complete if r['within2A']],
            'passingHitSeeds': [r['seed'] for r in complete if hit(r)],
            'bestLigandRmsdA': min(r['ligandRmsdA'] for r in complete) if complete else None,
            'highestReportedIptm': case['highestIptm'],
            'highestReportedIptmSeeds': [r['seed'] for r in top],
            'passingSeedsAtHighestReportedIptm': [r['seed'] for r in top if hit(r)],
            'confidenceComplete': confidence_complete,
            'lowestSeedTieChoice': None if selected is None else {
                'seed': selected['seed'], 'ligandRmsdA': selected['ligandRmsdA'],
                'proteinCaRmsdA': selected['proteinCaRmsdA'],
                'stereochemicalIdentityMatches': selected['stereochemistry']['stereochemicalIdentityMatches'],
                'severeHeavyAtomPairsUnder1_2A': selected['predictedGeometry']['severeHeavyAtomPairsUnder1_2A'],
                'limitedValidityPass': selected['limitedValidityPass'], 'passingHit': hit(selected),
            },
            'geometricHitDiagnostics': [{
                'seed': r['seed'], 'ligandRmsdA': r['ligandRmsdA'],
                'stereochemicalIdentityMatches': r['stereochemistry']['stereochemicalIdentityMatches'],
                'severeHeavyAtomPairsUnder1_2A': r['predictedGeometry']['severeHeavyAtomPairsUnder1_2A'],
            } for r in complete if r['within2A']],
        })
    selected = [c['lowestSeedTieChoice'] for c in cases if c['lowestSeedTieChoice'] is not None]
    all_confidence = all(c['confidenceComplete'] for c in cases)
    # These are crystal-informed bounds over reported-score ties, not another
    # prospective selection policy or estimates of the unavailable raw scores.
    lower = sum(bool(c['highestReportedIptmSeeds']) and len(c['passingSeedsAtHighestReportedIptm']) == len(c['highestReportedIptmSeeds']) for c in cases)
    upper = sum(bool(c['passingSeedsAtHighestReportedIptm']) for c in cases)
    return {
        'schema': 'molarium.rnp-prefix-diagnostics.v1', 'samplesPerCase': samples,
        'upstreamRevision': plan['sourceRevision'],
        'plannedCases': len(cases), 'completePredictions': budget['completePredictions'],
        'executionFailures': budget['executionFailures'],
        'caseCategories': dict(Counter(c['category'] for c in cases)),
        'rankingMissDetails': dict(Counter(c['rankingDetail'] for c in cases if c['rankingDetail'])),
        'highestReportedIptmTieCases': sum(len(c['highestReportedIptmSeeds']) > 1 for c in cases),
        'tiesMixingPassingHitsAndOtherPoses': sum(bool(c['passingSeedsAtHighestReportedIptm']) and len(c['passingSeedsAtHighestReportedIptm']) < len(c['highestReportedIptmSeeds']) for c in cases),
        'tieInformedPassingHitBounds': {'lowerCases': lower if all_confidence else None,
                                      'upperCases': upper if all_confidence else None,
                                      'meaning': 'Minimum and maximum possible passing-hit counts among the highest reported-score ties; crystal-informed bounds, not prospective selection.'},
        'selectedPoseDiagnostics': {
            'stereochemicalIdentityFailures': sum(not r['stereochemicalIdentityMatches'] for r in selected),
            'withSevereClashes': sum(r['severeHeavyAtomPairsUnder1_2A'] > 0 for r in selected),
            'proteinCaRmsdMedianA': statistics.median(r['proteinCaRmsdA'] for r in selected) if selected else None,
            'proteinCaWithin2AAndLigandAtLeast2A': sum(r['proteinCaRmsdA'] < 2 <= r['ligandRmsdA'] for r in selected),
        },
        'cases': cases,
        'definitions': {
            'confidence': 'Archived reported ipTM, with lowest seed breaking ties, without crystal or diagnostic filtering. The pinned upstream archive writer rounds summary confidence to two decimals; this does not reconstruct unrounded model confidence.',
            'diagnostics': 'Existing limited stereochemical-identity and severe protein–ligand clash checks. Categories describe observations; they do not establish the cause of a miss.',
            'backbone': 'All observed corresponding C-alpha atoms in the existing scoring frame. A small global C-alpha RMSD does not certify the binding pocket or local geometry.',
            'failures': 'All planned cases remain in the denominator, including failed executions. Unfinished prefixes are rejected.',
            'scope': 'Selected native-positive reconstruction cohort with related cases, unmatched native/browser preparation and sampling, and reconstructed native ligand topology. Not implementation parity or general predictive accuracy.',
        },
    }


def markdown(result):
    lines = [f'# Diagnostic breakdown after {result["samplesPerCase"]} samples per case', '',
             f'{result["completePredictions"]} completed predictions across {result["plannedCases"]} cases; '
             f'{result["executionFailures"]} execution failures remain in the denominator.', '',
             '| Observation | Cases |', '| --- | ---: |']
    for category, count in result['caseCategories'].items():
        lines.append(f'| {category.replace("-", " ")} | {count} |')
    bounds = result['tieInformedPassingHitBounds']
    lines += ['', f'{result["highestReportedIptmTieCases"]} cases have multiple seeds tied for highest archived ipTM. '
              f'{result["tiesMixingPassingHitsAndOtherPoses"]} of those ties mix passing hits and other poses. '
              f'The crystal-informed passing-hit bounds across these ties are {bounds["lowerCases"]}–{bounds["upperCases"]} cases. '
              'These bounds do not recover unrounded confidence or define a prospective selection rule.', '',
              'The pinned upstream archive writer applies `round2` to summary ipTM '
              f'([source](https://github.com/sokrypton/localfold/blob/{result["upstreamRevision"]}/web/fold-archive.js)). '
              'Strictly lower reported confidence and a reported-score tie are distinguished below.', '',
              '| Case | Observation | Passing seeds | Highest-ipTM seeds | Selected seed | Ligand RMSD Å | Protein Cα RMSD Å |',
              '| --- | --- | --- | --- | ---: | ---: | ---: |']
    for case in result['cases']:
        chosen = case['lowestSeedTieChoice']
        show = lambda values: ', '.join(map(str, values)) if values else '—'
        description = case['rankingDetail'] or case['category']
        if chosen:
            lines.append(f'| {case["caseId"]} | {description.replace("-", " ")} | {show(case["passingHitSeeds"])} | '
                         f'{show(case["highestReportedIptmSeeds"])} | {chosen["seed"]} | '
                         f'{chosen["ligandRmsdA"]:.3f} | {chosen["proteinCaRmsdA"]:.3f} |')
        else:
            lines.append(f'| {case["caseId"]} | {description.replace("-", " ")} | — | — | — | — | — |')
    lines += ['', 'Categories describe the completed outputs. They do not identify a causal preparation, quantization or kernel defect. '
              'Limited diagnostics are not full physical validation, and a low global protein RMSD does not certify the pocket. '
              'All details and source hashes are in [diagnostics.json](diagnostics.json).', '']
    return '\n'.join(lines)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--scores', type=Path, required=True)
    parser.add_argument('--samples', type=int, default=3)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    raw = args.plan.read_bytes()
    report_bytes = args.scores.read_bytes()
    report = json.loads(report_bytes)
    if hashlib.sha256(raw).hexdigest() != report['planSha256']:
        raise ValueError('Frozen plan identity differs')
    result = diagnose(json.loads(raw), report, args.samples)
    result.update({'planSha256': report['planSha256'], 'scoresSha256': hashlib.sha256(report_bytes).hexdigest(),
                   'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()})
    args.output.mkdir(exist_ok=False)
    (args.output / 'diagnostics.json').write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    (args.output / 'README.md').write_text(markdown(result))
    print(json.dumps({k: result[k] for k in ['plannedCases', 'samplesPerCase', 'caseCategories', 'rankingMissDetails', 'tieInformedPassingHitBounds']}))
