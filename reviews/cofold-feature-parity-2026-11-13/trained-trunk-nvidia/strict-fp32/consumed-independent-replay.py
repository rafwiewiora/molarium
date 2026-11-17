"""Hash-check and independently replay completed raw arrays through RAM, no inference."""
from pathlib import Path
import datetime,hashlib,io,json,math,os,shlex,subprocess,tarfile,threading
import numpy as np
ops=Path(__file__).resolve().parent
root=ops/'nvidia-strict-20535-independent-replay-20261117-attempt001'
assert not root.exists();root.mkdir()
sha=lambda b:hashlib.sha256(b).hexdigest()
parent=ops/'nvidia-numerical-observer-20261117-attempt005/20535'
observation=json.loads((parent/'observation.json').read_bytes())
measured=parent/'preserved/results/trunk'
report_bytes=(measured/'receipt.json').read_bytes();report=json.loads(report_bytes)
assert sha(report_bytes)==observation['inventory']['results/trunk/receipt.json']['sha256']
fixture=ops/'trained-trunk-apple-20261117-attempt001/fixture'
reference_bytes=(fixture/'receipt.json').read_bytes();reference=json.loads(reference_bytes)
assert sha(reference_bytes)==report['fixtureReceiptSha256']=='36a7afd397e001a5f6628d79e1eb754706a15bfc4f2ac836aacb686122f78125'
apple_root=ops/'trained-trunk-apple-strict-fp32-20261117-attempt002/measured'
apple=json.loads((apple_root/'receipt.json').read_bytes());assert apple['fixtureReceiptSha256']==report['fixtureReceiptSha256']
assert report['status']=='complete' and [x['cycle']for x in report['records']]==list(range(4))
gates={'relativeRms':1e-4,'maxAbsoluteDifference':1e-3,'requireFinite':True}
assert report['gates']==apple['gates']==reference['gatesDeclaredBeforeRun']==gates
assert report['precisionControl']=={'pairMatrixKernels':False,'requireNoF16Shaders':True}
assert all(not x['usesF16']for x in report['shaderAudit']) and report['adapter']['vendor']=='nvidia'
assert set(report['outputs'])==set(reference['expectedSeams'])==set(apple['outputs']) and len(report['outputs'])==32
worker=json.loads((parent/'preserved/results/trunk-analysis.json').read_bytes());worker_rows={x['seam']:x for x in worker['records']}
(root/'original-measurement-receipt.json').write_bytes(report_bytes)
outputs={v['file']:{'key':k,**v}for k,v in report['outputs'].items()}
assert len(outputs)==32 and all(Path(n).name==n and s['bytes']<=32*1024**2 for n,s in outputs.items())
task=observation['task']
remote='tasks='+repr([task])+'\n'+(ops/'nvidia-numerical-observer-20261117-attempt005/remote-preflight.py').read_text()+'\noutputs='+repr(outputs)+'\nreceipt_sha='+repr(sha(report_bytes))+r'''
import io,tarfile,sys
measured=Path(tasks[0]['root'])/'results/trunk'
assert digest(measured/'receipt.json')==receipt_sha
meta=json.dumps({'schema':'molarium.checked-raw-trunk-stream.v1','checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'identity':identity,'job':20535,'sourceManifestSha256':tasks[0]['sourcePin'],'receiptSha256':receipt_sha,'files':len(outputs),'rawBytes':sum(x['bytes']for x in outputs.values())}).encode()
with tarfile.open(fileobj=sys.stdout.buffer,mode='w|')as archive:
 item=tarfile.TarInfo('transport.json');item.size=len(meta);archive.addfile(item,io.BytesIO(meta))
 for name,spec in sorted(outputs.items()):
  path=measured/name;assert path.is_file()and not path.is_symlink()and path.stat().st_size==spec['bytes']and digest(path)==spec['sha256']
  archive.add(str(path),arcname=name,recursive=False)
'''
(root/'remote-stream.py').write_text(remote)
plan={'recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'jobId':20535,'outputReceiptSha256':sha(report_bytes),'fixtureReceiptSha256':sha(reference_bytes),'sourceManifestSha256':task['sourcePin'],'remoteTransportSha256':sha(remote.encode()),'localReplaySha256':sha(Path(__file__).read_bytes()),'expectedFiles':32,'expectedRawBytes':sum(x['bytes']for x in outputs.values()),'newModelCalls':0,'localRawCopiesWritten':0,'referenceGates':gates,'purpose':'Independently recompute native and cross-Apple errors from every original raw NVIDIA array without disk-sized duplicate or neural replay.'};(root/'plan.json').write_text(json.dumps(plan,indent=2)+'\n')
args=['gcloud','compute','ssh','rafal_wiewiora_psivant_com@psigreen-login-001','--project=psivant-prod','--zone=us-central1-c','--tunnel-through-iap','--account=rafal.wiewiora@psithera.com','--ssh-flag=-o BatchMode=yes','--ssh-flag=-o LogLevel=ERROR','--verbosity=error','--command=python3 -c '+shlex.quote(remote)]
def metric(a,b):
 assert a.shape==b.shape
 a=a.astype(np.float64);b=b.astype(np.float64);assert np.isfinite(b).all()
 finite=bool(np.isfinite(a).all());scale=float(np.dot(b,b));assert scale>0
 delta=a-b
 return {'values':int(a.size),'finite':finite,'referenceRms':float(np.sqrt(scale/a.size)),'relativeRms':float(np.sqrt(np.dot(delta,delta)/scale))if finite else None,'maxAbs':float(np.max(np.abs(delta)))if finite else None}
rows=[];cross=[];seen=set();transport=None;total=0
with (root/'transport.stderr').open('wb')as err:
 process=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=err)
 timer=threading.Timer(600,process.kill);timer.start()
 try:
  with tarfile.open(fileobj=process.stdout,mode='r|')as archive:
   for member in archive:
    assert member.isfile()and member.name not in seen;seen.add(member.name)
    if member.name=='transport.json':
     assert member.size<8192;transport=json.loads(archive.extractfile(member).read());assert transport['job']==20535 and transport['receiptSha256']==sha(report_bytes);continue
    assert transport is not None and member.name in outputs
    spec=outputs[member.name];assert member.size==spec['bytes'];raw=archive.extractfile(member).read();assert len(raw)==spec['bytes']and sha(raw)==spec['sha256']
    key=spec['key'];native_spec=reference['expectedSeams'][key];assert math.prod(native_spec['shape'])*4==native_spec['bytes']==len(raw)
    native_raw=(fixture/native_spec['file']).read_bytes();assert len(native_raw)==native_spec['bytes']and sha(native_raw)==native_spec['sha256']
    apple_spec=apple['outputs'][key];apple_raw=(apple_root/apple_spec['file']).read_bytes();assert len(apple_raw)==apple_spec['bytes']and sha(apple_raw)==apple_spec['sha256']
    actual=np.frombuffer(raw,dtype='<f4');expected=np.frombuffer(native_raw,dtype='<f4');old=np.frombuffer(apple_raw,dtype='<f4')
    m=metric(actual,expected);passes=m['finite']and m['relativeRms']<=gates['relativeRms']and m['maxAbs']<=gates['maxAbsoluteDifference'];old_metric=worker_rows[key]
    assert math.isclose(m['relativeRms'],old_metric['relativeRms'],rel_tol=5e-12,abs_tol=1e-18)and m['maxAbs']==old_metric['maxAbs']and passes==old_metric['passes']
    delta=np.abs(actual.astype(np.float64)-expected.astype(np.float64));index=int(delta.argmax());v=float(expected[index]);spacing=abs(float(np.spacing(np.float32(v))))
    rows.append({'seam':key,**m,'passes':passes,'rawSha256':spec['sha256'],'nativeSha256':native_spec['sha256'],'largestErrorEntry':{'index':index,'nativeValue':v,'nvidiaValue':float(actual[index]),'nativeFloat32Spacing':spacing,'errorInSpacingUnits':m['maxAbs']/spacing if spacing else None}})
    cross.append({'seam':key,**metric(actual,old),'nvidiaSha256':spec['sha256'],'appleSha256':apple_spec['sha256']})
    total+=len(raw);(root/'progress.json').write_text(json.dumps({'status':'replaying','records':len(rows),'rawBytesVerified':total,'lastSeam':key,'newModelCalls':0})+'\n')
  assert process.wait(timeout=30)==0
 finally:
  timer.cancel();process.stdout.close()
  if process.poll()is None:process.kill();process.wait()
assert seen==set(outputs)|{'transport.json'}and len(rows)==32 and total==plan['expectedRawBytes']
rows.sort(key=lambda x:x['seam']);cross.sort(key=lambda x:x['seam'])
summary={'boundaries':32,'allFinite':all(x['finite']for x in rows),'relativeGatePasses':sum(x['relativeRms']<=gates['relativeRms']for x in rows),'combinedGatePasses':sum(x['passes']for x in rows),'worstRelativeRms':max(x['relativeRms']for x in rows),'worstMaxAbsolute':max(x['maxAbs']for x in rows),'passesAllDeclaredGates':all(x['passes']for x in rows)}
result={'schema':'molarium.independent-NVIDIA-trunk-replay.v1','finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'One four-cycle fixed-input OpenBind-0 STARD4 FP32 trunk fixture. Raw-array replay only; no neural calls. No denoising, confidence, production quantization, pose-accuracy or full-model parity verdict.','jobId':20535,'transport':transport,'gates':gates,'summary':summary,'records':rows,'crossDeviceAppleVsNvidia':cross,'crossDeviceInterpretation':'Descriptive errors at identical saved inputs/weights; device-selected generated shader paths differ, so this is not an isolated compiler comparison. No additional acceptance tolerance is assigned.','producerMetricsReproduce':True,'rawBytesVerified':total,'newModelCalls':0,'localRawCopiesWritten':0,'shaderAudit':{'nvidiaShaders':len(report['shaderAudit']),'nvidiaF16Shaders':sum(x['usesF16']for x in report['shaderAudit']),'appleShaders':len(apple['shaderAudit'])}}
(root/'analysis.json').write_text(json.dumps(result,indent=2,allow_nan=False)+'\n');(root/'progress.json').write_text(json.dumps({'status':'complete',**summary,'rawBytesVerified':total,'newModelCalls':0},indent=2)+'\n');print(json.dumps(summary))
