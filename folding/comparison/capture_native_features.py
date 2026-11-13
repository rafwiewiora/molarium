"""Capture the stock OpenFold3 predict-step inputs without running a forward.

Uses the official CLI, checkpoint loader and data pipeline. A guarded model
forward must never run. Tensor bytes are portable; the capture is not a pose
prediction or evidence of native/browser numerical agreement.
"""
import argparse
import hashlib
import importlib.metadata
import inspect
import json
import os
from pathlib import Path
import platform
import time
import numpy as np
from native_run import digest, resolved_input_files


def freeze_features(batch, output):
    """Preserve every numerical array leaf, including nested tensors and dtypes."""
    output.mkdir()
    payload = bytearray()
    arrays, metadata = {}, []

    def visit(value, path):
        if hasattr(value, 'detach'):
            value = value.detach().cpu().contiguous()
            if str(value.dtype) == 'torch.bfloat16':
                import torch
                return array(value.view(torch.uint16).numpy().copy(), path, 'bfloat16')
            value = value.numpy().copy()
        if isinstance(value, np.ndarray):
            if value.dtype.kind in 'biufc':
                return array(value, path)
            return {'arrayMetadata': visit(value.tolist(), path + '/items'),
                    'dtype': str(value.dtype), 'shape': list(value.shape)}
        if isinstance(value, dict):
            return {'dict': [[visit(k, path + '/key'), visit(v, path + '/' + str(k))]
                             for k, v in value.items()]}
        if isinstance(value, (list, tuple)):
            return {'tuple' if isinstance(value, tuple) else 'list':
                    [visit(v, path + '/' + str(i)) for i, v in enumerate(value)]}
        if isinstance(value, np.generic):
            return visit(value.item(), path)
        if value is None or isinstance(value, (str, bool, int)):
            return {'value': value}
        if isinstance(value, float):
            return array(np.asarray(value, dtype='<f8'), path)
        kind = type(value).__module__ + '.' + type(value).__qualname__
        metadata.append({'path': path, 'type': kind})
        return {'metadataObjectType': kind}

    def array(value, path, logical_dtype=None):
        key = f'array-{len(arrays):04d}'
        dtype = value.dtype.newbyteorder('<')
        data = np.ascontiguousarray(value, dtype=dtype).tobytes()
        payload.extend(b'\0' * (-len(payload) % 8))
        offset = len(payload)
        payload.extend(data)
        arrays[key] = {'path': path, 'shape': list(value.shape), 'dtype': dtype.str,
                       'byteOffset': offset, 'bytes': len(data),
                       'sha256': hashlib.sha256(data).hexdigest()}
        if logical_dtype:
            arrays[key]['logicalDtype'] = logical_dtype
        if value.dtype.kind in 'fc':
            arrays[key]['nonFiniteValues'] = int(np.sum(~np.isfinite(value)))
        return {'array': key}

    tree = visit(batch, 'batch')
    (output / 'features.bin').write_bytes(payload)
    manifest = {'schema': 'molarium.native-feature-capture.v1',
                'scope': 'All tensor/numerical-array leaves at the stock predict-step boundary. Unsupported metadata objects are listed by type, not silently treated as tensors.',
                'arrays': arrays, 'tree': tree, 'unserializedMetadata': metadata,
                'blob': {'file': 'features.bin', 'bytes': len(payload),
                         'sha256': hashlib.sha256(payload).hexdigest()}}
    (output / 'features.json').write_text(json.dumps(manifest, indent=2, allow_nan=False) + '\n')
    return manifest



def processed_smiles_query(spec, library, resolved_query):
    """Derive a separately recorded spelling control without changing chemistry."""
    import copy
    from rdkit import Chem
    assert len(spec['compounds']) == len(library['run']['compounds']) == 1
    assert [{'id': c['id'], 'smiles': c['smiles']} for c in library['run']['compounds']] == spec['compounds']
    pose = next(p for p in library['poses'] if p['seed'] == 0 and p['status'] == 'complete')
    result = pose['result']
    assert result['sequence'] == spec['sequence']
    assert result['provenance']['request']['model'] == 'localfold-openbind0'
    assert pose['compoundId'] == spec['compounds'][0]['id']
    original = spec['compounds'][0]['smiles']
    processed = result['component']['smiles']
    assert processed == result['provenance']['ligandNormalization']['canonicalSmiles']
    assert original != processed, 'Identical spelling: reuse the original capture instead of repeating it'
    left, right = Chem.MolFromSmiles(original), Chem.MolFromSmiles(processed)
    assert left is not None and right is not None
    assert Chem.MolToSmiles(left, isomericSmiles=True) == Chem.MolToSmiles(right, isomericSmiles=True), 'Chemical state/stereochemistry changed'
    resolved = copy.deepcopy(resolved_query)
    assert len(resolved['queries']) == 1
    entry = next(iter(resolved['queries'].values()))
    assert len(entry['chains']) == 2 and entry['chains'][1]['smiles'] == original
    entry['chains'][1]['smiles'] = processed
    control = {'originalSmiles': original, 'processedSmiles': processed,
               'sameIsomericChemicalState': True,
               'purpose': 'Only the SMILES spelling changes; a new diagnostic control, not a replacement for the original prediction protocol.'}
    return resolved, control


def main(observer=None, scope=None):
    p = argparse.ArgumentParser()
    p.add_argument('--inputs', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--checkpoint', type=Path, required=True)
    p.add_argument('--reference-receipt', type=Path, required=True,
                   help='Completed native control binding these exact inputs and checkpoint')
    p.add_argument('--browser-library', type=Path,
                   help='Separate control: use the exact processed SMILES recorded by this browser library')
    a = p.parse_args()
    a.output.mkdir(parents=True)
    started = time.monotonic()
    started_at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    spec = json.loads((a.inputs / 'comparison.json').read_bytes())
    import torch
    assert os.environ.get('SLURM_JOB_ID') and torch.cuda.is_available() and torch.cuda.device_count() == 1
    assert importlib.metadata.version('openfold3') == '0.5.1'
    reference = json.loads(a.reference_receipt.read_bytes())
    assert reference['status'] == 'complete' and reference['method'] == 'openbind0'
    assert reference['inputSha256'] == digest(a.inputs / 'comparison.json')
    input_hashes = {str(f.relative_to(a.inputs)): digest(f) for f in a.inputs.rglob('*') if f.is_file()}
    assert input_hashes == reference['inputFiles'], 'Frozen native control inputs changed'
    assert digest(a.checkpoint) == reference['checkpointSha256']
    cache = Path(os.environ['OPENFOLD_CACHE'])
    assert cache.is_dir() and not (cache / 'runner.yml').exists(), 'No user-default runner may leak into this audit'
    query, _ = resolved_input_files(a.inputs, a.output, spec)
    processed_control = None
    if a.browser_library:
        library_bytes = a.browser_library.read_bytes()
        resolved, processed_control = processed_smiles_query(
            spec, json.loads(library_bytes), json.loads(query.read_bytes()))
        processed_control['sourceLibrarySha256'] = hashlib.sha256(library_bytes).hexdigest()
        query = a.output / 'processed-smiles-query.json'
        query.write_text(json.dumps(resolved, indent=2) + '\n')
    runner = json.loads((a.inputs / 'openbind-torch-standard.yaml').read_bytes())
    runner['experiment_settings']['seeds'] = [0]
    runner['data_module_args']['data_seed'] = 42
    runner_file = a.output / 'capture-runner.json'
    runner_file.write_text(json.dumps(runner, indent=2) + '\n')
    from openfold3.projects.of3_all_atom.model import OpenFold3
    from openfold3.projects.of3_all_atom.runner import OpenFold3AllAtom
    from openfold3.run_openfold import cli
    record = {'schema': 'molarium.native-feature-capture-receipt.v1', 'status': 'running',
              'scope': scope or 'Feature-only capture; no model forward, sampling, confidence evaluation or pose prediction.',
              'startedAt': started_at,
              'receiptCreatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'elapsedSecondsScope': 'From output-directory creation, including imports, validation, CLI setup and the requested capture.',
              'scriptSha256': digest(__file__), 'inputSha256': digest(a.inputs / 'comparison.json'),
              'inputResolverSha256': digest(inspect.getsourcefile(resolved_input_files)),
              'referenceNativeReceiptSha256': digest(a.reference_receipt),
              'inputFiles': input_hashes,
              'checkpointSha256': digest(a.checkpoint), 'captureRunnerSha256': digest(runner_file),
              'resolvedQuerySha256': digest(query), 'processedSmilesControl': processed_control,
              'seedSubset': [0], 'dataSeed': 42, 'slurmJobId': os.environ['SLURM_JOB_ID'],
              'environment': {'python': platform.python_version(), 'gpu': torch.cuda.get_device_name(0),
                              'packages': {n: importlib.metadata.version(n) for n in
                                           ['torch', 'openfold3', 'numpy', 'rdkit', 'biotite']}},
              'sourceFiles': {str(Path(inspect.getsourcefile(c))).split('/openfold3/', 1)[-1]:
                              digest(inspect.getsourcefile(c)) for c in [OpenFold3, OpenFold3AllAtom]},
              'capturedBatches': 0, 'forwardCalls': 0}
    if observer is not None:
        record['observerSourceSha256'] = digest(inspect.getsourcefile(observer))
    receipt = a.output / 'receipt.json'
    receipt.write_text(json.dumps(record, indent=2) + '\n')

    def forbidden_forward(self, *args, **kwargs):
        record['forwardCalls'] += 1
        raise RuntimeError('Feature-only audit must not execute a model forward')

    def capture(self, batch, batch_idx):
        assert batch.get('valid_sample'), 'Official pipeline did not produce a valid sample'
        assert record['capturedBatches'] == 0, 'Expected exactly one query at one seed'
        manifest = freeze_features(batch, a.output / 'features')
        b = {k: v[0].detach().cpu() for k, v in batch.items() if hasattr(v, 'detach')}
        chars = b['ref_atom_name_chars'].argmax(-1).numpy()
        counts = b['num_atoms_per_token'].numpy().astype(int)
        start = b['start_atom_index'].numpy().astype(int)
        assert np.array_equal(start, np.concatenate([[0], np.cumsum(counts)[:-1]]))
        names = [''.join(chr(int(c) + 32) for c in row).strip() for row in chars]
        assert len(names) == int(counts.sum())
        layout = {'atomNames': names, 'atomTokens': np.repeat(np.arange(len(counts)), counts).tolist(),
                  'atomMask': b['atom_mask'].numpy().tolist(), 'tokenMask': b['token_mask'].numpy().tolist()}
        (a.output / 'features/layout.json').write_text(json.dumps(layout, indent=2) + '\n')
        if observer is not None:
            observer(self, batch, a, record)
        record['capturedBatches'] += 1
        record['capturedArrays'] = len(manifest['arrays'])
        record['unserializedMetadata'] = manifest['unserializedMetadata']
        record['matmulPrecisionAtCapture'] = torch.get_float32_matmul_precision()
        return None  # The stock writer skips a None result.

    OpenFold3.forward = forbidden_forward
    OpenFold3AllAtom.predict_step = capture
    try:
        cli(args=['predict', '--query_json', str(query), '--runner_yaml', str(runner_file),
                  '--output_dir', str(a.output / 'cli'), '--inference_ckpt_path', str(a.checkpoint),
                  '--num_diffusion_samples', '1', '--use_msa_server', 'False',
                  '--use_templates', 'False', '--cluster_environment', 'slurm'], standalone_mode=False)
        assert record['capturedBatches'] == 1 and record['forwardCalls'] == 0
        record['outputs'] = [{'path': str(f.relative_to(a.output)), 'sha256': digest(f), 'bytes': f.stat().st_size}
                             for f in sorted((a.output / 'features').iterdir()) if f.is_file()]
        record['status'] = 'complete'
    except BaseException as error:
        record.update(status='failed', error=repr(error))
        raise
    finally:
        record['elapsedSeconds'] = time.monotonic() - started
        record['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        receipt.write_text(json.dumps(record, indent=2, allow_nan=False) + '\n')


if __name__ == '__main__':
    main()
