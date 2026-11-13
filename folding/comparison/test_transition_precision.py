from pathlib import Path
import unittest
from analyze_transition_precision import evaluate


class TransitionPrecisionTests(unittest.TestCase):
    def test_native_math_gpu_outputs_decoder_and_failed_history_from_exact_bytes(self):
        root=Path(__file__).resolve().parents[2]/'reviews/cofold-layer-parity-2026-11-13/production'
        result=evaluate(root)
        self.assertEqual(result['rawMetricsRecomputed'],126)
        self.assertEqual(result['candidateChecks'],63)
        self.assertEqual(result['actualGpuDecoderChecks'],42)
        self.assertEqual(result['initialCompleteCandidateFailures'],2)
        self.assertTrue(all(r['candidateChecks']==r['candidatePass']==21 for r in result['summary']))


if __name__=='__main__':unittest.main()
