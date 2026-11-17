"""Artifact/producer guards and saved controls; synthetic arrays are not model evidence."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
import numpy as np
from check_trained_trunk import check


class TrunkArtifactTests(unittest.TestCase):
    def test_actual_browser_expression_parses_and_rejects_half_arithmetic(self):
        repo = Path(__file__).resolve().parents[2]
        source = (repo / 'scripts/cofold-trained-trunk.browser.mjs').read_text()
        expression = source.split('await browser.evaluate(String.raw`', 1)[1].split('  })()`);', 1)[0] + '  })()'
        expression = expression.replace("${JSON.stringify(process.env.MOLARIUM_REQUIRE_NVIDIA === '1')}", 'false')
        expression = expression.replace('${JSON.stringify(token)}', '"syntax-check-token"')
        self.assertNotIn('${', expression)
        audit = expression.split('      const shaderAudit=[];', 1)[1].split('      const weights=', 1)[0]
        code = '''const assert=require('node:assert/strict');
new Function(EXPRESSION);
let forwarded=0; const device={createShaderModule(){forwarded++;return 'module';}};
const audit=new Function('device','const shaderAudit=[];'+AUDIT+';return shaderAudit;')(device);
assert.equal(device.createShaderModule({code:'// f16 in a comment\\nvar x:f32;'}),'module');
assert.throws(()=>device.createShaderModule({code:'enable f16; var x:f16;'}),/Strict FP32/);
assert.equal(forwarded,1); assert.deepEqual(audit.map(x=>x.usesF16),[false,true]);
'''.replace('EXPRESSION', json.dumps(expression)).replace('AUDIT', json.dumps(audit))
        subprocess.run(['node', '-e', code], check=True, capture_output=True)

    def test_saved_precision_control_retains_absolute_failures_and_exact_producer(self):
        repo = Path(__file__).resolve().parents[2]
        root = repo / 'reviews/cofold-feature-parity-2026-11-13/trained-trunk-apple'
        summary = json.loads((root / 'precision-comparison.json').read_bytes())
        for item, folder in zip(summary['controls'], ['', 'two-pass', 'strict-fp32']):
            analysis = json.loads((root / folder / 'analysis.json').read_bytes())
            self.assertEqual(len(analysis['records']), 32)
            self.assertEqual(item['passing'], sum(r['passes'] for r in analysis['records']))
            self.assertFalse(analysis['passesAllDeclaredGates'])
            self.assertEqual(analysis['gates'], {'relativeRms': 1e-4, 'maxAbsoluteDifference': 1e-3, 'requireFinite': True})
        measured = json.loads((root / 'strict-fp32/measurement-receipt.json').read_bytes())
        self.assertEqual(measured['precisionControl'], {'pairMatrixKernels': False, 'requireNoF16Shaders': True})
        self.assertEqual(len(measured['shaderAudit']), 56)
        self.assertFalse(any(r['usesF16'] for r in measured['shaderAudit']))
        self.assertEqual(len(measured['outputs']), 32)
        adaptation = json.loads((root / 'strict-fp32/source-adaptation.json').read_bytes())
        raw = (root / 'strict-fp32/runner.mjs').read_text()
        self.assertEqual(hashlib.sha256(raw.encode()).hexdigest(), measured['runnerSha256'])
        for patch in reversed(adaptation['reversibleReplacements']):
            self.assertGreaterEqual(raw.count(patch['to']), 1)
            raw = raw.replace(patch['to'], patch['from'])
        self.assertEqual(hashlib.sha256(raw.encode()).hexdigest(), adaptation['parentRunnerSha256'])
        fix = json.loads((root / 'precision-fix.json').read_bytes())
        self.assertEqual(fix['currentHarnessSha256'], hashlib.sha256((repo / 'scripts/cofold-trained-trunk.browser.mjs').read_bytes()).hexdigest())

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
