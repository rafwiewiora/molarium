"""Prepare stock-trained trunk weights and observed per-cycle controls.

Only pinned upstream weight-layout converters are executed. Expected seams
come from the native capture, never from a second implementation of the model.
The one derived seam is the documented FP32 sum of observed z and template term.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import numpy as np

from feature_snapshot import load_snapshot
from capture_native_features import freeze_features
from compare_feature_snapshots import NATIVE_TO_BROWSER
from make_trained_target_fixture import converter, PINS


def main():
    p = argparse.ArgumentParser()
    for name in ['native', 'target-fixture', 'converter-root', 'output']:
        p.add_argument('--' + name, type=Path, required=True)
    a = p.parse_args()
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    parent = json.loads((a.native / 'receipt.json').read_bytes())
    root = a.native / 'trained-trunk'
    receipt = json.loads((root / 'receipt.json').read_bytes())
    assert parent['status'] == receipt['status'] == 'complete'
    assert parent['forwardCalls'] == receipt['fullModelForwardCalls'] == 0
    assert receipt['cyclesRequested'] == 4
    assert receipt['strictPrecision'] == {'matmul': 'highest', 'cudaTf32': False, 'cudnnTf32': False}
    native, native_manifest = load_snapshot(a.native / 'features')
    assert native_manifest['blob']['sha256'] == receipt['featureBlobSha256']
    target_receipt = json.loads((a.target_fixture / 'receipt.json').read_bytes())
    batch, _ = load_snapshot(a.target_fixture / 'controlled-batch')
    target = np.frombuffer((a.target_fixture / 'expected-target.bin').read_bytes(), dtype='<f4')
    assert sha(a.target_fixture / 'expected-target.bin') == target_receipt['expectedTargetSha256']
    assert batch['tokens'] == native['token_mask'].shape[-1]
    assert np.array_equal(batch['tokenIndex'], native['token_index'][0])
    assert np.array_equal(batch['entityId'], native['entity_id'][0])
    state, _ = load_snapshot(root / 'weights')
    c = converter(a.converter_root)
    params = {}
    for fn in [c.map_evoformer_input_embeddings, c.map_msa_stack, c.map_pairformer_stack,
               c.map_template_embedder, c.map_distogram_head]:
        fn(state, params)
    a.output.mkdir()
    payload = bytearray()
    tensors = {}
    for scope, leaves in sorted(params.items()):
        for name, value in sorted(leaves.items()):
            array = np.asarray(value, dtype='<f4')
            raw = array.tobytes()
            tensors[scope + '/' + name] = {
                'shape': list(array.shape), 'dtype': 'float32', 'byteOffset': len(payload),
                'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
            payload.extend(raw)
    (a.output / 'weights.bin').write_bytes(payload)
    (a.output / 'weights.json').write_text(json.dumps({
        'model': {'name': 'openbind0'}, 'tensors': tensors,
        'blob': {'file': 'weights.bin', 'bytes': len(payload),
                 'sha256': hashlib.sha256(payload).hexdigest()}}, indent=2) + '\n')
    shutil.copy2(a.target_fixture / 'expected-target.bin', a.output / 'target.bin')
    # Require the captured empty-template convention, rather than guessing it.
    assert np.all(native['template_restype'] == 31)
    for name in ['template_pseudo_beta_mask', 'template_backbone_frame_mask',
                 'template_pseudo_beta_coords', 'template_frame_atom_coords']:
        assert not np.any(native[name])
    base = {k: batch[k] for k in ['tokens', 'features', 'asymId', 'seqMask', 'isDna', 'isLigand', 'aatype', 'ligandSpans']}
    base['features'] = {k: np.asarray(v, dtype=np.int32) for k, v in base['features'].items()}
    assert all(np.array_equal(v, batch['features'][k]) for k, v in base['features'].items())
    base['asymId'] = np.asarray(base['asymId'], dtype=np.int32)
    assert np.array_equal(base['asymId'], batch['asymId'])
    base['bondMatrix'] = native['token_bonds'][0].astype(np.float32).reshape(-1)
    base['pairMask'] = (native['token_mask'][0, :, None] * native['token_mask'][0, None, :]).reshape(-1)
    base['templates'] = native['template_restype'].shape[1]
    freeze_features(base, a.output / 'base')
    seams = {}
    def observed(name, cycle):
        records = [r for r in receipt['seams'] if r['name'] == name and r['call'] == cycle]
        assert len(records) == 1
        values, manifest = load_snapshot(root / records[0]['directory'])
        assert manifest['blob'] == records[0]['blob']
        return values
    def expected(name, value, cycle, derivation='Direct stock-native module boundary.'):
        value = np.asarray(value, dtype='<f4')
        file = f'cycle-{cycle}.{name}.bin'
        (a.output / file).write_bytes(value.tobytes())
        seams[f'cycle-{cycle}.{name}'] = {'file': file, 'shape': list(value.shape),
            'bytes': value.nbytes, 'sha256': sha(a.output / file), 'derivation': derivation}
    native_target = observed('input-embedder', 0)['s_input'][0]
    assert not np.any(native_target[:, [384 + 30, 416 + 30]]), 'Omitted unknown-DNA features are not zero'
    remap = c._AF3_TO_OF3_AATYPE
    native_target = native_target[:, np.concatenate([384 + remap, 416 + remap, [448], np.arange(384)])]
    assert np.array_equal(native_target.reshape(-1), target), 'Reused target differs from this actual native trunk input'
    for cycle in range(4):
        raw = observed('msa-selected-features', cycle)['input'][0]
        assert raw.shape[-1] == 34 and np.all(raw[..., :32].sum(-1) == 1)
        native_codes = raw[..., :32].argmax(-1)
        assert not np.any(native_codes == 30), 'No silent unknown-DNA collapse'
        codes = NATIVE_TO_BROWSER[native_codes]
        # Recover declared integer deletion counts, then verify every native value.
        counts = np.rint(3 * np.tan(raw[..., 33].astype(np.float64) * np.pi / 2)).astype(np.float32)
        assert np.all(counts >= 0) and np.array_equal(raw[..., 32], counts > 0)
        assert np.allclose(raw[..., 33], np.arctan(counts / 3) * (2 / np.pi), atol=1e-7, rtol=0)
        mask = observed('msa-embedding', cycle)['msa_mask'][0]
        freeze_features({'sequences': raw.shape[0], 'msaRows': codes.astype(np.int32).reshape(-1),
                         'deletionMatrix': counts.reshape(-1), 'msaMask': mask.reshape(-1)},
                        a.output / f'msa-{cycle}')
        z = observed('template-input', cycle)['z'][0]
        term = observed('template-output', cycle)['template_term'][0]
        expected('tap.z_init_generic', z, cycle)
        expected('tap.template_term', term, cycle)
        expected('tap.z_after_template', z + term, cycle,
                 'FP32 sum of observed template-input z and observed template output, matching the stock run_trunk add.')
        expected('tap.msa_activations', observed('msa-embedding', cycle)['m'][0], cycle)
        expected('tap.z_after_msa', observed('msa-stack', cycle)['z'][0], cycle)
        pairformer = observed('pairformer-output', cycle)
        expected('tap.trunk_in_single', observed('pairformer-input', cycle)['s'][0], cycle)
        expected('tap.trunk_out_pair', pairformer['z'][0], cycle)
        expected('trunk-output-single', pairformer['s'][0], cycle)
    record = {
        'schema': 'molarium.trained-trunk-fixture.v1',
        'scope': 'Four production GPU trunk passes with exact native target features, actual sampled MSA values and full-FP32 stock trained weights. No denoising, confidence, quantized whole-model, pose or throughput claim.',
        'nativeReceiptSha256': sha(a.native / 'receipt.json'),
        'trunkReceiptSha256': sha(root / 'receipt.json'), 'targetSha256': sha(a.output / 'target.bin'),
        'weightConverterRevision': 'e68d628df1d815cccb48bb1118d8763a594bfa23',
        'weightConverterFiles': PINS, 'cycles': 4, 'expectedSeams': seams,
        'gatesDeclaredBeforeRun': {'relativeRms': 1e-4, 'maxAbsoluteDifference': 1e-3, 'requireFinite': True},
        'timingScope': 'All browser readbacks/hooks and uploads included; not a speed benchmark.',
        'scriptSha256': sha(Path(__file__)),
    }
    (a.output / 'receipt.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps({'weights': len(tensors), 'weightBytes': len(payload), 'seams': len(seams)}))


if __name__ == '__main__':
    main()
