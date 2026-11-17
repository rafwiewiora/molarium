"""Replay the measured CPU control; no encoder, model or GPU execution in CI."""
from pathlib import Path
import hashlib
import io
import json
import shutil
import tempfile
import unittest
import zipfile
from check_trained_target_cpu import check


REPO = Path(__file__).resolve().parents[2]
ROOT = REPO / 'reviews/cofold-feature-parity-2026-11-13/trained-target-ythdf2-cpu'


class TrainedTargetCpuTests(unittest.TestCase):
    def test_exact_native_weights_features_and_measured_cpu_values_replay(self):
        result = check(ROOT)
        self.assertTrue(result['passes'])
        self.assertEqual(result['mappedWeightTensors'], 44)
        self.assertEqual(result['productionFiles'], 99)
        self.assertTrue(result['copiedPrefixExact'])
        learned = result['learnedAtomChannels']
        self.assertEqual(learned['values'], 71040)
        self.assertGreater(learned['referenceRms'], 0.1)
        self.assertAlmostEqual(learned['relativeRms'], 1.4588051846176491e-7, places=18)
        self.assertEqual(learned['maxAbs'], 5.7220458984375e-6)

    def test_changed_measured_output_rejects_before_any_model_or_archive_work(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(ROOT / 'measurement', root / 'measurement')
            path = root / 'measurement/actual-target.bin'
            raw = bytearray(path.read_bytes())
            raw[-1] ^= 1
            path.write_bytes(raw)
            with self.assertRaisesRegex(ValueError, 'Measured CPU output changed'):
                check(root)

    def test_public_runner_changes_only_documented_import_and_repository_roots(self):
        record = json.loads((ROOT / 'portable-source-adaptations.json').read_bytes())
        metadata = json.loads((ROOT / 'native-evidence.json').read_bytes())['archive']
        archive = b''.join((ROOT / p['file']).read_bytes() for p in metadata['parts'])
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            original = z.read('first-run/run.mjs')
        self.assertEqual(hashlib.sha256(original).hexdigest(), record['fromSha256'])
        text = original.decode()
        self.assertEqual(len(record['replacements']), 2)
        for replacement in record['replacements']:
            self.assertEqual(text.count(replacement['from']), 1)
            text = text.replace(replacement['from'], replacement['to'])
        public = REPO / record['publicPath']
        self.assertTrue(public.resolve().is_relative_to(REPO.resolve()))
        self.assertEqual(text.encode(), public.read_bytes())
        self.assertEqual(hashlib.sha256(public.read_bytes()).hexdigest(), record['toSha256'])


if __name__ == '__main__':
    unittest.main()
