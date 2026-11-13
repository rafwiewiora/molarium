"""Replay complete trained-target evidence and errors without a model or pickle."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import tempfile
import zipfile
import numpy as np
from feature_snapshot import load_snapshot
from compare_feature_snapshots import atom_name_codes, alphabet_profile, NATIVE_TO_BROWSER
from make_trained_target_fixture import converter


def digest(data):return hashlib.sha256(data).hexdigest()


def unpack_evidence(root, output):
    metadata=json.loads((root/'native-evidence.json').read_bytes())['archive']
    parts=[]
    for item in metadata['parts']:
        path=(root/item['file']).resolve()
        if not path.is_relative_to(root.resolve()):raise ValueError('Evidence part escapes root')
        data=path.read_bytes()
        if len(data)!=item['bytes']or digest(data)!=item['sha256']:raise ValueError('Native evidence part changed')
        parts.append(data)
    raw=b''.join(parts)
    if len(raw)!=metadata['bytes']or digest(raw)!=metadata['sha256']:raise ValueError('Native archive changed')
    with zipfile.ZipFile(io.BytesIO(raw))as z:
        if set(z.namelist())!={f['file']for f in metadata['files']}:raise ValueError('Native archive inventory changed')
        for item in metadata['files']:
            data=z.read(item['file'])
            if len(data)!=item['bytes']or digest(data)!=item['sha256']:raise ValueError('Native archive member changed')
            target=(output/item['file']).resolve()
            if not target.is_relative_to(output.resolve()):raise ValueError('Archive member escapes output')
            target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    return metadata


def metric(left,right):
    left,right=left.astype(np.float64),right.astype(np.float64)
    if left.shape!=right.shape:raise ValueError('Output shape changed')
    delta=left-right;scale=np.sum(right*right)
    if not np.isfinite(right).all()or not scale>0:raise ValueError('Invalid/degenerate native reference')
    finite=bool(np.isfinite(left).all())
    return {'values':left.size,'finite':finite,'referenceRms':float(np.sqrt(np.mean(right*right))),
            'relativeRms':float(np.sqrt(np.sum(delta*delta)/scale))if finite else None,
            'maxAbs':float(np.max(np.abs(delta)))if finite else None}


def check(root):
    root=Path(root);fixture=root/'fixture'
    report=json.loads((root/'browser-comparison.json').read_bytes())
    analysis=json.loads((root/'analysis.json').read_bytes())
    fr=json.loads((fixture/'receipt.json').read_bytes())
    if digest((fixture/'receipt.json').read_bytes())!=report['fixtureReceiptSha256']:raise ValueError('Fixture receipt changed')
    if report['gates']!=fr['gatesDeclaredBeforeRun']:raise ValueError('Declared gates changed')
    if len(report['records'])!=2 or{r['path']for r in report['records']}!={'production-cpu','production-webgpu'}:
        raise ValueError('Both measured paths are required')
    if len(report['outputs'])!=2 or{r['path']for r in report['outputs']}!={'production-cpu','production-webgpu'}:
        raise ValueError('Both complete raw outputs are required')
    with tempfile.TemporaryDirectory()as directory:
        unpacked=Path(directory);inventory=unpack_evidence(root,unpacked)
        native=unpacked/'native';nr=json.loads((native/'receipt.json').read_bytes())
        if nr['status']!='complete'or nr['forwardCalls']!=0 or nr['trainedEmbedder']['embedderForwardCalls']!=1:
            raise ValueError('Requires a completed stock trained-stage export')
        strict=nr['trainedEmbedder']['strictPrecision']
        if strict['matmul']!='highest'or strict['cudaTf32']or strict['cudnnTf32']:raise ValueError('Strict native precision changed')
        if digest((native/'receipt.json').read_bytes())!=fr['nativeReceiptSha256']:raise ValueError('Native parent changed')
        if (root/'native-receipt.json').read_bytes()!=(native/'receipt.json').read_bytes():raise ValueError('Public native receipt changed')
        for item in nr['outputs']+nr['trainedEmbedder']['files']:
            data=(native/item['path']).read_bytes()
            if len(data)!=item['bytes']or digest(data)!=item['sha256']:raise ValueError('Native output changed')
        for key,name in [('scriptSha256','capture_native_features.py'),('observerSourceSha256','capture_native_embedder.py'),('inputResolverSha256','native_run.py')]:
            if digest((unpacked/'consumed-native-stage'/name).read_bytes())!=nr[key]:raise ValueError('Consumed native producer changed')
        if digest((unpacked/'first-run/run-target-embedder001.mjs').read_bytes())!=report['runnerSha256']:raise ValueError('Consumed browser runner changed')
        if digest((unpacked/'first-run/convert-trained-embedder001.py').read_bytes())!=fr['scriptSha256']:raise ValueError('Consumed conversion script changed')
        n,_=load_snapshot(native/'features');state,_=load_snapshot(native/'trained-embedder/weights');out,_=load_snapshot(native/'trained-embedder/outputs')
        controlled,_=load_snapshot(fixture/'controlled-batch');active=np.flatnonzero(controlled['predDenseAtomMask'])
        if not np.array_equal(n['atom_to_token_index'][0],active//controlled['dense']):raise ValueError('Atom order changed')
        for nk,bk in [('ref_pos','refPos'),('ref_mask','refMask'),('ref_charge','refCharge'),('ref_space_uid','refSpaceUid')]:
            target=controlled[bk].reshape((-1,3)if nk=='ref_pos'else(-1,))
            if not np.array_equal(target[active],n[nk][0]):raise ValueError('Controlled atom inputs changed: '+nk)
        if not np.array_equal(controlled['refElement'][active],n['ref_element'][0].argmax(-1)+1):raise ValueError('Elements changed')
        if not np.array_equal(controlled['refAtomNameChars'].reshape(-1,4)[active],atom_name_codes(n['ref_atom_name_chars'][0])):raise ValueError('Atom names changed')
        if not np.array_equal(controlled['aatype'],NATIVE_TO_BROWSER[n['restype'][0].argmax(-1)]):raise ValueError('Residue categories changed')
        if not np.array_equal(controlled['profile'].reshape(-1,31),alphabet_profile(n['profile'][0])):raise ValueError('Profiles changed')
        if not np.array_equal(controlled['deletionMean'],n['deletion_mean'][0]):raise ValueError('Deletion means changed')
        c=converter(unpacked/'converter-source');params={}
        c.map_evoformer_conditioning({'input_embedder.'+k:v for k,v in state.items()},params)
        wm=json.loads((fixture/'weights.json').read_bytes());wb=(fixture/'weights.bin').read_bytes()
        if len(wb)!=wm['blob']['bytes']or digest(wb)!=wm['blob']['sha256']:raise ValueError('Converted weights changed')
        expected_weights={scope+'/'+name:value for scope,leaves in params.items()for name,value in leaves.items()}
        if wm['tensors'].keys()!=expected_weights.keys():raise ValueError('Converted weight coverage changed')
        for name,value in expected_weights.items():
            record=wm['tensors'][name];raw=wb[record['byteOffset']:record['byteOffset']+record['bytes']]
            if digest(raw)!=record['sha256']or raw!=np.asarray(value,dtype='<f4').tobytes():raise ValueError('Learned weight mapping changed: '+name)
            if record['shape']!=list(value.shape):raise ValueError('Weight shape changed')
        eraw=(fixture/'expected-target.bin').read_bytes()
        if digest(eraw)!=fr['expectedTargetSha256']:raise ValueError('Expected native target changed')
        expected=np.frombuffer(eraw,dtype='<f4').reshape(fr['expectedShape'])
        remap=c._AF3_TO_OF3_AATYPE;index=np.concatenate([384+remap,416+remap,[448],np.arange(384)])
        if not np.array_equal(expected,out['s_input'][0][:,index])or not np.all(out['s_input'][0][:,[414,446]]==0):
            raise ValueError('Native alphabet/channel correspondence changed')
        records=[]
        for item in report['outputs']:
            data=(root/item['file']).read_bytes()
            if len(data)!=item['bytes']or digest(data)!=item['sha256']:raise ValueError('Measured raw output changed')
            actual=np.frombuffer(data,dtype='<f4').reshape(expected.shape)
            full=metric(actual,expected);atoms=metric(actual[:,63:],expected[:,63:]);gate=report['gates']
            passes=full['finite']and full['relativeRms']<=gate['relativeRms']and full['maxAbs']<=gate['maxAbsoluteDifference']
            original=next(r for r in report['records']if r['path']==item['path'])
            saved=next(r for r in analysis['records']if r['path']==item['path'])
            if abs(full['relativeRms']-original['relativeRms'])>1e-18 or full['maxAbs']!=original['maxAbsoluteDifference']or passes!=original['passes']:
                raise ValueError('Reported full-target error/gate does not reproduce')
            if not atoms['finite']or atoms['referenceRms']<1e-3 or abs(atoms['relativeRms']-saved['learnedAtomChannels']['relativeRms'])>1e-18 or atoms['maxAbs']!=saved['learnedAtomChannels']['maxAbs']:
                raise ValueError('Reported learned-channel error does not reproduce')
            if not np.array_equal(actual[:,:63],expected[:,:63]):raise ValueError('Copied input-feature prefix differs')
            records.append({'path':item['path'],'relativeRms':atoms['relativeRms'],'maxAbs':atoms['maxAbs'],'passes':passes})
    return {'scope':'Only trained target-feature stage; offline replay, no model/GPU execution.','nativeFiles':len(inventory['files']),'mappedWeightTensors':len(expected_weights),'records':records}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('root',type=Path);args=parser.parse_args();print(json.dumps(check(args.root)))


if __name__=='__main__':main()
