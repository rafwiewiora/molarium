"""Stage one finite capability-only diagnostic after verified terminal controls."""
import base64
import datetime
import hashlib
import json
from pathlib import Path
import shlex
import subprocess

ops=Path('/Users/bb/repos/marco/tmp/molarium-rnp-spectrum-20261115')
source=ops/'nvidia-device-discovery-20261117-attempt001'
payload=json.dumps({q.name:base64.b64encode(q.read_bytes()).decode()for q in sorted(source.iterdir())if q.is_file()}).encode()
remote=r'''
from pathlib import Path
import base64,datetime,getpass,hashlib,json,os,subprocess,sys,time,urllib.request
os.environ['TZ']='UTC';time.tzset()
def run(a,cwd=None):return subprocess.check_output(a,text=True,cwd=str(cwd)if cwd else None)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
base='http://metadata.google.internal/computeMetadata/v1/'
identity={k:urllib.request.urlopen(urllib.request.Request(base+k,headers={'Metadata-Flavor':'Google'}),timeout=15).read().decode()for k in ['project/project-id','instance/name','instance/id','instance/zone']}
assert identity['project/project-id']=='psivant-prod' and identity['instance/name']=='psigreen-login-001'
assert identity['instance/id']=='3894148826269628555' and identity['instance/zone'].endswith('/us-central1-c')
config=run(['scontrol','show','config']);assert 'ClusterName             = psigreen'in config and'psigreen-controller'in config
states=run(['sacct','-X','-j','20206,20207','-n','-P','--format=JobID,State,ExitCode,Elapsed,Start,End,NodeList'])
rows={r[0]:r for r in(line.split('|')for line in states.splitlines()if line.strip())}
assert rows['20206'][1]=='FAILED' and rows['20207'][1]=='CANCELLED'
parent=Path('/workspacenfs/rafal_wiewiora/molarium-gpu-driver-binding-20261116-attempt003')
assert sha(parent/'source-manifest.json')=='19ddefa9fa09f0d1ee0c9a624907b83677c041e2487fc0f48faba3a50200cdff'
assert json.loads((parent/'binding-result.json').read_text())['success'] is False
assert not(Path('/workspacenfs/rafal_wiewiora/molarium-nvidia-qualified-controls-20261116-attempt002')/'model-controls-started').exists()
queue=run(['squeue','-h','-u',getpass.getuser(),'-o','%i|%j|%T|%P'])
assert not any(any(n in row for n in ['molarium-driver-binding','molarium-qualified-controls','molarium-device-discovery'])for row in queue.splitlines())
for name in ['gpu','l4spot']:
 assert'State=UP'in run(['scontrol','show','partition',name])
inventory=run(['sinfo','-N','-p','gpu,l4spot','-o','%N|%P|%t|%m|%G'])
assert datetime.datetime.now(datetime.timezone.utc)<datetime.datetime(2026,11,20,22,30,tzinfo=datetime.timezone.utc)
root=Path('/workspacenfs/rafal_wiewiora/molarium-nvidia-device-discovery-20261117-attempt001');assert not root.exists()
files=json.loads(sys.stdin.buffer.read());assert len(files)==9
for name in files:assert Path(name).name==name and name not in ['.','..']
root.mkdir();(root/'logs').mkdir()
for name,data in files.items():(root/name).write_bytes(base64.b64decode(data,validate=True))
assert sha(root/'source-manifest.json')=='1af42b5bea4500493215274907b492442927cb6f97166f443beafbc39bbe84f0'
manifest=json.loads((root/'source-manifest.json').read_bytes())
for name,digest in manifest.items():assert sha(root/name)==digest
subprocess.run(['sha256sum','-c','source-sha256.txt'],cwd=str(root),check=True,stdout=subprocess.DEVNULL)
for path in root.glob('*.sh'):subprocess.run(['bash','-n',str(path)],check=True)
command=['sbatch','--parsable','--partition=gpu,l4spot','--ntasks=1','--cpus-per-task=4','--mem=14G','--gres=gpu:1','--time=00:10:00','--deadline=2026-11-20T22:30:00','--nice=0','--no-requeue','--job-name=molarium-device-discovery','--comment=project:molarium,experiment:nvidia-device-discovery,owner:rafal','--output=logs/gpu-%j.log','gpu.sh']
job=run(command,root).strip();assert job.isdigit()
r={'schema':'molarium.finite-capability-diagnostic-submission.v1','jobId':int(job),'submittedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'owner':'rafal','root':str(root),'identity':identity,'cluster':'psigreen','controller':'psigreen-controller','parentTerminalStates':states,'sourceManifestSha256':sha(root/'source-manifest.json'),'partitions':['gpu','l4spot'],'cpu':4,'memory':'14G','gpuCount':1,'timeLimitMinutes':10,'nice':0,'qos':'normal','retentionDeadline':'2026-11-20T22:30:00Z','requeue':False,'modelCallsPlanned':0,'newNativeForwards':0,'numericalGatesChanged':False,'standaloneVmActions':[],'newJobs':1,'activeQueueBefore':queue,'resourceInventoryBefore':inventory,'diagnosticGap':'EGL supplied vkCreateInstance yet Chrome returned null; previous SystemInfo incorrectly targeted the page. Measure physical-device visibility and actual browser-target diagnostics, then one documented enable-gpu variant. No control retry or replacement loop.'}
(root/'submission.json').write_text(json.dumps(r,indent=2)+'\n')
r['liveJob']=run(['scontrol','show','job',job,'-o'])
print(json.dumps(r))
'''
cmd=['gcloud','compute','ssh','rafal_wiewiora_psivant_com@psigreen-login-001','--project=psivant-prod','--zone=us-central1-c','--tunnel-through-iap','--account=rafal.wiewiora@psithera.com','--ssh-flag=-o BatchMode=yes','--ssh-flag=-o LogLevel=ERROR','--verbosity=error','--command=python3 -c '+shlex.quote(remote)]
r=subprocess.run(cmd,input=payload,capture_output=True,timeout=90)
assert r.returncode==0,r.stderr.decode()
result=json.loads(r.stdout);assert not(source/'submission.json').exists();(source/'submission.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items()if k not in ['activeQueueBefore','resourceInventoryBefore','liveJob']},indent=2))
print(result['liveJob'])
