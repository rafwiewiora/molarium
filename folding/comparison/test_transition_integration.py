from pathlib import Path
import unittest
from analyze_transition_integration import evaluate


class TransitionIntegrationTests(unittest.TestCase):
    def test_direct_outputs_and_both_dispatch_stages_against_saved_native_arrays(self):
        root = Path(__file__).resolve().parents[2] / 'reviews/cofold-layer-parity-2026-11-13/integration'
        result = evaluate(root)
        self.assertEqual(result['rawMetricsRecomputed'], 17)
        self.assertEqual([r['passes'] for r in result['summary']], [7, 0, 4])


if __name__ == '__main__':
    unittest.main()
