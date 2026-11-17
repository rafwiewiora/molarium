import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from analyze_rnp_sampling import analyze, distribution
from finalize_rnp_stock import readiness


class SamplingInterpretation(unittest.TestCase):
    def fixture(self):
        pairs = [{'caseId': x, 'model': 'boltz2', 'similarityBin': i,
                  'nativeHasStereoClashPassingHit': i == 0, 'sequenceSha256': x, 'cluster': 'shared'}
                 for i, x in enumerate(['one', 'two'])]
        jobs = [{'index': i * 2 + j, 'caseId': p['caseId'], 'model': 'boltz2', 'seed': i}
                for i in range(3) for j, p in enumerate(pairs)]
        rows = [{**j, 'status': 'complete', 'ligandRmsdA': 1., 'within2A': True,
                 'limitedValidityPass': True, 'confidence': {'iptm': .5}} for j in jobs]
        return {'pairs': pairs, 'jobs': jobs, 'seeds': [0, 1, 2]}, {'poses': rows}

    def test_ranking_cannot_discard_the_high_confidence_invalid_pose(self):
        plan, report = self.fixture()
        report['poses'][2].update(ligandRmsdA=4., within2A=False, limitedValidityPass=False, confidence={'iptm': .9})
        result = analyze(plan, report)
        last = result['allSelected'][-1]
        self.assertEqual(last['observedCounts']['oracleLimitedValidityPassingHitCases'], 2)
        self.assertEqual(last['observedCounts']['highestIptmLimitedValidityPassingHitCases'], 1)
        self.assertEqual(last['cases'][0]['highestIptmSeed'], 1)
        self.assertEqual(last['cases'][1]['highestIptmSeed'], 0)  # Tie uses seed, not crystal error.
        self.assertEqual(result['independence']['publishedClusters'], 1)

    def test_partial_failures_and_missing_confidence_keep_the_denominator(self):
        plan, report = self.fixture()
        for row in report['poses']:
            if row['caseId'] == 'two':
                row['status'] = 'failed'
        report['poses'][4]['status'] = 'running'
        result = analyze(plan, report)
        first, last = result['allSelected'][0], result['allSelected'][-1]
        self.assertEqual(first['rates']['oracleGeometricHitCases'], .5)
        self.assertEqual(first['executionFailures'], 1)
        self.assertTrue(all(value is None for value in last['rates'].values()))
        report['poses'][4]['status'] = 'complete'
        report['poses'][2]['confidence'] = {'iptm': float('nan')}
        last = analyze(plan, report)['allSelected'][-1]
        self.assertEqual(last['rates']['oracleGeometricHitCases'], .5)
        self.assertIsNone(last['rates']['highestIptmGeometricHitCases'])
        self.assertEqual(last['missingConfidencePredictions'], 1)
        self.assertEqual(last['executionFailures'], 3)

    def test_duplicate_seeds_and_undeclared_cases_are_rejected(self):
        plan, report = self.fixture()
        plan['jobs'][2]['seed'] = report['poses'][2]['seed'] = 0
        with self.assertRaisesRegex(ValueError, 'exact planned seeds'):
            analyze(plan, report)
        plan, report = self.fixture()
        plan['pairs'].append(copy.deepcopy(plan['pairs'][0]))
        with self.assertRaisesRegex(ValueError, 'repeated case'):
            analyze(plan, report)

    def test_timing_distribution_handles_a_single_receipt_and_interpolates(self):
        self.assertEqual(distribution([]), {'count': 0})
        self.assertEqual(distribution([10])['median'], 10)
        value = distribution([40, 10, 20, 30])
        self.assertEqual(value['p25'], 17.5)
        self.assertEqual(value['p75'], 32.5)

    def test_final_analysis_waits_for_every_job_without_replacing_a_completed_one(self):
        plan, report = self.fixture()
        raw = json.dumps(plan).encode()
        with tempfile.TemporaryDirectory() as directory:
            batches = [Path(directory) / name for name in ['original', 'continuation']]
            for batch, rows in zip(batches, [report['poses'][:2], report['poses'][2:]]):
                (batch / 'frozen-plan').mkdir(parents=True)
                (batch / 'frozen-plan/plan.json').write_bytes(raw)
                (batch / 'progress.json').write_text(json.dumps({'planSha256': hashlib.sha256(raw).hexdigest(),
                    'status': 'running', 'records': rows}))
            self.assertTrue(readiness(batches)['ready'])
            value = json.loads((batches[1] / 'progress.json').read_text())
            value['records'][-1]['status'] = 'running'
            (batches[1] / 'progress.json').write_text(json.dumps(value))
            self.assertFalse(readiness(batches)['ready'])
            value['records'].append(report['poses'][0])
            (batches[1] / 'progress.json').write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError, 'Repeated completed prediction'):
                readiness(batches)


if __name__ == '__main__':
    unittest.main()
