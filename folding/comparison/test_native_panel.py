from pathlib import Path
import hashlib
import json
import unittest
from check_native_panel import evaluate


class NativePanelEvidenceTests(unittest.TestCase):
    def test_agreement_records_bind_the_exact_browser_and_native_libraries(self):
        root = Path(__file__).resolve().parents[2] / 'reviews/cofold-recent-pdb-2026-11-13'
        index = json.loads((root / 'native-single-agreement.json').read_bytes())
        panel = json.loads((root / 'panel.json').read_bytes())
        for method in index['methods']:
            self.assertEqual([c['caseId'] for c in method['cases']], [c['id'] for c in panel['cases']])
            for i, case in enumerate(method['cases'], 1):
                data = (root / case['file']).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), case['sha256'])
                report = json.loads(data)
                expected = {
                    'browser': root / f'browser-{method["method"]}-normalized/library-{i}.json',
                    'native': root / f'native-{method["method"]}-single-standard/library-{i}.json'}
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
        self.assertEqual(len(reports), 3)
        self.assertEqual(combined['poses'], sum([r['poses'] for r in reports], []))
        self.assertEqual(combined['summary'], sum([r['summary'] for r in reports], []))
        self.assertEqual(len(combined['poses']), 216)

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


if __name__ == '__main__':
    unittest.main()
