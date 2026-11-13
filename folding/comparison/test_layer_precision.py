"""Recompute published component metrics from raw official and GPU bytes."""
import hashlib
import io
import json
from pathlib import Path
import unittest
import zipfile
import numpy as np

ROOT=Path(__file__).resolve().parents[2]/'reviews/cofold-layer-parity-2026-11-13'
sha=lambda b:hashlib.sha256(b).hexdigest()


class LayerPrecisionTests(unittest.TestCase):
    def test_exact_evidence_and_recomputed_errors(self):
        receipt=json.loads((ROOT/'evidence.json').read_text());archive=(ROOT/'fixed-input-evidence.zip').read_bytes()
        self.assertEqual(sha(archive),receipt['archiveSha256'])
        with zipfile.ZipFile(io.BytesIO(archive))as z:
            files={f['file']:z.read(f['file'])for f in receipt['files']}
        for f in receipt['files']:
            self.assertEqual(len(files[f['file']]),f['bytes']);self.assertEqual(sha(files[f['file']]),f['sha256'])
        native=json.loads(files['fp32/manifest.json']);double=json.loads(files['fp64/manifest.json'])
        report=json.loads(files['webgpu/comparison.json'])
        self.assertEqual(report,json.loads((ROOT/'comparison.json').read_text()))
        self.assertEqual(sha(files['fp32/manifest.json']),report['manifestSha256'])
        self.assertEqual(sha(files['fp64/manifest.json']),report['f64ManifestSha256'])
        self.assertEqual(double['originalManifestSha256'],report['manifestSha256'])
        for manifest,prefix,field in [(native,'fp32/','blob'),(double,'fp64/','blob'),(report,'webgpu/','outputs')]:
            self.assertEqual(sha(files[prefix+manifest[field]['file']]),manifest[field]['sha256'])
        self.assertEqual(len(report['records']),20)
        original_cases={c['id']:c for c in native['cases']};double_cases={c['caseId']:c for c in double['records']}
        output_cases={(c['caseId'],c['variance']):c for c in report['outputs']['records']}
        def values(blob,descriptor,dtype):
            data=blob[descriptor['byteOffset']:descriptor['byteOffset']+descriptor['bytes']]
            self.assertEqual(sha(data),descriptor['sha256'])
            return np.frombuffer(data,dtype=dtype).astype(np.float64)
        def error(actual,expected):
            delta=actual-expected
            return {'relativeRms':float(np.sqrt(np.sum(delta*delta)/np.sum(expected*expected))),
                'maxAbs':float(np.max(np.abs(delta)))}
        def compare(actual,expected):
            for key in ['relativeRms','maxAbs']:
                self.assertAlmostEqual(actual[key],expected[key],delta=max(1e-12,abs(expected[key])*1e-9))
        for r in report['records']:
            c=original_cases[r['caseId']];d=double_cases[r['caseId']]
            expected=values(files['fp32/fixtures.bin'],native['arrays'][c['expected']],'<f4')
            expected64=values(files['fp64/expected-f64.bin'],d,'<f8')
            actual=values(files['webgpu/'+report['outputs']['file']],output_cases[(r['caseId'],r['variance'])],'<f4')
            self.assertEqual(len(actual),len(expected));self.assertEqual(bool(np.isfinite(actual).all()),r['finite'])
            compare(error(expected,expected64),d['nativeF32vsF64'])
            if r['finite']:
                compare(error(actual,expected),r);compare(error(actual,expected64),r['againstF64'])
            else:self.assertIsNone(r['relativeRms']);self.assertIsNone(r['maxAbs'])
            if not r['stressDiagnostic']:self.assertTrue(r['passesOrdinaryF32Gate'])
            if r['variance'].startswith('shifted-'):
                self.assertTrue(r['finite']);self.assertLess(r['againstF64']['relativeRms'],1e-4)
                self.assertLess(r['againstF64']['maxAbs'],2e-4)
        stress=[r for r in report['records']if r['stressDiagnostic']]
        self.assertFalse(next(r for r in stress if r['variance']=='fast')['finite'])
        self.assertTrue(all(not r['passesOrdinaryF32Gate']for r in stress))


if __name__=='__main__':unittest.main()
