"""Export small, nontrivial fixed-input official OpenFold3 layer references.

Random parameters test the actual module without trained weights or whole-model
inference. Full FP32 parameters and outputs are saved as exact little-endian bytes.
"""
import argparse
import hashlib
import importlib.metadata
import inspect
import json
from pathlib import Path
import platform
import numpy as np
import torch
from openfold3.core.model.layers.transition import SwiGLUTransition


def main():
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    a.output.mkdir();torch.set_num_threads(1);torch.manual_seed(5317)
    payload=bytearray();arrays={};cases=[]
    def save(name,value):
        data=np.asarray(value,dtype='<f4').tobytes(order='C');offset=len(payload);payload.extend(data)
        arrays[name]={'byteOffset':offset,'bytes':len(data),'shape':list(value.shape),
            'sha256':hashlib.sha256(data).hexdigest()};return name
    for name,channels,factor,rows in [('msa',64,4,31),('pair',128,4,17),('single',384,4,5)]:
        model=SwiGLUTransition(c_in=channels,n=factor).eval()
        with torch.no_grad():
            for key,param in model.named_parameters():
                if key=='layer_norm.weight':param.copy_(1+torch.randn_like(param)*.15)
                elif key=='layer_norm.bias':param.copy_(torch.randn_like(param)*.1)
                else:param.copy_(torch.randn_like(param)/(param.shape[-1]**.5))
        state={k:v.detach().numpy()for k,v in model.state_dict().items()}
        weights={'inputLayerNormScale':save(name+'/scale',state['layer_norm.weight']),
            'inputLayerNormOffset':save(name+'/offset',state['layer_norm.bias']),
            'transition1':save(name+'/up',np.concatenate([state['swiglu.linear_a.weight'].T,state['swiglu.linear_b.weight'].T],axis=1)),
            'transition2':save(name+'/down',state['linear_out.weight'].T)}
        variants=[('ordinary',rows,0.,1.)]
        if name=='pair':variants.extend([('tiled',1761,0.,1.),('near-constant',17,100.,.005)])
        for variant,count,offset,scale in variants:
            x=torch.randn(count,channels)*scale+offset
            with torch.inference_mode():expected=model(x).numpy()
            assert np.isfinite(expected).all()and np.sqrt(np.mean(expected**2))>1e-3
            cases.append({'id':name+'-'+variant,'shape':{'rows':count,'channels':channels,'factor':factor},
                'weights':weights,'epsilon':model.layer_norm.eps,'input':save(name+'/'+variant+'/input',x.numpy()),
                'expected':save(name+'/'+variant+'/expected',expected),'expectedRms':float(np.sqrt(np.mean(expected**2)))})
    (a.output/'fixtures.bin').write_bytes(payload)
    source=Path(inspect.getsourcefile(SwiGLUTransition))
    manifest={'schema':'molarium.official-layer-fixtures.v1','scope':'Official SwiGLU transition, FP32 CPU random parameters; no trained checkpoint or full-model parity claim.',
        'seed':5317,'environment':{'python':platform.python_version(),'torch':torch.__version__,
            'openfold3':importlib.metadata.version('openfold3'),'numpy':np.__version__},
        'source':{'repository':'https://github.com/aqlaboratory/openfold-3','revision':'795e45b03924a8f8ffc72ae50298bd113530b9d3',
            'file':'openfold3/core/model/layers/transition.py','sha256':hashlib.sha256(source.read_bytes()).hexdigest()},
        'exporterSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'blob':{'file':'fixtures.bin','bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest()},'arrays':arrays,'cases':cases}
    (a.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'cases':len(cases),'bytes':len(payload)}))


if __name__=='__main__':main()
