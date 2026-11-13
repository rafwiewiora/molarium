"""Artifact-integrity guards only; synthetic arrays are not model evidence."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
from check_trained_trunk import check


class TrunkArtifactTests(unittest.TestCase):
    def fixture(self, directory):
        root = Path(directory)
        fixture, measured = root / 'fixture', root / 'measured'
        fixture.mkdir(); measured.mkdir()
        raw = np.array([1., -2.], dtype='<f4').tobytes()
        record = {'file': 'values.bin', 'shape': [2], 'bytes': len(raw),
                  'sha256': hashlib.sha256(raw).hexdigest()}
        (fixture / 'values.bin').write_bytes(raw)
        (measured / 'values.bin').write_bytes(raw)
        names = ['tap.z_init_generic', 'tap.template_term', 'tap.z_after_template',
                 'tap.msa_activations', 'tap.z_after_msa', 'tap.trunk_in_single',
                 'tap.trunk_out_pair', 'trunk-output-single']
        seams = {f'cycle-{c}.{name}': record for c in range(4) for name in names}
        gates = {'relativeRms': 1e-4, 'maxAbsoluteDifference': 1e-3, 'requireFinite': True}
        receipt = {'schema': 'molarium.trained-trunk-fixture.v1', 'cycles': 4,
                   'scope': 'Synthetic artifact guard test; no neural model result.',
                   'gatesDeclaredBeforeRun': gates, 'expectedSeams': seams}
        raw_receipt = json.dumps(receipt).encode()
        (fixture / 'receipt.json').write_bytes(raw_receipt)
        report = {'status': 'complete', 'fixtureReceiptSha256': hashlib.sha256(raw_receipt).hexdigest(),
                  'gates': gates, 'records': [{'cycle': c} for c in range(4)],
                  'outputs': seams, 'adapter': {'description': 'Synthetic physical-adapter metadata'}}
        (measured / 'receipt.json').write_text(json.dumps(report))
        return fixture, measured, report

    def test_missing_raw_seam_and_duplicate_cycle_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture, measured, report = self.fixture(directory)
            self.assertTrue(check(fixture, measured)['passesAllDeclaredGates'])
            report['records'][-1]['cycle'] = 2
            (measured / 'receipt.json').write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError, 'trunk cycles'):
                check(fixture, measured)
            report['records'][-1]['cycle'] = 3
            report['outputs'].pop('cycle-3.trunk-output-single')
            (measured / 'receipt.json').write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError, 'trunk seams'):
                check(fixture, measured)

    def test_raw_corruption_and_directory_escape_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture, measured, report = self.fixture(directory)
            raw = (measured / 'values.bin').read_bytes()
            (measured / 'values.bin').write_bytes(raw[:-1])
            with self.assertRaisesRegex(ValueError, 'incomplete artifact'):
                check(fixture, measured)
            (measured / 'values.bin').write_bytes(raw)
            report['outputs']['cycle-0.tap.z_init_generic']['file'] = '../fixture/values.bin'
            (measured / 'receipt.json').write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError, 'escapes'):
                check(fixture, measured)

    def test_changed_gates_and_software_adapter_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture, measured, report = self.fixture(directory)
            report['gates']['relativeRms'] = 1
            (measured / 'receipt.json').write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError, 'gates changed'):
                check(fixture, measured)
            report['gates']['relativeRms'] = 1e-4
            report['adapter'] = {'description': 'SwiftShader'}
            (measured / 'receipt.json').write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError, 'Physical GPU'):
                check(fixture, measured)


if __name__ == '__main__':
    unittest.main()
