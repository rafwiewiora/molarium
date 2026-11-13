"""Run an immutable native cofolding comparison in an already allocated GPU job.

This wrapper changes no model mathematics. It records synchronized forward
timings and calls the official CLI with explicit inputs/settings/checkpoints.
"""
import argparse
import hashlib
import importlib.metadata as metadata
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--method', choices=['openbind0', 'boltz2'], required=True)
    parser.add_argument('--protocol', choices=['low-step', 'standard','torch-reference','torch-standard'], required=True)
    parser.add_argument('--inputs', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise RuntimeError('Use a new immutable output directory; do not overwrite or rerun consumed attempts.')
    args.output.mkdir(parents=True)
    spec = json.loads((args.inputs / 'comparison.json').read_text())
    protocol = spec['protocols'][args.protocol]
    protocol = {**protocol,'precision':protocol['precision'] if args.method=='openbind0' else 'bf16-mixed'}
    import torch
    if not os.environ.get('SLURM_JOB_ID') or not torch.cuda.is_available() or torch.cuda.device_count() != 1:
        raise RuntimeError('This experiment requires a genuine single-GPU Slurm grant.')
    versions = {}
    for package in ['torch', 'numpy', 'rdkit', 'biotite', 'openfold3', 'boltz', 'pytorch-lightning']:
        try:
            versions[package] = metadata.version(package)
        except metadata.PackageNotFoundError:
            pass
    expected = spec['native']['openfold3' if args.method == 'openbind0' else 'boltz2']['version']
    actual = versions.get('openfold3' if args.method == 'openbind0' else 'boltz')
    if actual != expected:
        raise RuntimeError(f'Wrong native runtime: {actual}; expected {expected}')
    receipt = {'schema':'molarium.native-cofold-receipt.v1','method':args.method,'protocol':args.protocol,
        'runnerSha256':digest(__file__),
        'inputFiles':{str(p.relative_to(args.inputs)):digest(p)for p in args.inputs.rglob('*')if p.is_file()},
        'inputSha256':digest(args.inputs / 'comparison.json'),'checkpointSha256':digest(args.checkpoint),
        'checkpointBytes':args.checkpoint.stat().st_size,'settings':protocol,'seeds':spec['seeds'],
        'executionConfig':{'torchinductorCompileThreads':os.environ.get('TORCHINDUCTOR_COMPILE_THREADS'),
          'slurmJobId':os.environ.get('SLURM_JOB_ID'),
          'dataModuleArgs':json.loads((args.inputs/f'openbind-{args.protocol}.yaml').read_text()).get('data_module_args',{})if args.method=='openbind0'else {'num_workers':0}},
        'environment':{'python':platform.python_version(),'packages':versions,'cuda':torch.version.cuda,
          'gpu':torch.cuda.get_device_name(0),'gpuMemoryBytes':torch.cuda.get_device_properties(0).total_memory},
        'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'status':'running'}
    (args.output / 'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    forward_times = args.output / 'forward-times.jsonl'

    def instrument(cls):
        original = cls.forward
        def measured(self, *a, **kw):
            if args.method=='openbind0':
                effective={'steps':int(self.shared.diffusion.no_full_rollout_steps),'recycles':int(self.shared.num_recycles)}
                if effective['steps']!=protocol['steps'] or effective['recycles']!=protocol['recycles']:
                    raise RuntimeError(f'Native resolved protocol mismatch: {effective}')
                receipt['resolvedProtocol']=effective
                if protocol.get('kernelBackend')=='upstream PyTorch dense' and self.config.settings.memory.eval.use_triton_triangle_kernels:
                    raise RuntimeError('The declared PyTorch reference must use the upstream dense kernel path.')
            torch.cuda.synchronize()
            started = time.perf_counter()
            result = original(self, *a, **kw)
            torch.cuda.synchronize()
            with forward_times.open('a') as f:
                f.write(json.dumps({'seconds':time.perf_counter()-started,
                    'autocastEnabled':torch.is_autocast_enabled(),
                    'peakAllocatedBytes':torch.cuda.max_memory_allocated(),
                    'peakReservedBytes':torch.cuda.max_memory_reserved()})+'\n')
            return result
        cls.forward = measured

    started = time.perf_counter()
    try:
        if args.method == 'openbind0':
            from openfold3.projects.of3_all_atom.model import OpenFold3
            instrument(OpenFold3)
            from openfold3.run_openfold import cli
            argv = ['predict','--query_json',str(args.inputs/'openbind-query.json'),
                '--runner_yaml',str(args.inputs/f'openbind-{args.protocol}.yaml'),
                '--output_dir',str(args.output/'models'),'--inference_ckpt_path',str(args.checkpoint),
                '--num_diffusion_samples','1','--use_msa_server','False','--use_templates','False',
                '--cluster_environment','slurm']
            receipt['argv'] = argv
            cli(args=argv,standalone_mode=False)
        else:
            from boltz.model.models.boltz2 import Boltz2
            instrument(Boltz2)
            from boltz.main import cli
            receipt['argv'] = []
            for seed in spec['seeds']:
                argv = ['predict',str(args.inputs/'boltz'),'--model','boltz2','--out_dir',str(args.output/f'seed-{seed}'),
                    '--cache',str(args.cache),'--checkpoint',str(args.checkpoint),
                    '--seed',str(seed),'--recycling_steps',str(protocol['recycles']),
                    '--sampling_steps',str(protocol['steps']),'--diffusion_samples','1',
                    '--max_parallel_samples','1','--output_format','mmcif','--num_workers','0']
                receipt['argv'].append(argv)
                cli(args=argv,standalone_mode=False)
        models=sorted(p for p in args.output.rglob('*') if p.is_file() and p.suffix in ['.cif','.pdb'] and '_model' in p.name)
        receipt['outputs']=[{'path':str(p.relative_to(args.output)),'sha256':digest(p),'bytes':p.stat().st_size}for p in models]
        expected_poses=len(spec['compounds'])*len(spec['seeds'])
        if len(models) != expected_poses:
            raise RuntimeError(f'Expected {expected_poses} completed poses, found {len(models)}')
        receipt['status']='complete'
    except BaseException as exc:
        receipt['status']='failed';receipt['error']=str(exc)
        raise
    finally:
        receipt['elapsedSeconds']=time.perf_counter()-started
        receipt['finishedAt']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
        (args.output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')


if __name__=='__main__':
    main()
