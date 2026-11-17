"""Describe saved FP32 residuals without changing the original acceptance gates."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from check_trained_trunk import check, checked_bytes


def ordered_float32(values):
    """Monotone representable-value indices; signed zeros have one index."""
    values = np.asarray(values, dtype='<f4')
    if not np.isfinite(values).all():
        raise ValueError('ULP diagnostic requires finite float32 values')
    bits = values.view('<u4').astype(np.int64)
    return np.where(bits & 0x80000000, 0x80000000 - (bits & 0x7fffffff),
                    0x80000000 + bits)


def residual_summary(actual, expected, shape, absolute_gate):
    actual, expected = np.asarray(actual, dtype='<f4'), np.asarray(expected, dtype='<f4')
    if actual.shape != expected.shape or actual.size != int(np.prod(shape)):
        raise ValueError('Residual diagnostic shape mismatch')
    distance = np.abs(ordered_float32(actual) - ordered_float32(expected))
    difference = np.abs(actual.astype(np.float64) - expected.astype(np.float64))
    worst = int(np.argmax(difference))
    spacing = np.spacing(np.abs(expected)).astype(np.float64)
    if not np.isfinite(spacing).all():
        raise ValueError('Reference outside finite-spacing diagnostic domain')
    return {
        'values': int(expected.size),
        'referenceMaxMagnitude': float(np.max(np.abs(expected))),
        'absoluteGateFailures': int(np.count_nonzero(difference > absolute_gate)),
        'referenceMagnitudeSpacingExceedsAbsoluteGate': int(np.count_nonzero(spacing > absolute_gate)),
        'ulpDistanceQuantiles': {str(q): float(np.percentile(distance, q)) for q in [50, 95, 99, 100]},
        'valuesWithinUlps': {str(n): int(np.count_nonzero(distance <= n)) for n in [0, 1, 2, 4, 8, 16]},
        'maximumAbsoluteErrorLocation': {
            'flatIndex': worst,
            'indices': [int(x) for x in np.unravel_index(worst, shape)],
            'reference': float(expected.flat[worst]),
            'actual': float(actual.flat[worst]),
            'absoluteError': float(difference.flat[worst]),
            'referenceMagnitudeSpacing': float(spacing.flat[worst]),
            'ulpDistance': int(distance.flat[worst]),
        },
    }


def analyze(fixture, measured):
    fixture, measured = Path(fixture), Path(measured)
    original = check(fixture, measured)
    fr = json.loads((fixture / 'receipt.json').read_bytes())
    mr = json.loads((measured / 'receipt.json').read_bytes())
    records = []
    for gate_record in original['records']:
        key = gate_record['seam']
        spec = fr['expectedSeams'][key]
        expected = np.frombuffer(checked_bytes(fixture, spec), dtype='<f4')
        actual = np.frombuffer(checked_bytes(measured, mr['outputs'][key]), dtype='<f4')
        records.append({**gate_record, **residual_summary(actual, expected, spec['shape'], original['gates']['maxAbsoluteDifference'])})
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    return {
        'schema': 'molarium.trained-trunk-residual-diagnostic.v1',
        'scope': 'Data-only description of exact saved learned-feature residuals. ULP counts are descriptive, not new tolerances, model equivalence, physical units or a pose-accuracy criterion. Large ULP distances near zero remain in the distribution.',
        'fixtureReceiptSha256': sha(fixture / 'receipt.json'),
        'measurementReceiptSha256': sha(measured / 'receipt.json'),
        'producerSha256': sha(Path(__file__)),
        'gatesUnchanged': original['gates'],
        'passesAllDeclaredGates': original['passesAllDeclaredGates'],
        'records': records,
        'newNeuralForwards': 0,
    }


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--fixture', type=Path, required=True)
    p.add_argument('--measured', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    result = analyze(args.fixture, args.measured)
    with args.output.open('x') as stream:
        stream.write(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'records': len(result['records']), 'originalGatePass': result['passesAllDeclaredGates'], 'newNeuralForwards': 0}))
