import unittest

from diagnose_rnp_stock import diagnose


class DiagnosticInterpretation(unittest.TestCase):
    def fixture(self):
        pairs = [{'caseId': str(i), 'model': 'boltz2', 'similarityBin': i % 4,
                  'similarity': i * 10, 'sequenceSha256': str(i), 'cluster': str(i),
                  'nativeHasStereoClashPassingHit': True, 'nativeBestA': 1.} for i in range(4)]
        jobs = [{'index': i * 4 + j, 'caseId': p['caseId'], 'model': 'boltz2', 'seed': i}
                for i in range(2) for j, p in enumerate(pairs)]
        rows = [{**j, 'status': 'complete', 'ligandRmsdA': 1., 'within2A': True,
                 'limitedValidityPass': True, 'proteinCaRmsdA': .5, 'confidence': {'iptm': .9},
                 'stereochemistry': {'stereochemicalIdentityMatches': True},
                 'predictedGeometry': {'severeHeavyAtomPairsUnder1_2A': 0}} for j in jobs]
        return {'pairs': pairs, 'jobs': jobs, 'seeds': [0, 1], 'sourceRevision': 'synthetic-unit-fixture'}, {'poses': rows}

    def test_ties_are_not_misreported_as_strict_confidence_errors(self):
        plan, report = self.fixture()
        # One passing case, one reported-score tie that loses under the fixed
        # tie rule, one strictly worse-scoring hit, and one geometric-only case.
        report['poses'][1]['limitedValidityPass'] = False
        report['poses'][1]['stereochemistry']['stereochemicalIdentityMatches'] = False
        report['poses'][2].update(ligandRmsdA=4., within2A=False, confidence={'iptm': .95})
        for i in [3, 7]:
            report['poses'][i]['limitedValidityPass'] = False
            report['poses'][i]['stereochemistry']['stereochemicalIdentityMatches'] = False
        result = diagnose(plan, report, 2)
        self.assertEqual(result['caseCategories'], {'selected-passing-hit': 1, 'passing-hit-not-selected': 2,
                                                   'geometric-hits-fail-limited-diagnostics': 1})
        self.assertEqual(result['rankingMissDetails'], {'passing-hit-tied-at-highest-reported-iptm': 1,
                                                       'passing-hits-have-strictly-lower-reported-iptm': 1})
        self.assertEqual(result['tieInformedPassingHitBounds']['lowerCases'], 1)
        self.assertEqual(result['tieInformedPassingHitBounds']['upperCases'], 2)

    def test_unfinished_prefix_rejected_and_failures_remain_in_counts(self):
        plan, report = self.fixture()
        report['poses'][7]['status'] = 'running'
        with self.assertRaisesRegex(ValueError, 'must be terminal'):
            diagnose(plan, report, 2)
        report['poses'][7]['status'] = report['poses'][3]['status'] = 'failed'
        result = diagnose(plan, report, 2)
        self.assertEqual(result['plannedCases'], 4)
        self.assertEqual(result['executionFailures'], 2)
        self.assertEqual(result['caseCategories']['all-executions-failed'], 1)
        self.assertEqual(result['tieInformedPassingHitBounds']['lowerCases'], 3)


if __name__ == '__main__':
    unittest.main()
