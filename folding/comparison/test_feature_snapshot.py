from pathlib import Path
import json
import hashlib
import subprocess
import tempfile
import unittest
import numpy as np
from capture_native_features import freeze_features
from feature_snapshot import load_snapshot


class FeatureSnapshotTests(unittest.TestCase):
    def test_saved_diagnostic_features_bind_exact_original_inputs_and_consumed_producer(self):
        repo = Path(__file__).resolve().parents[2]
        root = repo / 'reviews/cofold-feature-parity-2026-11-13'
        sha = lambda data: hashlib.sha256(data).hexdigest()
        index = json.loads((root / 'artifact-index.json').read_bytes())
        for item in index['files']:
            path = (root / item['file']).resolve()
            self.assertTrue(path.is_relative_to(root.resolve()))
            raw = path.read_bytes()
            self.assertEqual(sha(raw), item['sha256'])
            self.assertEqual(len(raw), item['bytes'])
        for case, number in [('9t51-a1jtm', 3), ('32qy-a1keo', 8)]:
            folder = root / ('browser-' + case)
            receipt = json.loads((folder / 'receipt.json').read_bytes())
            source = (repo / 'reviews/cofold-recent-pdb-2026-11-13/browser-openbind0-msa256-standard' / f'library-{number}.json').read_bytes()
            self.assertEqual(receipt['librarySha256'], sha(source))
            library = json.loads(source)
            result = next(p for p in library['poses'] if p['seed'] == 0)['result']
            self.assertEqual(receipt['inputComponentSha256'], result['provenance']['ligandComponentSha256'])
            self.assertEqual(receipt['alignmentSha256'], sha(library['run']['alignment'].encode()))
            self.assertEqual(receipt['sourceFiles']['folding/comparison/capture-browser-features.mjs'],
                             sha((root / 'producers/capture-browser-features.mjs').read_bytes()))
            batch, manifest = load_snapshot(folder)
            self.assertEqual(batch['tokens'], receipt['tokens'])
            self.assertEqual(len(manifest['arrays']), receipt['capturedArrays'])

    def test_exact_numeric_features_are_immutable_and_changed_transfer_rejects(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'snapshot'
            original = {'mask': np.array([True, False]),
                        'positions': np.array([[1.25, -0., 4.]], dtype=np.float32)}
            freeze_features(original, out)
            batch, _ = load_snapshot(out)
            self.assertEqual(batch['positions'].tobytes(), original['positions'].tobytes())
            self.assertEqual(batch['mask'].dtype, original['mask'].dtype)
            with self.assertRaises(ValueError):
                batch['positions'][0, 0] = 2
            raw = bytearray((out / 'features.bin').read_bytes());raw[-1] ^= 1
            (out / 'features.bin').write_bytes(raw)
            with self.assertRaisesRegex(ValueError, 'changed'):
                load_snapshot(out)

    def test_actual_javascript_capture_decodes_uint64_and_nested_views_without_rounding(self):
        module = Path(__file__).with_name('capture-browser-features.mjs').as_uri()
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'javascript'
            code = f'''import {{freezeFeatures}} from {json.dumps(module)};
const source=new Float32Array([99,1.25,-0,88]);
await freezeFeatures({{positions:source.subarray(1,3),nested:[new BigUint64Array([2n**63n+19n])]}},{json.dumps(str(out))});'''
            subprocess.run(['node', '--input-type=module', '-e', code], check=True, capture_output=True)
            batch, _ = load_snapshot(out)
            self.assertEqual(batch['positions'].dtype, np.dtype('float32'))
            self.assertEqual(batch['positions'][0], 1.25)
            self.assertTrue(np.signbit(batch['positions'][1]))
            self.assertEqual(int(batch['nested'][0][0]), 2**63 + 19)


if __name__ == '__main__':
    unittest.main()
