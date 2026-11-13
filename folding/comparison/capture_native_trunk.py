"""Observe one stock OpenFold3 trunk with exact features, weights and MSA draws.

No neural forward is reimplemented. Hooks serialize the actual native module
boundaries. A module-local torch proxy records and returns unmodified MSA RNG
draws; it neither changes global torch nor substitutes random numbers. Whole
model forward, diffusion, confidence and pose prediction remain forbidden.
"""
import hashlib
import inspect
import json
import os
from pathlib import Path
import time

from capture_native_features import freeze_features, main


def export_trunk(runner, batch, args, record):
    import torch
    import openfold3.core.model.feature_embedders.input_embedders as feature_module

    control = Path(os.environ['MOLARIUM_FEATURE_CONTROL'])
    parent = json.loads((control / 'receipt.json').read_bytes())
    assert parent['status'] == 'complete' and parent['forwardCalls'] == 0
    assert parent['checkpointSha256'] == record['checkpointSha256']
    assert parent['processedSmilesControl'] == record['processedSmilesControl']
    current = json.loads((args.output / 'features/features.json').read_bytes())
    expected = json.loads((control / 'features/features.json').read_bytes())
    assert current['blob'] == expected['blob'], 'Native feature bytes changed'
    model = runner.model
    assert not model.training
    torch.set_float32_matmul_precision('highest')
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    assert all(p.dtype == torch.float32 for p in model.parameters())
    directory = args.output / 'trained-trunk'
    directory.mkdir()
    digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    receipt = {
        'schema': 'molarium.native-trunk-capture.v1', 'status': 'running',
        'scope': 'One stock run_trunk, four cycles, strict FP32; observational seams and actual MSA random draws. No diffusion, confidence, pose or throughput result.',
        'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'cyclesRequested': 4, 'fullModelForwardCalls': record['forwardCalls'],
        'parentFeatureReceiptSha256': digest(control / 'receipt.json'),
        'featureBlobSha256': current['blob']['sha256'],
        'strictPrecision': {'matmul': torch.get_float32_matmul_precision(),
                            'cudaTf32': False, 'cudnnTf32': False},
        'seams': [], 'msaDraws': [], 'sourceFiles': {},
    }
    receipt_path = directory / 'receipt.json'
    def save():
        receipt_path.write_text(json.dumps(receipt, indent=2, allow_nan=False) + '\n')
    save()
    counters = {}
    handles = []
    original_torch = feature_module.torch
    def capture(name, values, group='seams'):
        index = counters.get(name, 0)
        counters[name] = index + 1
        relative = f'{name}-{index:02d}'
        manifest = freeze_features(values, directory / relative)
        assert all(not d.get('nonFiniteValues', 0) for d in manifest['arrays'].values())
        receipt[group].append({'name': name, 'call': index, 'directory': relative,
                               'blob': manifest['blob']})
        save()

    class MsaTorchObserver:
        def __getattr__(self, name):
            value = getattr(original_torch, name)
            if name not in ('randint', 'randperm'):
                return value
            def draw(*a, **kw):
                output = value(*a, **kw)
                capture('msa-rng-' + name, {'value': output}, 'msaDraws')
                return output
            return draw

    def output_hook(name, labels):
        def hook(module, positional, kwargs, output):
            values = dict(zip(labels, output, strict=True)) if isinstance(output, tuple) else {labels[0]: output}
            capture(name, values)
        return hook
    def before_hook(name, labels):
        def hook(module, positional, kwargs):
            parameters = list(inspect.signature(module.forward).parameters)
            values = dict(zip(parameters, positional, strict=False)) | kwargs
            capture(name, {label: values[label] for label in labels})
        return hook
    def add_output(name, module, labels):
        handles.append(module.register_forward_hook(output_hook(name, labels), with_kwargs=True))
    def add_before(name, module, labels):
        handles.append(module.register_forward_pre_hook(before_hook(name, labels), with_kwargs=True))
    started = time.monotonic()
    try:
        prefixes = ('input_embedder.', 'layer_norm_z.', 'linear_z.', 'layer_norm_s.',
                    'linear_s.', 'template_embedder.', 'msa_module_embedder.',
                    'msa_module.', 'pairformer_stack.', 'aux_heads.distogram.')
        state = {name: value for name, value in model.state_dict().items()
                 if name.startswith(prefixes)}
        assert state and not any('diffusion' in name or 'confidence' in name for name in state)
        freeze_features(state, directory / 'weights')
        receipt['weightTensorCount'] = len(state)
        receipt['weightScope'] = list(prefixes)
        receipt['distogramWeightsNote'] = 'Exported for the browser trunk loader; the native distogram head is not executed by run_trunk and is not qualified here.'
        for module in (model, model.input_embedder, model.template_embedder,
                       model.msa_module_embedder, model.msa_module, model.pairformer_stack):
            path = Path(inspect.getsourcefile(type(module)))
            receipt['sourceFiles'][str(path).split('/openfold3/', 1)[-1]] = digest(path)
        add_output('input-embedder', model.input_embedder, ['s_input', 's_init', 'z_init'])
        add_before('template-input', model.template_embedder, ['z'])
        add_output('template-output', model.template_embedder, ['template_term'])
        # The actual 34-column features after stock MSA sampling, before projection.
        add_before('msa-selected-features', model.msa_module_embedder.linear_m, ['input'])
        add_output('msa-embedding', model.msa_module_embedder, ['m', 'msa_mask'])
        add_output('msa-stack', model.msa_module, ['z'])
        add_before('pairformer-input', model.pairformer_stack, ['s', 'z'])
        add_output('pairformer-output', model.pairformer_stack, ['s', 'z'])
        assert original_torch is torch
        feature_module.torch = MsaTorchObserver()
        seeds = batch['seed'].cpu().tolist()
        assert seeds == [0]
        runner.reseed(seeds[0])  # Same stock predict_step RNG boundary.
        with torch.inference_mode(), torch.autocast(device_type='cuda', enabled=False):
            outputs = model.run_trunk(batch=batch, num_cycles=4, inplace_safe=False)
        torch.cuda.synchronize()
        capture('trunk-output', dict(zip(['s_input', 's', 'z'], outputs, strict=True)))
        assert counters['input-embedder'] == 1 and counters['pairformer-output'] == 4
        assert counters['msa-selected-features'] == 4
        assert record['forwardCalls'] == 0
        receipt.update(status='complete', calls=counters)
        record['trainedTrunk'] = receipt
    except BaseException as error:
        receipt.update(status='failed', error=repr(error), calls=counters)
        raise
    finally:
        feature_module.torch = original_torch
        for handle in handles:
            handle.remove()
        receipt['instrumentedElapsedSeconds'] = time.monotonic() - started
        receipt['elapsedScope'] = 'Includes weight export, serialization, GPU synchronizations and all seam/RNG hooks; not inference throughput.'
        receipt['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        save()


if __name__ == '__main__':
    main(observer=export_trunk,
         scope='Exact feature capture followed by one stock four-cycle run_trunk. Whole-model forward, sampling, confidence and pose inference remain forbidden.')
