"""Portable feature serialization, not a scientific runtime/GPU execution test."""
from pathlib import Path
import hashlib
import copy
import json
import tempfile
import unittest
import zipfile
import numpy as np
from capture_native_features import freeze_features, processed_smiles_query


class FeatureCaptureTests(unittest.TestCase):
    @staticmethod
    def spelling_fixture():
        repo = Path(__file__).resolve().parents[2]
        panel = repo / 'reviews/cofold-recent-pdb-2026-11-13'
        with zipfile.ZipFile(panel / 'native-openbind0-msa256-standard/native-evidence.zip') as z:
            prefix = '9t51-a1jtm/inputs/'
            spec = json.loads(z.read(prefix + 'comparison.json'))
            query = json.loads(z.read(prefix + 'openbind-query.json'))
        library = json.loads((panel / 'browser-openbind0-msa256-standard/library-3.json').read_bytes())
        return spec, library, query

    def test_processed_spelling_control_changes_only_the_declared_ligand_string(self):
        spec, library, query = self.spelling_fixture()
        original = copy.deepcopy(query)
        output, control = processed_smiles_query(spec, library, query)
        expected = copy.deepcopy(query)
        next(iter(expected['queries'].values()))['chains'][1]['smiles'] = control['processedSmiles']
        self.assertEqual(output, expected)
        self.assertEqual(query, original)
        self.assertNotEqual(control['originalSmiles'], control['processedSmiles'])
        self.assertTrue(control['sameIsomericChemicalState'])

    def test_spelling_control_rejects_an_enantiomer(self):
        spec, library, query = self.spelling_fixture()
        result = next(p for p in library['poses'] if p['seed'] == 0)['result']
        altered = result['component']['smiles'].replace('@@', '@', 1)
        self.assertNotEqual(altered, result['component']['smiles'])
        result['component']['smiles'] = altered
        result['provenance']['ligandNormalization']['canonicalSmiles'] = altered
        with self.assertRaisesRegex(AssertionError, 'Chemical state/stereochemistry'):
            processed_smiles_query(spec, library, query)

    def test_identical_processed_spelling_must_reuse_existing_capture(self):
        spec, library, query = self.spelling_fixture()
        processed = next(p for p in library['poses'] if p['seed'] == 0)['result']['component']['smiles']
        spec['compounds'][0]['smiles'] = processed
        library['run']['compounds'][0]['smiles'] = processed
        with self.assertRaisesRegex(AssertionError, 'reuse the original capture'):
            processed_smiles_query(spec, library, query)

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
