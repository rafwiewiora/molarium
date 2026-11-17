"""Re-encode captured FP32 weights with the pinned upstream INT5 quantizer.

Uses saved weights and immutable shipped shards only. No model forward,
native capture, conversion or GPU execution is performed.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path

import numpy as np


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def decode_int5(record, shard):
    count = math.prod(record['shape'])
    assert record['dtype'] == 'int5' and record['block'] == 32
    groups = (count + 31) // 32
    packed = np.frombuffer(shard, dtype=np.uint8, count=groups * 20,
                           offset=record['byteOffset']).reshape(groups, 20)
    bits = np.unpackbits(packed, axis=1, bitorder='little').reshape(groups, 32, 5)
    codes = np.sum(bits * (1 << np.arange(5, dtype=np.uint8)), axis=2,
                   dtype=np.uint8)
    scales = np.frombuffer(shard, '<f2', groups, record['scaleOffset'])
    zeros = np.frombuffer(shard, '<f2', groups, record['zeroOffset'])
    # JS calculates each product and sum in float64 before Float32Array storage.
    decoded = (codes.astype(np.float64) * scales[:, None].astype(np.float64)
               + zeros[:, None].astype(np.float64)).astype('<f4').reshape(-1)[:count]
    return decoded, packed, scales, zeros


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--measurement', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    assert not args.output.exists(), 'Use a new output; preserve earlier evidence'
    plan = json.loads(args.plan.read_bytes())
    repo = Path(__file__).resolve().parents[2]
    assert plan['newModelCalls'] == 0
    for name, expected in plan['sourceFiles'].items():
        assert digest(repo / name) == expected, name
    quantizer = repo / 'folding/comparison/reference-localfold/quantize_af3.py'
    spec = importlib.util.spec_from_file_location('pinned_localfold_quantizer', quantizer)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    audit = json.loads((args.measurement / 'analysis.json').read_bytes())
    assert audit['status'] == 'complete' and audit['planSha256'] == digest(args.plan)
    stock = json.loads((args.measurement / 'stock-manifest.json').read_bytes())
    fixture = Path(plan['fixture'])
    assert digest(fixture / 'receipt.json') == plan['fixtureReceiptSha256']
    assert digest(fixture / 'weights.json') == plan['nativeWeightManifestSha256']
    native = json.loads((fixture / 'weights.json').read_bytes())
    assert digest(fixture / 'weights.bin') == plan['nativeWeightBlobSha256']
    weights = np.memmap(fixture / 'weights.bin', dtype=np.uint8, mode='r')
    expected_records = {r['name']: r for r in audit['records']}
    assert len(expected_records) == len(native['tensors']) == plan['expectedTensors']
    records = []
    for shard_receipt in audit['shards']:
        shard_path = args.measurement / 'shards' / shard_receipt['file']
        assert digest(shard_path) == shard_receipt['sha256'] == stock['shardDigests'][shard_receipt['file']]
        shard = shard_path.read_bytes()
        for name, meta in native['tensors'].items():
            entry = stock['tensors'][name]
            if entry['file'] != shard_receipt['file']:
                continue
            assert meta['shape'] == entry['shape']
            raw = weights[meta['byteOffset']:meta['byteOffset'] + meta['bytes']]
            assert hashlib.sha256(raw).hexdigest() == meta['sha256']
            values = np.frombuffer(raw, dtype='<f4')
            repack = None
            if entry['dtype'] == 'float32':
                decoded = np.frombuffer(shard, '<f4', values.size, entry['byteOffset'])
                exact = decoded.tobytes() == raw.tobytes()
            else:
                decoded, packed, scales, zeros = decode_int5(entry, shard)
                codes, actual_scales, actual_zeros = module.quantise(values, group=32, bits=5)
                actual_packed = module.pack(codes, bits=5)
                repack = {'codeBytes': packed.size,
                          'differentPackedBytes': int(np.count_nonzero(actual_packed != packed)),
                          'differentScaleBits': int(np.count_nonzero(actual_scales.view('<u2') != scales.view('<u2'))),
                          'differentZeroBits': int(np.count_nonzero(actual_zeros.view('<u2') != zeros.view('<u2')))}
                exact = all(repack[k] == 0 for k in ['differentPackedBytes', 'differentScaleBits', 'differentZeroBits'])
            decoded_hash = hashlib.sha256(decoded.tobytes()).hexdigest()
            expected = expected_records[name]
            assert decoded_hash == expected['decodedStockSha256'], 'Independent decoder disagreement: ' + name
            n64, d64 = values.astype(np.float64), decoded.astype(np.float64)
            difference = n64 - d64
            reference_sq, error_sq = float(n64 @ n64), float(difference @ difference)
            relative = math.sqrt(error_sq / reference_sq) if reference_sq else None if error_sq else 0.0
            max_abs = float(np.max(np.abs(difference)))
            assert math.isclose(max_abs, expected['maxAbs'], rel_tol=0, abs_tol=0)
            assert relative == expected['relativeRms'] if relative is None else math.isclose(relative, expected['relativeRms'], rel_tol=1e-10, abs_tol=1e-12)
            records.append({'name': name, 'stockDtype': entry['dtype'],
                            'values': int(values.size), 'decodedSha256': decoded_hash,
                            'independentDecodedBytesMatch': True, 'relativeRms': relative,
                            'maxAbs': max_abs, 'exactNativeReencoding': exact,
                            'packedComparison': repack})
    assert len(records) == plan['expectedTensors']
    quantized = [r for r in records if r['stockDtype'] == 'int5']
    floating = [r for r in records if r['stockDtype'] == 'float32']
    result = {'schema': 'molarium.shipped-trunk-weight-reencoding.v1', 'status': 'complete',
              'scope': 'Parameter identity and quantization only, not model, GPU-upload or pose agreement.',
              'planSha256': digest(args.plan), 'measurementSha256': digest(args.measurement / 'analysis.json'),
              'quantizerSha256': digest(quantizer),
              'allIndependentDecodedHashesMatch': True,
              'fp32Tensors': len(floating), 'exactFp32Tensors': sum(r['exactNativeReencoding'] for r in floating),
              'int5Tensors': len(quantized), 'exactInt5Reencodings': sum(r['exactNativeReencoding'] for r in quantized),
              'allReencodingsExact': all(r['exactNativeReencoding'] for r in records),
              'metricReplayTolerance': {'relative': 1e-10, 'absolute': 1e-12,
                                        'scope': 'Reduction replay only; no numerical model acceptance gate.'},
              'records': records, 'newModelCalls': 0, 'newNativeCaptureCalls': 0,
              'newFullModelConversions': 0}
    with args.output.open('x') as output:
        output.write(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'records'}))


if __name__ == '__main__':
    main()
