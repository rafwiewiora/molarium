"""Portable feature serialization, not a scientific runtime/GPU execution test."""
from pathlib import Path
import hashlib
import json
import tempfile
import unittest
import numpy as np
from capture_native_features import freeze_features


class FeatureCaptureTests(unittest.TestCase):
    def test_nested_arrays_preserve_exact_dtypes_shapes_views_and_nonfinite_bits(self):
        source = {
            'positions': np.arange(30, dtype=np.float32).reshape(5, 6)[:, ::2],
            'nested': [np.array([2**63 + 19], dtype=np.uint64),
                       (np.array([True, False]), np.array([0., -0., np.nan], dtype=np.float64))],
            'valid_sample': True, 'labels': np.array(['CA', 'CB'])}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'capture'
            manifest = freeze_features(source, output)
            self.assertEqual(json.loads((output / 'features.json').read_bytes()), manifest)
            raw = (output / 'features.bin').read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), manifest['blob']['sha256'])
            original = [source['positions'], source['nested'][0], *source['nested'][1]]
            self.assertEqual(len(manifest['arrays']), len(original))
            for saved, expected in zip(manifest['arrays'].values(), original):
                data = raw[saved['byteOffset']:saved['byteOffset'] + saved['bytes']]
                self.assertEqual(hashlib.sha256(data).hexdigest(), saved['sha256'])
                restored = np.frombuffer(data, dtype=saved['dtype']).reshape(saved['shape'])
                self.assertEqual(restored.dtype, expected.dtype)
                self.assertEqual(restored.tobytes(), np.ascontiguousarray(expected).tobytes())
                self.assertEqual(saved['byteOffset'] % 8, 0)
            self.assertEqual(manifest['unserializedMetadata'], [])

    def test_unsupported_metadata_is_explicit_and_a_capture_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'capture'
            manifest = freeze_features({'opaque': object(), 'mask': np.array([1, 0], dtype=np.int8)}, output)
            self.assertEqual(manifest['unserializedMetadata'], [{'path': 'batch/opaque', 'type': 'builtins.object'}])
            with self.assertRaises(FileExistsError):
                freeze_features({'different': np.zeros(4)}, output)


if __name__ == '__main__':
    unittest.main()
