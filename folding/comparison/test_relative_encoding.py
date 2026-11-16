from pathlib import Path
import copy
import json
import tempfile
import unittest
import numpy as np
from check_relative_encoding import check, compare
from check_trained_target import unpack_evidence
from feature_snapshot import load_snapshot


ROOT = Path(__file__).resolve().parents[2] / 'reviews/cofold-feature-parity-2026-11-13'


class RelativeEncodingTests(unittest.TestCase):
    def test_both_saved_native_systems_reproduce_exact_report_with_original_and_controlled_indices(self):
        result = check(ROOT)
        saved = json.loads((ROOT / 'relative-encoding/analysis.json').read_bytes())
        self.assertEqual(result, saved)
        self.assertTrue(result['passes'])
        self.assertEqual(len(result['records']), 4)
        for row in result['records']:
            self.assertEqual(row['mismatchedValues'], 0)
            self.assertEqual(row['neuralForwards'], 0)
            self.assertEqual(row['gpuRequests'], 0)
            self.assertEqual(sum(g['values'] for g in row['groups'].values()), row['values'])
            self.assertTrue(all(g['pairs'] > 0 for g in row['groups'].values()))

    def test_real_ligand_index_and_entity_errors_are_detected_in_affected_pair_classes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            unpack_evidence(ROOT / 'trained-target-ythdf2-cpu', root)
            native, _ = load_snapshot(root / 'native/features')
            outputs, _ = load_snapshot(root / 'native/trained-embedder/outputs')
            batch, _ = load_snapshot(ROOT / 'trained-target-ythdf2-cpu/fixture/controlled-batch')
            first = np.flatnonzero(batch['isLigand'])[0]
            for field, group in [('tokenIndex', 'ligandLigand'), ('entityId', 'proteinLigand')]:
                features = copy.deepcopy(batch['features'])
                features[field][first] += 1
                result = compare(features, batch['isLigand'], outputs['relative_position_features'][0])
                self.assertFalse(result['exact'])
                self.assertGreater(result['groups'][group]['mismatchedValues'], 0)
                self.assertEqual(result['groups']['proteinProtein']['mismatchedValues'], 0)


if __name__ == '__main__':
    unittest.main()
