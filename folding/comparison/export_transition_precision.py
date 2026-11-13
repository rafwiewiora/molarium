"""Matched-weight official FP64 references for production transition precisions.

Consumes the immutable FP32 fixture rather than regenerating input or weights.
The actual pinned LocalFold quantizer encodes the two matrices; norms stay FP32
in the encoded source and are narrowed with the resident buffer, as in the port.
"""
import argparse
import hashlib
import importlib.util
import inspect
import json
from pathlib import Path
import numpy as np
import torch
from openfold3.core.model.layers.transition import SwiGLUTransition

QUANTIZER_SHA='8f75171c59e32ad7603323293839769aa149b728c6a2f8f1531dc2f6070162fa'
sha=lambda b:hashlib.sha256(b).hexdigest()


def main():
    p=argparse.ArgumentParser();p.add_argument('--fixtures',type=Path,required=True)
    p.add_argument('--quantizer',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    manifest_bytes=(a.fixtures/'manifest.json').read_bytes();base=json.loads(manifest_bytes)
    original=(a.fixtures/base['blob']['file']).read_bytes();assert sha(original)==base['blob']['sha256']
    assert sha(Path(inspect.getsourcefile(SwiGLUTransition)).read_bytes())==base['source']['sha256']
    assert sha(a.quantizer.read_bytes())==QUANTIZER_SHA
    spec=importlib.util.spec_from_file_location('pinned_localfold_quantizer',a.quantizer)
    quantizer=importlib.util.module_from_spec(spec);spec.loader.exec_module(quantizer)
    a.output.mkdir();torch.set_num_threads(1);payload=bytearray();arrays={};dedup={};families={};cases=[]
    def original_array(name):
        d=base['arrays'][name];data=original[d['byteOffset']:d['byteOffset']+d['bytes']];assert sha(data)==d['sha256']
        return np.frombuffer(data,dtype='<f4').reshape(d['shape']).copy()
    def save(name,values,dtype):
        values=np.asarray(values,dtype=dtype);data=values.tobytes();key=(sha(data),dtype,values.shape)
        if key in dedup:return dedup[key]
        payload.extend(b'\0'*(-len(payload)%8));offset=len(payload);payload.extend(data)
        arrays[name]={'byteOffset':offset,'bytes':len(data),'dtype':dtype,'shape':list(values.shape),'sha256':sha(data)}
        dedup[key]=name;return name
    def encode(values):
        codes,scales,zeros=quantizer.quantise(values.reshape(-1));packed=quantizer.pack(codes).tobytes()+b'\0'
        scale_at=(len(packed)+3)//4*4;zero_at=scale_at+scales.nbytes
        data=packed+b'\0'*(scale_at-len(packed))+scales.astype('<f2').tobytes()+zeros.astype('<f2').tobytes()
        data+=b'\0'*(-len(data)%4)
        decoded=(codes.astype(np.float64)*scales.astype(np.float64)[:,None]+zeros.astype(np.float64)[:,None]).astype(np.float32)
        return data,decoded.reshape(-1)[:values.size].reshape(values.shape),{
            'dtype':'int5','block':32,'shape':list(values.shape),'byteOffset':0,'scaleOffset':scale_at,'zeroOffset':zero_at}
    source_cases=base['cases']+[dict(c,id=c['id'].split('-')[0]+'-near-constant',derivedStress=True)
        for c in base['cases']if c['id']in ['msa-ordinary','single-ordinary']]
    for c in source_cases:
        family=c['id'].split('-')[0];channels=c['shape']['channels'];mid=channels*c['shape']['factor']
        if family not in families:
            source={k:original_array(v)for k,v in c['weights'].items()};variants={}
            for precision in ['f32','f16','int5-f16']:
                weights={};encoded={}
                for key,value in source.items():
                    if precision=='int5-f16'and key in ['transition1','transition2']:
                        data,value,record=encode(value)
                        encoded[key]={'data':save(family+'/'+key+'/codes',np.frombuffer(data,dtype=np.uint8),'|u1'),'record':record}
                    dtype='<f4'if precision=='f32'else'<f2'
                    weights[key]=save(family+'/'+precision+'/'+key,value,dtype)
                variants[precision]={'weights':weights,'encoded':encoded}
            families[family]=variants
        for precision,variant in families[family].items():
            def read(name):
                d=arrays[name];return np.frombuffer(payload,dtype=d['dtype'],count=d['bytes']//np.dtype(d['dtype']).itemsize,offset=d['byteOffset']).copy().reshape(d['shape']).astype(np.float64)
            weights={k:read(v)for k,v in variant['weights'].items()}
            model=SwiGLUTransition(c_in=channels,n=c['shape']['factor']).double().eval();model.layer_norm.eps=c['epsilon']
            state={'layer_norm.weight':weights['inputLayerNormScale'],'layer_norm.bias':weights['inputLayerNormOffset'],
                'swiglu.linear_a.weight':weights['transition1'][:,:mid].T,'swiglu.linear_b.weight':weights['transition1'][:,mid:].T,
                'linear_out.weight':weights['transition2'].T}
            model.load_state_dict({k:torch.from_numpy(v.copy())for k,v in state.items()})
            input_values=original_array(c['input'])
            if c.get('derivedStress'):input_values=(100.+.005*input_values).astype(np.float32)
            input_reference={'kind':'current','array':save(c['id']+'/input',input_values,'<f4')}if c.get('derivedStress')else{'kind':'original','array':c['input']}
            x=torch.from_numpy(input_values).double()
            with torch.inference_mode():normalized=model.layer_norm(x).numpy();expected=model(x).numpy()
            assert np.isfinite(expected).all()
            cases.append({'id':c['id']+'/'+precision,'originalCaseId':c['id'],'precision':precision,'shape':c['shape'],
                'epsilon':c['epsilon'],'inputReference':input_reference,**variant,
                'normalizedF64':save(c['id']+'/'+precision+'/normalized-f64',normalized,'<f8'),
                'expectedF64':save(c['id']+'/'+precision+'/expected-f64',expected,'<f8')})
    (a.output/'fixtures.bin').write_bytes(payload)
    manifest={'schema':'molarium.transition-precision-fixtures.v1','scope':'Actual official FP64 LayerNorm and SwiGLU transition at identical original inputs and explicitly matched resident weight values. Half scratch/accumulation errors are distinct from quantization of the weights.',
        'originalManifestSha256':sha(manifest_bytes),'originalBlobSha256':sha(original),'officialSource':base['source'],
        'environment':{'torch':torch.__version__,'numpy':np.__version__},'exporterSha256':sha(Path(__file__).read_bytes()),
        'quantizer':{'revision':'5ea3d42c911949700401b54003cb28c557fcf2a6','path':'tools/quantize_af3.py','sha256':QUANTIZER_SHA},
        'blob':{'file':'fixtures.bin','bytes':len(payload),'sha256':sha(payload)},'arrays':arrays,'cases':cases}
    (a.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'cases':len(cases),'bytes':len(payload)}))


if __name__=='__main__':main()
