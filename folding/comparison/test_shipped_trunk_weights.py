from pathlib import Path
import base64
import hashlib
import importlib.util
import json
import subprocess
import unittest

import numpy as np
from check_shipped_trunk_quantization import decode_int5


class ShippedWeightAudit(unittest.TestCase):
    def fixture(self):
        root = Path(__file__).resolve().parent
        path = root / 'reference-localfold/quantize_af3.py'
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),
                         '8f75171c59e32ad7603323293839769aa149b728c6a2f8f1531dc2f6070162fa')
        spec = importlib.util.spec_from_file_location('upstream_quantizer_test', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        values = np.linspace(-4, 3.75, 37, dtype=np.float32)
        codes, scales, zeros = module.quantise(values)
        packed = module.pack(codes).tobytes()
        shard = b'HEAD' + packed + b'\0' * 4 + scales.tobytes() + zeros.tobytes()
        entry = {'shape': [37], 'dtype': 'int5', 'block': 32, 'byteOffset': 4,
                 'scaleOffset': 48, 'zeroOffset': 52}
        return entry, shard

    def test_independent_int5_decoder_matches_actual_host_decoder_with_partial_group(self):
        entry, shard = self.fixture()
        decoded, _, _, _ = decode_int5(entry, shard)
        module = (Path(__file__).resolve().parents[2] /
                  'vendor/localfold/shared/weights/dtype.js').as_uri()
        code = f'''import {{readTensor}} from {json.dumps(module)};
import {{createHash}} from 'node:crypto';
const raw=Buffer.from({json.dumps(base64.b64encode(shard).decode())},'base64');
const b=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.length);
const out=readTensor({json.dumps(entry)},b,4);
console.log(createHash('sha256').update(new Uint8Array(out.buffer,out.byteOffset,out.byteLength)).digest('hex'));'''
        result = subprocess.run(['node', '--input-type=module', '-e', code],
                                capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout.strip(), hashlib.sha256(decoded.tobytes()).hexdigest())
        self.assertEqual(decoded.size, 37)

    def test_changed_codes_and_truncated_scale_table_cannot_preserve_decoded_hash(self):
        entry, shard = self.fixture()
        original = decode_int5(entry, shard)[0]
        altered = bytearray(shard)
        altered[4] ^= 1
        changed = decode_int5(entry, altered)[0]
        self.assertNotEqual(original.tobytes(), changed.tobytes())
        with self.assertRaises(ValueError):
            decode_int5(entry, shard[:entry['zeroOffset']])


if __name__ == '__main__':
    unittest.main()
