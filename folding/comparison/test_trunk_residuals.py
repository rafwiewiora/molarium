"""Representable-value diagnostics must not imply a relaxed acceptance gate."""
import unittest
import numpy as np
from analyze_trunk_residuals import ordered_float32, residual_summary


class ResidualDiagnosticTests(unittest.TestCase):
    def test_adjacent_floats_and_signed_zero_have_exact_distances(self):
        values = np.array([-2., -1., -0., 0., 1., 2.], dtype='<f4')
        larger = np.nextafter(values, np.float32(np.inf))
        np.testing.assert_array_equal(ordered_float32(larger) - ordered_float32(values), np.ones(6, dtype=np.int64))
        self.assertEqual(ordered_float32(values)[2], ordered_float32(values)[3])
        with self.assertRaisesRegex(ValueError, 'finite'):
            ordered_float32([np.nan])

    def test_small_ulp_error_can_fail_the_unchanged_absolute_gate(self):
        expected = np.array([262144.], dtype='<f4')
        actual = np.nextafter(np.nextafter(expected, np.float32(np.inf)), np.float32(np.inf))
        record = residual_summary(actual, expected, [1], 1e-3)
        self.assertEqual(record['absoluteGateFailures'], 1)
        self.assertEqual(record['referenceMagnitudeSpacingExceedsAbsoluteGate'], 1)
        self.assertEqual(record['maximumAbsoluteErrorLocation']['ulpDistance'], 2)
        self.assertEqual(record['maximumAbsoluteErrorLocation']['absoluteError'], 0.0625)
        self.assertEqual(record['referenceMaxMagnitude'], 262144.)


if __name__ == '__main__':
    unittest.main()
