"""Replay a separately scoped Bun CPU target-feature control; no neural execution."""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile
import numpy as np
from check_trained_target import unpack_evidence, metric
from feature_snapshot import load_snapshot
from make_trained_target_fixture import converter
from compare_feature_snapshots import atom_name_codes, alphabet_profile, NATIVE_TO_BROWSER


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def bound_path(root, name):
    path = (root / name).resolve()
    require(path.is_relative_to(root.resolve()), 'Evidence path escapes root')
    return path


def check(root):
    root = Path(root)
    report = json.loads((root / 'measurement/receipt.json').read_bytes())
    plan_path = root / 'measurement/frozen-plan.json'
    plan = json.loads(plan_path.read_bytes())
    require(report['schema'] == 'molarium.matched-trained-target-cpu.v1', 'Unknown CPU control')
    require(report['status'] == 'complete' and report['componentForwardCalls'] == 1
            and report['fullModelForwardCalls'] == 0 and report['gpuRequests'] == 0,
            'Requires one CPU component call and zero whole-model/GPU calls')
    require(plan['deviceArgument'] == 'omitted' and plan['fullModelForwardCalls'] == 0,
            'CPU-only execution boundary changed')
    require(digest(plan_path) == report['frozenPlanSha256'], 'Frozen measurement plan changed')
    item = report['output']
    actual_path = bound_path(root / 'measurement', item['file'])
    require(actual_path.stat().st_size == item['bytes'] and digest(actual_path) == item['sha256'],
            'Measured CPU output changed')
    fixture = root / 'fixture'
    fr = json.loads((fixture / 'receipt.json').read_bytes())
    require(digest(fixture / 'receipt.json') == report['fixtureReceiptSha256']
            == plan['fixtureReceiptSha256'], 'Fixture receipt changed')
    gates = {'relativeRms': 1e-4, 'maxAbsoluteDifference': 1e-3, 'requireFinite': True}
    require(report['gates'] == plan['gates'] == fr['gatesDeclaredBeforeRun'] == gates,
            'Predeclared gates changed')
    for name, sha in plan['fixturePins'].items():
        require(digest(bound_path(fixture, name)) == sha, 'Frozen fixture changed: ' + name)
    metadata = json.loads((root / 'native-evidence.json').read_bytes())['archive']
    require(metadata['bytes'] <= 64 * 1024**2 and len(metadata['files']) <= 400
            and sum(f['bytes'] for f in metadata['files']) <= 200 * 1024**2,
            'Native archive exceeds this component-control scope')
    with tempfile.TemporaryDirectory() as directory:
        unpacked = Path(directory)
        inventory = unpack_evidence(root, unpacked)
        native = unpacked / 'native'
        nr = json.loads((native / 'receipt.json').read_bytes())
        require(nr['status'] == 'complete' and nr['forwardCalls'] == 0
                and nr['trainedEmbedder']['embedderForwardCalls'] == 1
                and nr['trainedEmbedder']['fullModelForwardCalls'] == 0,
                'Completed native component-only capture required')
        precision = nr['trainedEmbedder']['strictPrecision']
        require(precision['matmul'] == 'highest' and not precision['cudaTf32']
                and not precision['cudnnTf32'] and precision['parameterDtypes'] == ['torch.float32'],
                'Native strict precision changed')
        require(digest(native / 'receipt.json') == fr['nativeReceiptSha256'], 'Native parent changed')
        require((root / 'native-receipt.json').read_bytes() == (native / 'receipt.json').read_bytes(),
                'Published native receipt changed')
        for f in nr['outputs'] + nr['trainedEmbedder']['files']:
            path = bound_path(native, f['path'])
            require(path.stat().st_size == f['bytes'] and digest(path) == f['sha256'],
                    'Native output changed: ' + f['path'])
        source = unpacked / 'consumed-native-stage'
        manifest = json.loads((source / 'source-manifest.json').read_bytes())
        for name, sha in manifest.items():
            require(digest(bound_path(source, name)) == sha, 'Consumed native source changed: ' + name)
        for key, name in [('scriptSha256', 'capture_native_features.py'),
                          ('observerSourceSha256', 'capture_native_embedder.py'),
                          ('inputResolverSha256', 'native_run.py')]:
            require(digest(source / name) == nr[key], 'Native producer changed: ' + name)
        inputs = source / 'inputs/32qy-a1keo'
        for name, sha in nr['inputFiles'].items():
            require(digest(bound_path(inputs, name)) == sha, 'Consumed input changed: ' + name)
        reference = source / 'references/32qy-a1keo.json'
        require(digest(reference) == nr['referenceNativeReceiptSha256'], 'Original native control changed')
        require(json.loads(reference.read_bytes())['checkpointSha256'] == nr['checkpointSha256'],
                'Checkpoint identity changed')
        require(digest(native / 'processed-smiles-query.json') == nr['resolvedQuerySha256'],
                'Resolved processed-SMILES query changed')
        require(digest(source / 'browser-library.json') == nr['processedSmilesControl']['sourceLibrarySha256'],
                'Processed-SMILES source library changed')
        first = unpacked / 'first-run'
        require(digest(first / 'run.mjs') == plan['runnerSha256'] == report['runnerSha256'],
                'Consumed measurement runner changed')
        require(digest(first / 'make_trained_target_fixture.py') == fr['scriptSha256'],
                'Consumed converter runner changed')
        for name, sha in plan['sourcePins'].items():
            require(digest(bound_path(unpacked / 'production-source', name)) == sha,
                    'Consumed production source changed: ' + name)
        n, _ = load_snapshot(native / 'features')
        state, _ = load_snapshot(native / 'trained-embedder/weights')
        out, _ = load_snapshot(native / 'trained-embedder/outputs')
        controlled, _ = load_snapshot(fixture / 'controlled-batch')
        active = np.flatnonzero(controlled['predDenseAtomMask'])
        require(np.array_equal(n['atom_to_token_index'][0], active // controlled['dense'])
                and np.all(n['atom_mask'] == 1) and not np.any(n['is_rna']) and not np.any(n['is_dna']),
                'Atom/token correspondence changed')
        for nk, bk in [('ref_pos', 'refPos'), ('ref_mask', 'refMask'),
                       ('ref_charge', 'refCharge'), ('ref_space_uid', 'refSpaceUid')]:
            target = controlled[bk].reshape((-1, 3) if nk == 'ref_pos' else (-1,))
            require(np.array_equal(target[active], n[nk][0]), 'Native feature bytes changed: ' + nk)
        require(np.array_equal(controlled['refElement'][active], n['ref_element'][0].argmax(-1) + 1),
                'Element features changed')
        require(np.array_equal(controlled['refAtomNameChars'].reshape(-1, 4)[active],
                               atom_name_codes(n['ref_atom_name_chars'][0])), 'Atom names changed')
        require(np.array_equal(controlled['aatype'], NATIVE_TO_BROWSER[n['restype'][0].argmax(-1)])
                and np.array_equal(controlled['profile'].reshape(-1, 31), alphabet_profile(n['profile'][0]))
                and np.array_equal(controlled['deletionMean'], n['deletion_mean'][0]),
                'Copied type/profile/deletion features changed')
        c = converter(unpacked / 'converter-source')
        params = {}
        c.map_evoformer_conditioning({'input_embedder.' + k: v for k, v in state.items()}, params)
        expected_weights = {scope + '/' + name: value
                            for scope, leaves in params.items() for name, value in leaves.items()}
        wm = json.loads((fixture / 'weights.json').read_bytes())
        wb = (fixture / 'weights.bin').read_bytes()
        require(len(wb) == wm['blob']['bytes'] and hashlib.sha256(wb).hexdigest() == wm['blob']['sha256']
                and wm['tensors'].keys() == expected_weights.keys(), 'Converted weight coverage changed')
        for name, value in expected_weights.items():
            r = wm['tensors'][name]
            raw = wb[r['byteOffset']:r['byteOffset'] + r['bytes']]
            require(raw == np.asarray(value, dtype='<f4').tobytes()
                    and hashlib.sha256(raw).hexdigest() == r['sha256']
                    and r['shape'] == list(value.shape), 'Trained weight mapping changed: ' + name)
        eraw = (fixture / 'expected-target.bin').read_bytes()
        require(hashlib.sha256(eraw).hexdigest() == fr['expectedTargetSha256'], 'Expected target changed')
        expected = np.frombuffer(eraw, dtype='<f4').reshape(fr['expectedShape'])
        order = np.concatenate([384 + c._AF3_TO_OF3_AATYPE, 416 + c._AF3_TO_OF3_AATYPE,
                                [448], np.arange(384)])
        require(np.array_equal(expected, out['s_input'][0][:, order])
                and np.all(out['s_input'][0][:, [414, 446]] == 0), 'Native channel mapping changed')
        require(report['expectedShape'] == fr['expectedShape'], 'Measured shape changed')
        actual = np.frombuffer(actual_path.read_bytes(), dtype='<f4').reshape(fr['expectedShape'])
        results = {}
        for key, start in [('fullTarget', 0), ('learnedAtomChannels', 63)]:
            computed = metric(actual[:, start:], expected[:, start:])
            saved = report[key]
            require(computed['finite'] and saved['finite'] and computed['values'] == saved['values']
                    and abs(computed['relativeRms'] - saved['relativeRms']) < 1e-18
                    and computed['maxAbs'] == saved['maxAbsoluteDifference'],
                    'Reported CPU error does not reproduce: ' + key)
            results[key] = computed
        require(results['learnedAtomChannels']['referenceRms'] > 1e-3,
                'Degenerate learned reference channels')
        prefix_exact = bool(np.array_equal(actual[:, :63], expected[:, :63]))
        require(prefix_exact and report['copiedPrefixExact'], 'Copied feature prefix changed')
        full = results['fullTarget']
        passes = full['finite'] and full['relativeRms'] <= gates['relativeRms'] and full['maxAbs'] <= gates['maxAbsoluteDifference']
        require(passes == report['passes'], 'Reported predeclared gate does not reproduce')
    return {'scope': report['scope'], 'passes': passes, 'nativeFiles': len(inventory['files']),
            'mappedWeightTensors': len(expected_weights), 'productionFiles': len(plan['sourcePins']),
            'copiedPrefixExact': prefix_exact, **results}


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('root', type=Path)
    print(json.dumps(check(p.parse_args().root)))
