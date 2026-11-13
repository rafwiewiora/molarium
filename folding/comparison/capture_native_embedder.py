"""Export a trained stock input embedder, exact inputs, weights and outputs.

This runs only the official learned input embedder and relpos function. The
whole model forward is forbidden by the shared CLI capture driver. No trunk,
denoiser, confidence computation or pose prediction is requested.
"""
import hashlib
import inspect
import json
from pathlib import Path
import time
import os
from capture_native_features import main, freeze_features


def export_embedder(runner, batch, args, record):
    import torch
    from openfold3.core.utils.relpos import relpos_complex
    control = Path(os.environ['MOLARIUM_FEATURE_CONTROL'])
    parent = json.loads((control / 'receipt.json').read_bytes())
    assert parent['status'] == 'complete' and parent['forwardCalls'] == 0
    assert parent['checkpointSha256'] == record['checkpointSha256']
    assert parent['processedSmilesControl']['sourceLibrarySha256'] == record['processedSmilesControl']['sourceLibrarySha256']
    current_manifest = json.loads((args.output / 'features/features.json').read_bytes())
    parent_manifest = json.loads((control / 'features/features.json').read_bytes())
    assert current_manifest['blob'] == parent_manifest['blob'], 'Recreated feature tensor bytes differ from the frozen processed-SMILES control'
    record['parentFeatureControlReceiptSha256'] = hashlib.sha256((control / 'receipt.json').read_bytes()).hexdigest()
    model = runner.model
    assert not model.training and not model.input_embedder.training
    # Strict arithmetic control after the CLI's own startup precision setting.
    torch.set_float32_matmul_precision('highest')
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    assert all(p.dtype == torch.float32 for p in model.input_embedder.parameters())
    directory = args.output / 'trained-embedder'; directory.mkdir()
    state = {k:v.detach().cpu().clone() for k,v in model.input_embedder.state_dict().items()}
    weights = freeze_features(state, directory / 'weights')
    calls = []
    def count(module, inputs, output):
        calls.append(type(module).__qualname__)
    handle = model.input_embedder.register_forward_hook(count)
    torch.cuda.synchronize(); started = time.monotonic()
    try:
        with torch.inference_mode(), torch.autocast(device_type='cuda', enabled=False):
            s_input, s_init, z_init = model.input_embedder(
                batch=batch, inplace_safe=False, use_high_precision_attention=True)
        torch.cuda.synchronize(); elapsed = time.monotonic() - started
        with torch.inference_mode():
            relative = relpos_complex(batch, model.input_embedder.max_relative_idx,
                                      model.input_embedder.max_relative_chain)
    finally:
        handle.remove()
    assert len(calls) == 1
    values = {'s_input': s_input.detach().clone(), 's_init': s_init.detach().clone(),
              'z_init': z_init.detach().clone(), 'relative_position_features': relative.detach().clone()}
    assert all(torch.isfinite(v).all() for v in values.values())
    outputs = freeze_features(values, directory / 'outputs')
    def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
    sources = {}
    for cls in [type(model.input_embedder), type(model.input_embedder.atom_attn_enc), relpos_complex]:
        path=Path(inspect.getsourcefile(cls));sources[str(path).split('/openfold3/',1)[-1]]=digest(path)
    receipt = {'scope':'Trained official input embedder only; strict FP32. Not a full-model parity verdict.',
               'embedderForwardCalls':len(calls), 'fullModelForwardCalls':record['forwardCalls'],
               'strictPrecision':{'matmul':torch.get_float32_matmul_precision(),
                   'cudaTf32':torch.backends.cuda.matmul.allow_tf32,'cudnnTf32':torch.backends.cudnn.allow_tf32,
                   'parameterDtypes':sorted({str(v.dtype)for v in state.values()})},
               'cudaSynchronizedEmbedderForwardSeconds':elapsed, 'sourceFiles':sources,
               'maxRelativeIndex':model.input_embedder.max_relative_idx,
               'maxRelativeChain':model.input_embedder.max_relative_chain,
               'weightsBlobSha256':weights['blob']['sha256'], 'outputsBlobSha256':outputs['blob']['sha256'],
               'files':[{'path':str(p.relative_to(args.output)), 'bytes':p.stat().st_size,'sha256':digest(p)}
                        for p in sorted(directory.rglob('*'))if p.is_file()]}
    (directory/'receipt.json').write_text(json.dumps(receipt,indent=2,allow_nan=False)+'\n')
    record['trainedEmbedder'] = receipt


if __name__=='__main__':
    main(observer=export_embedder,
         scope='Exposed feature capture plus one trained official input-embedder call; full-model forward, trunk, sampling, confidence and pose prediction are forbidden.')
