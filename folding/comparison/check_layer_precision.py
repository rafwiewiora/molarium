"""Re-evaluate immutable official layer fixtures with identical values in FP64.

No random input, trained checkpoint or model inference is regenerated. The FP32
round trip must reproduce the saved official output before FP64 is evaluated.
"""
import argparse
import copy
import hashlib
import inspect
import json
from pathlib import Path
import numpy as np
import torch
from openfold3.core.model.layers.transition import SwiGLUTransition


def main():
    p=argparse.ArgumentParser();p.add_argument('--fixtures',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    manifest_bytes=(a.fixtures/'manifest.json').read_bytes();manifest=json.loads(manifest_bytes)
    blob=(a.fixtures/manifest['blob']['file']).read_bytes();sha=lambda b:hashlib.sha256(b).hexdigest()
    assert sha(blob)==manifest['blob']['sha256']
    assert sha(Path(inspect.getsourcefile(SwiGLUTransition)).read_bytes())==manifest['source']['sha256']
    def array(name):
        d=manifest['arrays'][name];data=blob[d['byteOffset']:d['byteOffset']+d['bytes']]
        assert sha(data)==d['sha256']
        return np.frombuffer(data,dtype='<f4').reshape(d['shape']).copy()
    a.output.mkdir();torch.set_num_threads(1);payload=bytearray();records=[]
    for c in manifest['cases']:
        channels=c['shape']['channels'];factor=c['shape']['factor'];mid=channels*factor
        model=SwiGLUTransition(c_in=channels,n=factor).eval();model.layer_norm.eps=c['epsilon']
        weights={k:array(v)for k,v in c['weights'].items()}
        state={'layer_norm.weight':weights['inputLayerNormScale'],'layer_norm.bias':weights['inputLayerNormOffset'],
            'swiglu.linear_a.weight':weights['transition1'][:,:mid].T,
            'swiglu.linear_b.weight':weights['transition1'][:,mid:].T,
            'linear_out.weight':weights['transition2'].T}
        model.load_state_dict({k:torch.from_numpy(v.copy())for k,v in state.items()})
        x=torch.from_numpy(array(c['input']));expected=array(c['expected'])
        with torch.inference_mode():
            reproduced=model(x).numpy();assert np.array_equal(reproduced,expected),c['id']
            reference=copy.deepcopy(model).double()(x.double()).numpy()
        assert np.isfinite(reference).all()
        error=reproduced.astype(np.float64)-reference;data=reference.astype('<f8').tobytes()
        records.append({'caseId':c['id'],'shape':list(reference.shape),'byteOffset':len(payload),'bytes':len(data),
            'sha256':sha(data),'nativeF32vsF64':{'relativeRms':float(np.linalg.norm(error)/np.linalg.norm(reference)),
                'maxAbs':float(np.abs(error).max())},'f32RoundTripExact':True})
        payload.extend(data)
    (a.output/'expected-f64.bin').write_bytes(payload)
    report={'schema':'molarium.official-layer-f64.v1','purpose':'Identical original float32 input/weight values cast to double in the actual official module; diagnoses conditioning, not a replacement for native-FP32 agreement.',
        'originalManifestSha256':sha(manifest_bytes),'originalBlobSha256':sha(blob),
        'source':manifest['source'],'torch':torch.__version__,'scriptSha256':sha(Path(__file__).read_bytes()),
        'blob':{'file':'expected-f64.bin','sha256':sha(payload),'bytes':len(payload)},'records':records}
    (a.output/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps([{'caseId':r['caseId'],**r['nativeF32vsF64']}for r in records],indent=2))


if __name__=='__main__':main()
