"""Replay measured trained-stage bytes; these tests do not run a model or GPU."""
from pathlib import Path
import hashlib
import json
import shutil
import tempfile
import unittest
import zipfile
from check_trained_target import check


class TrainedTargetTests(unittest.TestCase):
    root=Path(__file__).resolve().parents[2]/'reviews/cofold-feature-parity-2026-11-13/trained-target'

    def test_native_weights_inputs_and_both_measured_errors_reconstruct(self):
        result=check(self.root)
        self.assertEqual(result['mappedWeightTensors'],44)
        self.assertEqual(len(result['records']),2)
        for item in result['records']:
            self.assertTrue(item['passes'])
            self.assertLess(item['relativeRms'],2e-7)
            self.assertLess(item['maxAbs'],7e-6)

    def test_missing_path_and_changed_raw_output_cannot_be_a_parity_pass(self):
        with tempfile.TemporaryDirectory()as directory:
            out=Path(directory)/'evidence';shutil.copytree(self.root,out)
            report=json.loads((out/'browser-comparison.json').read_bytes())
            changed=dict(report,records=[])
            (out/'browser-comparison.json').write_text(json.dumps(changed))
            with self.assertRaisesRegex(ValueError,'Both measured paths'):
                check(out)
            (out/'browser-comparison.json').write_text(json.dumps(report))
            item=next(r for r in report['outputs']if r['path']=='production-webgpu')
            file=out/item['file'];data=bytearray(file.read_bytes());data[400]^=1;file.write_bytes(data)
            with self.assertRaisesRegex(ValueError,'Measured raw output changed'):
                check(out)

    def test_source_snapshot_and_path_only_portable_adapters_retain_executed_code(self):
        repo=Path(__file__).resolve().parents[2];root=self.root
        receipt=json.loads((root/'production-sources.json').read_bytes());raw=(root/'production-sources.zip').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),receipt['archive']['sha256'])
        with zipfile.ZipFile(root/'production-sources.zip')as z:
            self.assertEqual(set(z.namelist()),set(receipt['files']))
            for name,item in receipt['files'].items():
                data=z.read(name);self.assertEqual(len(data),item['bytes'])
                self.assertEqual(hashlib.sha256(data).hexdigest(),item['sha256'])
        adaptations=json.loads((root/'portable-source-adaptations.json').read_bytes())
        with zipfile.ZipFile(root/'consumed-sources.zip')as z:
            for item in adaptations['files']:
                original=z.read(item['consumedMember']).decode()
                self.assertEqual(hashlib.sha256(original.encode()).hexdigest(),item['consumedSha256'])
                current=(repo/item['file']).read_text()
                self.assertEqual(hashlib.sha256(current.encode()).hexdigest(),item['portableSha256'])
                expected=original
                for before,after in item['replacements']:
                    self.assertEqual(expected.count(before),1);expected=expected.replace(before,after)
                self.assertEqual(current,expected)


if __name__=='__main__':unittest.main()
