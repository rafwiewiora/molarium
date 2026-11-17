"""One bounded regular-L4 recovery after verified zero-payload Spot losses."""
from pathlib import Path
import datetime, hashlib, json, shlex, subprocess
ops=Path(__file__).resolve().parent
plans=[
 {'parentJob':20400,'previous':'molarium-nvidia-qualified-controls-20261117-attempt004','next':'molarium-nvidia-qualified-controls-20261117-attempt005','sourcePin':'dc0883c69b689a50c1534a498eea1e26ca790c89a1c033569fdbb5fd736ec55a','name':'molarium-qualified-controls','transitionConfigurations':126},
 {'parentJob':20402,'previous':'molarium-nvidia-strict-trunk-20261117-attempt003','next':'molarium-nvidia-strict-trunk-20261117-attempt004','sourcePin':'024f3b83d87add3e72de6917fe3af387e4bea720623eff7d5f4ff2715267fd40','name':'molarium-strict-trunk','transitionConfigurations':0},
]
hardware=json.loads((ops/'regular-recovery-hardware-inventory-20261117-001.json').read_bytes())
assert (datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(hardware['checkedAt'])).total_seconds()<600
for plan in plans: assert not (ops/plan['next'].removeprefix('molarium-')).exists()
remote=r'''
from pathlib import Path
import datetime,getpass,hashlib,json,os,subprocess,sys,time,urllib.request
os.environ['TZ']='UTC';time.tzset()
def run(a,cwd=None):return subprocess.check_output(a,text=True,cwd=str(cwd)if cwd else None)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,v):
 with p.open('x')as f:f.write(json.dumps(v,indent=2)+'\n')
data=json.loads(sys.stdin.buffer.read());plans=data['plans'];hardware=data['hardware']
metadata='http://metadata.google.internal/computeMetadata/v1/'
identity={k:urllib.request.urlopen(urllib.request.Request(metadata+k,headers={'Metadata-Flavor':'Google'}),timeout=15).read().decode()for k in ['project/project-id','instance/name','instance/id','instance/zone']}
assert identity['project/project-id']=='psivant-prod'and identity['instance/name']=='psigreen-login-001'and identity['instance/id']=='3894148826269628555'and identity['instance/zone'].endswith('/us-central1-c')
c=run(['scontrol','show','config']);assert'ClusterName             = psigreen'in c and'psigreen-controller'in c
now=datetime.datetime.now(datetime.timezone.utc);assert now<datetime.datetime(2026,11,20,22,30,tzinfo=datetime.timezone.utc)
assert(now-datetime.datetime.fromisoformat(hardware['checkedAt'])).total_seconds()<600
queue=run(['squeue','-h','-u',getpass.getuser(),'-o','%i|%j|%T|%P'])
relevant=[x for x in queue.splitlines()if'molarium'in x.lower()]
assert not any(any(p['name']in x for p in plans)for x in relevant),relevant
assert'State=UP'in run(['scontrol','show','partition','gpu','-o'])
cloud={r['name']:r for r in hardware['regularRunningL4Nodes']};eligible=[];excluded=[]
for line in run(['scontrol','show','nodes','-o']).splitlines():
 f=dict(w.split('=',1)for w in line.split()if'='in w)
 if'gpu'not in f.get('Partitions','').split(','):continue
 good=f['NodeName']in cloud and f.get('BootTime')not in [None,'None']and any(s in f['State']for s in ['ALLOCATED','IDLE','MIXED'])and not any(s in f['State']for s in ['DOWN','POWER','DRAIN','FAIL','NOT_RESPOND'])
 if good:
  assert f['Gres']=='gpu:1'and int(f['RealMemory'])>=14336 and int(f['CPUTot'])>=4
  eligible.append({'slurm':{k:f[k]for k in ['NodeName','State','BootTime','Gres','RealMemory','CPUTot']},'cloud':cloud[f['NodeName']]})
 else:excluded.append(f['NodeName'])
assert eligible
base=Path('/workspacenfs/rafal_wiewiora');results=[]
# Validate both predecessors before creating any new attempt.
for p in plans:
 old=base/p['previous'];new=base/p['next'];assert not new.exists()
 state=run(['sacct','-X','-n','-P','-j',str(p['parentJob']),'--format=JobID,State,ExitCode,Elapsed,Start,End,NodeList'])
 assert state.startswith(str(p['parentJob'])+'|NODE_FAIL|'),state
 assert not(old/'gpu-started').exists()and not(old/'model-controls-started').exists()and not(old/'results').exists()
 assert not list((old/'logs').iterdir())
 assert sha(old/'source-manifest.json')==p['sourcePin']
 for n,h in json.loads((old/'source-manifest.json').read_bytes()).items():assert sha(old/n)==h,n
 p['parentAccounting']=state
for p in plans:
 old=base/p['previous'];root=base/p['next'];root.mkdir();(root/'logs').mkdir()
 manifest=json.loads((old/'source-manifest.json').read_bytes())
 for name in list(manifest)+['source-manifest.json','source-sha256.txt']:(root/name).write_bytes((old/name).read_bytes())
 assert sha(root/'source-manifest.json')==p['sourcePin']
 for name,h in manifest.items():assert sha(root/name)==h
 image=Path('/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261113-attempt005/runtime/browser.sif')
 receipt=json.loads((old/'container-image-receipt.json').read_bytes())
 digest=hashlib.sha256()
 with image.open('rb')as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):digest.update(chunk)
 assert digest.hexdigest()==receipt['sha256']=='8ddec45c00d959cece9f99024412dd06d9487cfd2bdedb719ed32e4721d84a1c'
 write(root/'container-image-receipt.json',receipt)
 tools=base/'molarium-nvidia-layer-20261113-attempt002';layer=base/'molarium-nvidia-layer-20261115-attempt001';trunk=base/'molarium-trained-trunk-browser-20261115-attempt001'
 fixtures=json.loads((root/'fixture-mount-plan.json').read_bytes())['extraReadOnlyBinds']
 assert fixtures==['/workspacenfs/rafal_wiewiora/molarium-trained-trunk-browser-20261113-attempt002/results/fixture']
 args=['singularity','exec']
 for path in [root,tools,layer,trunk]+[Path(x)for x in fixtures]:args+=['--bind',str(path)+':'+str(path)+(':ro'if path!=root else'')]
 args+=['--pwd',str(root),str(image),str(tools/'tools/bun-linux-x64/bun'),str(root/'container-fixture-preflight.mjs'),str(root/'fixture-mount-plan.json'),str(root/'before-submission-fixture-preflight.json')]
 pre=subprocess.run(args,capture_output=True,text=True,timeout=60)
 (root/'before-submission-fixture-preflight.log').write_text(pre.stdout+pre.stderr)
 assert pre.returncode==0,pre.stderr
 assert json.loads((root/'before-submission-fixture-preflight.json').read_bytes())['status']=='verified'
 recovery={'parentJob':p['parentJob'],'parentRoot':str(old),'parentAccounting':p['parentAccounting'],'parentGpuStarted':False,'parentModelControlsStarted':False,'parentLogs':[],'sourceIdentical':True,'sourceManifestSha256':p['sourcePin'],'reason':'Both previous L4 Spot allocations lost nodes before payload. One bounded pair of immutable regular-only attempts; no automatic replacement loop.','hardwareInventory':hardware,'eligibleNodes':eligible,'excludedRegularNodes':excluded,'identity':identity,'numericalGatesChanged':False,'standaloneVmActions':[],'retentionDeadline':'2026-11-20T22:30:00Z'}
 write(root/'recovery-parent.json',recovery)
 cmd=['sbatch','--parsable','--partition=gpu','--ntasks=1','--cpus-per-task=4','--mem=14G','--gres=gpu:1','--time=00:30:00','--deadline=2026-11-20T22:30:00','--nice=0','--no-requeue','--job-name='+p['name'],'--comment=project:molarium,experiment:nvidia-fixed-input-controls,owner:rafal','--output=logs/gpu-%j.log']
 if excluded:cmd+=['--exclude='+','.join(excluded)]
 job=run(cmd+['gpu.sh'],root).strip();assert job.isdigit()
 submission={'schema':'molarium.regular-L4-recovery.v1','jobId':int(job),'submittedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'owner':'rafal','root':str(root),'identity':identity,'cluster':'psigreen','controller':'psigreen-controller','sourceManifestSha256':p['sourcePin'],'parentJob':p['parentJob'],'partition':'gpu','hardwareTarget':'L4','cpu':4,'memory':'14G','gpuCount':1,'timeLimitMinutes':30,'nice':0,'qos':'normal','requeue':False,'deadline':'2026-11-20T22:30:00Z','transitionConfigurations':p['transitionConfigurations'],'trainedTrunkCycles':4,'trainedTrunkBoundaries':32,'newNativeCalls':0,'newConversions':0,'plannedCompletePoseCalls':0,'numericalGatesChanged':False,'sourceIdenticalToParent':True,'beforeSubmissionFixturePreflightSha256':sha(root/'before-submission-fixture-preflight.json'),'containerImageSha256':receipt['sha256'],'standaloneVmActions':[],'automaticReplacementLoop':False,'liveJob':run(['scontrol','show','job',job,'-o'])}
 write(root/'submission.json',submission);results.append(submission)
print(json.dumps(results))
'''
cmd=['gcloud','compute','ssh','rafal_wiewiora_psivant_com@psigreen-login-001','--project=psivant-prod','--zone=us-central1-c','--tunnel-through-iap','--account=rafal.wiewiora@psithera.com','--ssh-flag=-o BatchMode=yes','--ssh-flag=-o LogLevel=ERROR','--verbosity=error','--command=python3 -c '+shlex.quote(remote)]
x=subprocess.run(cmd,input=json.dumps({'plans':plans,'hardware':hardware}).encode(),capture_output=True,timeout=180)
(ops/'regular-L4-recovery-20261117-attempt001.stdout').write_bytes(x.stdout)
(ops/'regular-L4-recovery-20261117-attempt001.stderr').write_bytes(x.stderr)
assert x.returncode==0,x.stderr.decode()
rows=json.loads(x.stdout)
for plan,row in zip(plans,rows):
 dest=ops/plan['next'].removeprefix('molarium-');dest.mkdir()
 old=ops/plan['previous'].removeprefix('molarium-')
 manifest=json.loads((old/'source-manifest.json').read_bytes())
 for name in list(manifest)+['source-manifest.json','source-sha256.txt']:(dest/name).write_bytes((old/name).read_bytes())
 (dest/'submission.json').write_text(json.dumps(row,indent=2)+'\n')
 print(json.dumps(row,indent=2))
