"""Compare saved native relative-position outputs with the port's CPU reference.

This is a non-learned feature check. It neither executes a model nor measures
the fused WebGPU gather/projection kernel, trained embeddings or pose accuracy.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import numpy as np
from check_trained_target import unpack_evidence
from feature_snapshot import load_snapshot


NAMES = [('residue_index', 'residueIndex'), ('token_index', 'tokenIndex'),
         ('asym_id', 'asymId'), ('entity_id', 'entityId'), ('sym_id', 'symId')]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compare(features, ligand, expected, relative_index=32, relative_chain=2):
    repository = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        payload = {'tokens': len(ligand), 'features': {k: np.asarray(v).tolist() for k, v in features.items()},
                   'isLigand': np.asarray(ligand).tolist(), 'maxRelativeIndex': relative_index,
                   'maxRelativeChain': relative_chain}
        (root / 'input.json').write_text(json.dumps(payload))
        (root / 'expected.bin').write_bytes(np.asarray(expected, dtype='<f4').tobytes())
        return json.loads(subprocess.check_output([
            'node', str(repository / 'folding/comparison/compare_relative_encoding.mjs'),
            str(root / 'input.json'), str(root / 'expected.bin')], text=True))


def check(root):
    root = Path(root)
    repository = Path(__file__).resolve().parents[2]
    records = []
    for case, folder in [('9t51-a1jtm', 'trained-target'),
                         ('32qy-a1keo', 'trained-target-ythdf2-cpu')]:
        archive = root / folder
        metadata = json.loads((archive / 'native-evidence.json').read_bytes())['archive']
        if (metadata['bytes'] > 64 * 1024**2 or len(metadata['files']) > 400
                or sum(item['bytes'] for item in metadata['files']) > 200 * 1024**2):
            raise ValueError('Native feature archive exceeds this check scope')
        with tempfile.TemporaryDirectory() as directory:
            unpacked = Path(directory)
            unpack_evidence(archive, unpacked)
            native = unpacked / 'native'
            nr = json.loads((native / 'receipt.json').read_bytes())
            if nr['status'] != 'complete' or nr['forwardCalls'] != 0:
                raise ValueError('Requires a completed component-only native capture')
            if (nr['trainedEmbedder']['embedderForwardCalls'] != 1
                    or nr['trainedEmbedder']['fullModelForwardCalls'] != 0):
                raise ValueError('Native component boundary changed')
            if (archive / 'native-receipt.json').read_bytes() != (native / 'receipt.json').read_bytes():
                raise ValueError('Native parent receipt changed')
            for item in nr['outputs'] + nr['trainedEmbedder']['files']:
                path = (native / item['path']).resolve()
                if not path.is_relative_to(native.resolve()) or path.stat().st_size != item['bytes'] or sha(path) != item['sha256']:
                    raise ValueError('Native captured tensor changed')
            n, _ = load_snapshot(native / 'features')
            if (np.any(n['is_rna']) or np.any(n['is_dna'])
                    or not np.all(n['is_protein'] + n['is_ligand'] == 1)):
                raise ValueError('These pair classes require protein/ligand-only fixtures')
            outputs, _ = load_snapshot(native / 'trained-embedder/outputs')
            expected = outputs['relative_position_features'][0]
            if expected.shape != (n['token_index'].shape[-1], n['token_index'].shape[-1], 139):
                raise ValueError('Unexpected native relative-position shape')
            receipt = json.loads((native / 'trained-embedder/receipt.json').read_bytes())
            browser_root = root / ('browser-' + case)
            original, _ = load_snapshot(browser_root)
            controlled, _ = load_snapshot(archive / 'fixture/controlled-batch')
            for label, batch in [('original-browser-inputs', original), ('matched-native-inputs', controlled)]:
                if batch['tokens'] != expected.shape[0] or not np.array_equal(batch['isLigand'], n['is_ligand'][0]):
                    raise ValueError('Token/ligand correspondence changed')
                differences = {bk: int(np.count_nonzero(np.asarray(batch['features'][bk]) != n[nk][0]))
                               for nk, bk in NAMES}
                if label == 'matched-native-inputs' and any(differences.values()):
                    raise ValueError('Controlled token indices changed')
                result = compare(batch['features'], batch['isLigand'], expected,
                                 receipt['maxRelativeIndex'], receipt['maxRelativeChain'])
                records.append({'caseId': case, 'inputs': label, 'indexValueDifferences': differences,
                                'nativeArchiveSha256': metadata['sha256'],
                                'nativeReceiptSha256': sha(native / 'receipt.json'),
                                'browserFeaturesManifestSha256': sha(browser_root / 'features.json'),
                                'controlledFeaturesManifestSha256': sha(archive / 'fixture/controlled-batch/features.json'),
                                **result})
    source_names = ['folding/comparison/check_relative_encoding.py',
                    'folding/comparison/compare_relative_encoding.mjs',
                    'folding/comparison/check_trained_target.py',
                    'folding/comparison/feature_snapshot.py',
                    'vendor/localfold/cpu/af3/trunk/embedder.js',
                    'vendor/localfold/cpu/af3/trunk/pairformer.js']
    return {'schema': 'molarium.native-relative-encoding-comparison.v1',
            'scope': 'Saved native 139-channel relative-position outputs versus the unchanged port CPU reference. Original browser indices and controlled native indices checked separately. Not a fused WebGPU projection, learned embedding, whole-model or pose-accuracy test.',
            'passes': all(row['exact'] for row in records), 'neuralForwards': 0, 'gpuRequests': 0,
            'records': records, 'sourcePins': {name: sha(repository / name) for name in source_names}}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('root', type=Path)
    a = p.parse_args()
    result = check(a.root)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['passes'] else 1)
