"""Independently reconstruct precision evidence and recompute every GPU error.

Only NumPy is needed. Official FP64 outputs are also checked against an explicit
NumPy LayerNorm/SwiGLU, and encoded int5 resident values are decoded independently.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile
import numpy as np

sha=lambda b:hashlib.sha256(b).hexdigest()


def evaluate(root):
    root=Path(root);receipt=json.loads((root/'evidence.json').read_bytes());archives={}
    for archive in receipt['archives']:
        data=(root/archive['file']).read_bytes();assert len(data)==archive['bytes']and sha(data)==archive['sha256']
        with zipfile.ZipFile(io.BytesIO(data))as z:
            assert set(z.namelist())=={f['file']for f in archive['files']}
            content={f['file']:z.read(f['file'])for f in archive['files']}
        for f in archive['files']:assert len(content[f['file']])==f['bytes']and sha(content[f['file']])==f['sha256']
        archives[archive['file']]=content
    native_files=archives['reference-evidence.zip'];native=json.loads(native_files['manifest.json']);blob=native_files['fixtures.bin']
    assert native_files['manifest.json']==(root/'reference-manifest.json').read_bytes()
    assert sha(blob)==native['blob']['sha256']and sha(native_files['exporter.py'])==native['exporterSha256']
    gpu_files=archives['gpu-evidence.zip'];report=json.loads(gpu_files['comparison.json']);gpu=gpu_files[report['outputs']['file']]
    assert gpu_files['comparison.json']==(root/'comparison.json').read_bytes()
    assert sha(gpu)==report['outputs']['sha256']and sha(gpu_files['probe.mjs'])==report['probeSha256']and sha(gpu_files['runner.mjs'])==report['runnerSha256']
    assert report['precisionManifestSha256']==sha(native_files['manifest.json'])
    with zipfile.ZipFile(root.parent/'fixed-input-evidence.zip')as z:
        original_bytes=z.read('fp32/manifest.json');original=json.loads(original_bytes);original_blob=z.read('fp32/fixtures.bin')
    assert sha(original_bytes)==native['originalManifestSha256']==report['originalManifestSha256']
    assert sha(original_blob)==original['blob']['sha256']==native['originalBlobSha256']
    def values(data,descriptor,dtype=None):
        part=data[descriptor['byteOffset']:descriptor['byteOffset']+descriptor['bytes']]
        assert len(part)==descriptor['bytes']and sha(part)==descriptor['sha256']
        return np.frombuffer(part,dtype=dtype or descriptor['dtype']).astype(np.float64)
    def reference(name):return values(blob,native['arrays'][name])
    def old_array(name):return values(original_blob,original['arrays'][name],'<f4')
    def inputs(c):return old_array(c['inputReference']['array'])if c['inputReference']['kind']=='original'else reference(c['inputReference']['array'])
    def metrics(actual,expected):
        if not np.isfinite(actual).all():return {'finite':False,'relativeRms':None,'maxAbs':None}
        delta=actual-expected
        return {'finite':True,'relativeRms':float(np.sqrt(np.sum(delta*delta)/np.sum(expected*expected))),'maxAbs':float(np.max(np.abs(delta)))}
    def same_metrics(actual,measured):
        assert actual['finite']==measured['finite']
        for k in ['relativeRms','maxAbs']:
            if actual[k]is None:assert measured[k]is None
            else:assert abs(actual[k]-measured[k])<=max(1e-12,abs(actual[k])*1e-9),(k,actual[k],measured[k])
    cases={c['id']:c for c in native['cases']};assert len(cases)==21
    packed_hashes={};quantization=[];max_native_numpy=0.
    order=['inputLayerNormScale','inputLayerNormOffset','transition1','transition2']
    for c in cases.values():
        channels=c['shape']['channels'];rows=c['shape']['rows'];mid=channels*c['shape']['factor']
        x=inputs(c).reshape(rows,channels);weights={k:reference(v).reshape(native['arrays'][v]['shape'])for k,v in c['weights'].items()}
        baseline=next(v for v in original['cases']if v['id'].split('-')[0]==c['originalCaseId'].split('-')[0])
        for name in order:
            raw=old_array(baseline['weights'][name]);wanted=raw
            if c['precision']=='int5-f16'and name in ['transition1','transition2']:
                enc=c['encoded'][name];data=reference(enc['data']).astype(np.uint8).tobytes();record=enc['record'];n=raw.size
                bit=np.arange(n,dtype=np.int64)*5;encoded=np.frombuffer(data,dtype=np.uint8)
                codes=((encoded[bit//8].astype(np.uint16)|(encoded[bit//8+1].astype(np.uint16)<<8))>>(bit%8))&31
                groups=(n+31)//32;scales=np.frombuffer(data,dtype='<f2',count=groups,offset=record['scaleOffset']).astype(np.float64)
                zeros=np.frombuffer(data,dtype='<f2',count=groups,offset=record['zeroOffset']).astype(np.float64)
                wanted=(codes*scales[np.arange(n)//32]+zeros[np.arange(n)//32]).astype(np.float32).astype(np.float64)
            if c['precision']!='f32':wanted=wanted.astype(np.float16).astype(np.float64)
            assert np.array_equal(wanted,weights[name].reshape(-1)),(c['id'],name)
        if c['precision']=='int5-f16':packed_hashes[c['id']]=sha(np.concatenate([weights[k].reshape(-1)for k in order]).astype('<f2').tobytes())
        mean=np.mean(x,axis=1,keepdims=True);variance=np.mean((x-mean)**2,axis=1,keepdims=True)
        normalized=(x-mean)/np.sqrt(variance+c['epsilon'])*weights['inputLayerNormScale']+weights['inputLayerNormOffset']
        wide=normalized@weights['transition1'];gated=(wide[:,:mid]/(1+np.exp(-wide[:,:mid])))*wide[:,mid:]
        full=gated@weights['transition2']
        for actual,key in [(normalized,c['normalizedF64']),(full,c['expectedF64'])]:
            check=metrics(actual.reshape(-1),reference(key));max_native_numpy=max(max_native_numpy,check['relativeRms'])
            assert check['relativeRms']<=1e-10 and check['maxAbs']<=2e-10,(c['id'],check)
        if c['precision']!='f32':
            base_case=cases[c['originalCaseId']+'/f32']
            quantization.append({'caseId':c['originalCaseId'],'precision':c['precision'],
                **metrics(reference(c['expectedF64']),reference(base_case['expectedF64']))})
    def verify_gpu(measured,data):
        index={(v['caseId'],v['style'],v['shifted'],v['kind']):v for v in measured['outputs']['records']}
        assert len(index)==len(measured['outputs']['records'])
        for r in measured['records']:
            if r['status']!='complete':continue
            c=cases[r['caseId']];key=(r['caseId'],r['style'],r['shifted'])
            actual=values(data,index[(*key,'output')]);actual=actual-inputs(c)if r['residual']else actual
            actual_metrics=metrics(actual,reference(c['expectedF64']));same_metrics(actual_metrics,r['full'])
            tol=measured['tolerances']['f32'if c['precision']=='f32'else'f16']
            passed=actual_metrics['finite']and actual_metrics['relativeRms']<=tol['full']['relativeRms']and actual_metrics['maxAbs']<=tol['full']['maxAbs']
            if r['normalization']is not None:
                norm=metrics(values(data,index[(*key,'normalized')]),reference(c['normalizedF64']));same_metrics(norm,r['normalization'])
                passed=passed and norm['finite']and norm['relativeRms']<=tol['normalization']['relativeRms']and norm['maxAbs']<=tol['normalization']['maxAbs']
            assert bool(passed)==r['passesMatchedPrecisionGate']
            if r['decoder']:
                assert r['decoder']['differingBytes']==0 and r['decoder']['parameters']==2
                assert r['decoder']['actualSha256']==r['decoder']['expectedSha256']==packed_hashes[c['id']]
        return [r for r in measured['records']if r.get('shifted')and not r.get('passesMatchedPrecisionGate',False)]
    assert len(report['records'])==126 and not report['stopped']and not verify_gpu(report,gpu)
    history=archives['qualification-history.zip'];old=json.loads(history['comparison003.json']);reconstruction=json.loads(history['reconstruction.json']);delta=history['changed-outputs.bin']
    assert sha(delta)==reconstruction['deltaSha256']and sha(gpu)==reconstruction['currentOutputSha256']
    restored=b''.join((gpu if r['source']=='current'else delta)[r['sourceByteOffset']:r['sourceByteOffset']+r['bytes']]for r in reconstruction['records'])
    assert sha(restored)==old['outputs']['sha256']==reconstruction['originalOutputSha256']
    assert sha(history['probe003.mjs'])==old['probeSha256']and old['tolerances']==report['tolerances']
    old_failures=verify_gpu(old,restored)
    assert {(r['caseId'],r['style'])for r in old_failures}=={('msa-near-constant/f32',s)for s in ['fused','fused-residual']}
    for attempt in ['001','002']:
        previous=json.loads(history['comparison'+attempt+'.json']);assert previous['stopped']and len(previous['records'])==4
        assert previous['records'][-1]['status']=='error'
        assert sha(history['probe'+attempt+'.mjs'])==previous['probeSha256']
        assert sha(history[previous['outputs']['file']])==previous['outputs']['sha256']
    first_native=json.loads(history['native001-manifest.json']);prefix=json.loads(history['native001-prefix.json'])
    assert sha(blob[:prefix['bytes']])==prefix['sha256']==first_native['blob']['sha256']
    assert sha(history['native001-exporter.py'])==first_native['exporterSha256']
    summary=[]
    for precision in ['f32','f16','int5-f16']:
        rows=[r for r in report['records']if r['precision']==precision];candidate=[r for r in rows if r['shifted']]
        summary.append({'precision':precision,'candidateChecks':len(candidate),'candidatePass':sum(r['passesMatchedPrecisionGate']for r in candidate),
            'baselineFailures':sum(not r['passesMatchedPrecisionGate']for r in rows if not r['shifted']),
            'maxCandidateRelativeRms':max(r['full']['relativeRms']for r in candidate),'maxCandidateAbsoluteError':max(r['full']['maxAbs']for r in candidate)})
    return {'schema':'molarium.transition-precision-analysis.v1','comparisonSha256':sha(gpu_files['comparison.json']),
        'analysisScriptSha256':sha(Path(__file__).read_bytes()),'rawMetricsRecomputed':126,'candidateChecks':63,
        'actualGpuDecoderChecks':42,'initialCompleteCandidateFailures':len(old_failures),
        'maxOfficialF64vsNumpyRelativeRms':max_native_numpy,'summary':summary,'weightOnlyQuantizationEffect':quantization}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--publication',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    report=evaluate(a.publication);a.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['summary'],indent=2))
