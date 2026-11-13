from pathlib import Path
import hashlib
import json
import unittest
from check_native_panel import evaluate


class NativePanelEvidenceTests(unittest.TestCase):
    def test_agreement_records_bind_the_exact_browser_and_native_libraries(self):
        reviews = Path(__file__).resolve().parents[2] / 'reviews'
        for directory, filename in [('cofold-recent-pdb-2026-11-13', 'native-single-agreement.json'),
                                    ('cofold-recent-pdb-2026-11-13', 'native-msa-agreement.json'),
                                    ('cofold-crystal-reference-2026-11-13', 'native-boltz-agreement.json')]:
            root = reviews / directory
            index = json.loads((root / filename).read_bytes())
            panel = json.loads((root / 'panel.json').read_bytes())
            for method in index['methods']:
                self.assertEqual([c['caseId'] for c in method['cases']], [c['id'] for c in panel['cases']])
                for i, case in enumerate(method['cases'], 1):
                    data = (root / case['file']).read_bytes()
                    self.assertEqual(hashlib.sha256(data).hexdigest(), case['sha256'])
                    report = json.loads(data)
                    browser = method.get('browserPhase', f'browser-{method["method"]}-normalized')
                    native = method.get('nativePhase', f'native-{method["method"]}-single-standard')
                    expected = {'browser': root / browser / f'library-{i}.json',
                                'native': root / native / f'library-{i}.json'}
                    for source in report['sources']:
                        self.assertEqual(source['sha256'], hashlib.sha256(expected[source['label']].read_bytes()).hexdigest())
                    self.assertEqual(report['comparisons'][0]['cases'][0]['compoundId'], case['caseId'])

    def test_combined_scores_retain_every_original_browser_and_native_record(self):
        root = Path(__file__).resolve().parents[2] / 'reviews/cofold-recent-pdb-2026-11-13'
        combined = json.loads((root / 'all-protocol-scores.json').read_bytes())
        reports = []
        for descriptor in combined['sourceReports']:
            data = (root / descriptor['file']).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), descriptor['sha256'])
            reports.append(json.loads(data))
        self.assertEqual(len(reports), 4)
        self.assertEqual(combined['poses'], sum([r['poses'] for r in reports], []))
        self.assertEqual(combined['summary'], sum([r['summary'] for r in reports], []))
        self.assertEqual(len(combined['poses']), 243)

    def test_recent_native_coordinates_topology_and_all_scores_from_public_archives(self):
        root = Path(__file__).resolve().parents[2] / 'reviews/cofold-recent-pdb-2026-11-13'
        for method, geometric in [('openbind0', 0), ('boltz2', 3)]:
            with self.subTest(method=method):
                result = evaluate(root / 'panel.json', root / f'native-{method}-single-standard')
                self.assertEqual(result['poses'], 27)
                self.assertEqual(result['geometricPasses'], geometric)
                self.assertEqual(result['limitedValidityPasses'], 0)

    def test_old_crystal_openbind_control_reproduces_all_nine_raw_outputs(self):
        root = Path(__file__).resolve().parents[2] / 'reviews/cofold-crystal-reference-2026-11-13'
        result = evaluate(root / 'panel.json', root / 'native-openbind0-single-standard')
        self.assertEqual(result['poses'], 9)
        self.assertEqual(result['geometricPasses'], 0)

    def test_recent_msa_cohort_reconstructs_interrupted_and_completed_attempts(self):
        root = Path(__file__).resolve().parents[2] / 'reviews/cofold-recent-pdb-2026-11-13'
        result = evaluate(root / 'panel.json', root / 'native-openbind0-msa256-standard')
        self.assertEqual(result['poses'], 27)
        self.assertEqual(result['geometricPasses'], 8)
        self.assertEqual(result['limitedValidityPasses'], 7)

    def test_old_crystal_boltz_control_reproduces_missing_only_fk5_and_saved_poses(self):
        root = Path(__file__).resolve().parents[2] / 'reviews/cofold-crystal-reference-2026-11-13'
        result = evaluate(root / 'panel.json', root / 'native-boltz2-single-standard')
        self.assertEqual(result['poses'], 9)
        self.assertEqual(result['geometricPasses'], 9)
        self.assertEqual(result['limitedValidityPasses'], 9)


if __name__ == '__main__':
    unittest.main()
