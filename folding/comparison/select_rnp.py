"""Select the frozen, native-qualified similarity cohort without stock outcomes."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path


def select(pool, qualification):
    by_id = {s['caseId']: s for s in qualification['summary']}
    if len(by_id) != len(pool['candidates']):
        raise ValueError('Incomplete or repeated native qualifications')
    policy = pool['policy']
    selected, exclusions = [], []
    bins, sequences, clusters = Counter(), Counter(), Counter()
    for case in sorted(pool['candidates'], key=lambda c: (c['similarityBin'], c['candidateOrderSha256'])):
        q = by_id.get(case['caseId'])
        if not q or q['systemId'] != case['systemId']:
            raise ValueError('Qualification/candidate identity mismatch')
        reason = None
        if q['status'] != 'qualified':
            reason = q.get('error', 'No independently rescored same-model native pose strictly below 2 A')
        elif bins[case['similarityBin']] >= policy['targetByBin'][case['similarityBin']]:
            reason = 'Predeclared bin quota already filled'
        elif sequences[case['sequenceSha256']] >= 2:
            reason = 'Predeclared maximum two cases per exact sequence'
        elif clusters[case['cluster']] >= 3:
            reason = 'Predeclared maximum three cases per RnP cluster'
        if reason:
            exclusions.append({'caseId': case['caseId'], 'reason': reason})
            continue
        if not q['nativeBestA'] < 2:
            raise ValueError('Qualified case lacks its independent strict native hit')
        selected.append({**case, 'nativeQualification': q})
        bins[case['similarityBin']] += 1
        sequences[case['sequenceSha256']] += 1
        clusters[case['cluster']] += 1
    return selected, exclusions, [max(0, n - bins[b]) for b, n in enumerate(policy['targetByBin'])]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--pool', type=Path, required=True)
    p.add_argument('--qualification', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    pool_bytes, score_bytes = a.pool.read_bytes(), a.qualification.read_bytes()
    pool, score = json.loads(pool_bytes), json.loads(score_bytes)
    if score['poolSha256'] != hashlib.sha256(pool_bytes).hexdigest():
        raise ValueError('Qualification comes from another pool')
    selected, excluded, shortfall = select(pool, score)
    value = {'schema': 'molarium.rnp-spectrum-selection.v1', 'status': 'selected-awaiting-published-alignments',
             'poolSha256': hashlib.sha256(pool_bytes).hexdigest(), 'qualificationSha256': hashlib.sha256(score_bytes).hexdigest(),
             'selectorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
             'policy': pool['policy'], 'selected': selected, 'exclusions': excluded, 'shortfallByBin': shortfall,
             'selectedByBin': [sum(c['similarityBin'] == b for c in selected) for b in range(4)],
             'uniqueSequences': len({c['sequenceSha256'] for c in selected}), 'uniqueClusters': len({c['cluster'] for c in selected}),
             'nativeOnly': True, 'newStockPredictions': 0, 'nativeTopologyLimitation': score['nativeNamingSource']['limitation']}
    with a.output.open('x') as f:
        json.dump(value, f, indent=2, allow_nan=False)
        f.write('\n')
    print(json.dumps({k: value[k] for k in ['selectedByBin', 'shortfallByBin', 'uniqueSequences', 'uniqueClusters']}))


if __name__ == '__main__':
    main()
