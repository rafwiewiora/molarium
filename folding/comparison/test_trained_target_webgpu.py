"""Reject changed numerical evidence even when its local digest is updated."""
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from check_trained_target_webgpu import check

BASE = Path(__file__).resolve().parents[2] / 'reviews/cofold-feature-parity-2026-11-13'
ROOT = BASE / 'trained-target-ythdf2-webgpu'
CPU = BASE / 'trained-target-ythdf2-cpu'


class SavedAppleTarget(unittest.TestCase):
    def test_saved_measurement_replays(self):
        result = check(ROOT)
        self.assertTrue(result['passes'])
        self.assertEqual(result['newModelCalls'], 0)

    def test_changed_output_with_updated_digest_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'measurement'
            shutil.copytree(ROOT, root)
            output = root / 'result.production-webgpu.bin'
            output.write_bytes(bytes(output.stat().st_size))
            report = json.loads((root / 'result.json').read_text())
            report['outputs'][0]['sha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
            (root / 'result.json').write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError, 'Numerical result does not reproduce'):
                check(root, CPU)

    def test_software_adapter_cannot_relabel_saved_result(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'measurement'
            shutil.copytree(ROOT, root)
            report = json.loads((root / 'result.json').read_text())
            report['observedAdapters'][0]['vendor'] = 'swiftshader'
            (root / 'result.json').write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError, 'Physical Apple observation required'):
                check(root, CPU)


if __name__ == '__main__':
    unittest.main()
