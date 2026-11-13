"""Recompute errors from complete raw trunk outputs, without neural inference."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import numpy as np

from check_trained_target import metric


def checked_bytes(root, item):
    path = (root / item['file']).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError('Artifact escapes its directory')
    raw = path.read_bytes()
    if len(raw) != item['bytes'] or hashlib.sha256(raw).hexdigest() != item['sha256']:
        raise ValueError('Changed or incomplete artifact')
    return raw


def check(fixture, measured):
    fixture, measured = Path(fixture), Path(measured)
    raw = (fixture / 'receipt.json').read_bytes()
    reference = json.loads(raw)
    report = json.loads((measured / 'receipt.json').read_bytes())
    if reference['schema'] != 'molarium.trained-trunk-fixture.v1':
        raise ValueError('Unknown fixture schema')
    if reference['cycles'] != 4:
        raise ValueError('All four native cycles are required')
    if report['status'] != 'complete':
        raise ValueError('GPU measurement did not complete')
    if report['fixtureReceiptSha256'] != hashlib.sha256(raw).hexdigest():
        raise ValueError('Measurement used another fixture')
    gates = reference['gatesDeclaredBeforeRun']
    if gates != {'relativeRms': 1e-4, 'maxAbsoluteDifference': 1e-3, 'requireFinite': True} or report['gates'] != gates:
        raise ValueError('Predeclared trunk gates changed')
    if [r['cycle'] for r in report['records']] != list(range(4)):
        raise ValueError('Missing or repeated trunk cycles')
    wanted = {f'cycle-{cycle}.{name}' for cycle in range(4) for name in [
        'tap.z_init_generic', 'tap.template_term', 'tap.z_after_template',
        'tap.msa_activations', 'tap.z_after_msa', 'tap.trunk_in_single',
        'tap.trunk_out_pair', 'trunk-output-single']}
    if set(reference['expectedSeams']) != wanted or set(report['outputs']) != wanted:
        raise ValueError('Missing, unexpected or repeated trunk seams')
    adapter = json.dumps(report['adapter']).lower()
    if not report['adapter'] or any(s in adapter for s in ['swiftshader', 'llvmpipe', 'software']):
        raise ValueError('Physical GPU identification required')
    records = []
    for key in sorted(wanted):
        spec = reference['expectedSeams'][key]
        if spec['bytes'] != math.prod(spec['shape']) * 4:
            raise ValueError('Expected shape changed')
        expected = np.frombuffer(checked_bytes(fixture, spec), dtype='<f4')
        actual = np.frombuffer(checked_bytes(measured, report['outputs'][key]), dtype='<f4')
        m = metric(actual, expected)
        passes = m['finite'] and m['relativeRms'] <= gates['relativeRms'] and m['maxAbs'] <= gates['maxAbsoluteDifference']
        records.append({'seam': key, **m, 'passes': passes})
    return {'scope': reference['scope'], 'fixtureReceiptSha256': hashlib.sha256(raw).hexdigest(),
            'adapter': report['adapter'], 'gates': gates, 'records': records,
            'passesAllDeclaredGates': all(r['passes'] for r in records)}


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--fixture', type=Path, required=True)
    p.add_argument('--measured', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    result = check(args.fixture, args.measured)
    with args.output.open('x') as f:
        f.write(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'seams': len(result['records']), 'passes': result['passesAllDeclaredGates']}))
    if not result['passesAllDeclaredGates']:
        raise SystemExit(1)
