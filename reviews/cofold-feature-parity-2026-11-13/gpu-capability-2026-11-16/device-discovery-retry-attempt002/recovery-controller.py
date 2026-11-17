"""One immutable source-identical retry after a verified pre-payload capacity loss."""
from pathlib import Path
import json,subprocess,shlex
ops=Path(__file__).resolve().parent
remote=r'''
from pathlib import Path
import datetime,getpass,hashlib,json,os,subprocess,time,urllib.request
os.environ['TZ']='UTC';time.tzset()
def run(a,cwd=None):return subprocess.check_output(a,text=True,cwd=str(cwd)if cwd else None)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
base='http://metadata.google.internal/computeMetadata/v1/'
identity={k:urllib.request.urlopen(urllib.request.Request(base+k,headers={'Metadata-Flavor':'Google'}),timeout=15).read().decode()for k in ['project/project-id','instance/name','instance/id','instance/zone']}
assert identity['project/project-id']=='psivant-prod'and identity['instance/name']=='psigreen-login-001'
assert identity['instance/id']=='3894148826269628555'and identity['instance/zone'].endswith('/us-central1-c')
c=run(['scontrol','show','config']);assert'ClusterName             = psigreen'in c and'psigreen-controller'in c
old=Path('/workspacenfs/rafal_wiewiora/molarium-nvidia-device-discovery-20261117-attempt001')
pin='1af42b5bea4500493215274907b492442927cb6f97166f443beafbc39bbe84f0'
assert sha(old/'source-manifest.json')==pin
manifest=json.loads((old/'source-manifest.json').read_bytes())
for name,digest in manifest.items():assert sha(old/name)==digest
state=run(['sacct','-n','-P','-j','20230','--format=JobID,State,ExitCode,Elapsed,Start,End,NodeList'])
rows=[r.split('|')for r in state.splitlines()if r.strip()]
assert len(rows)==1 and rows[0][0]=='20230'and rows[0][1]=='NODE_FAIL'
assert not list((old/'logs').iterdir())
for marker in ['gpu-started','result.json','original','enable-gpu','gpu-identity.txt']:assert not(old/marker).exists()
failed_node=run(['scontrol','show','node','psigreen-l4spotnodeset-30','-o'])
recorded_failure=json.loads('{\n  "at": "2026-11-17T01:22:21.783228+00:00",\n  "identity": {\n    "project/project-id": "psivant-prod",\n    "instance/name": "psigreen-login-001",\n    "instance/id": "3894148826269628555",\n    "instance/zone": "projects/734263838611/zones/us-central1-c"\n  },\n  "newJobs": 0,\n  "accounting": "20230|NODE_FAIL|0:0|00:00:17|2026-11-17T01:18:16|2026-11-17T01:18:33|psigreen-l4spotnodeset-30\\n",\n  "nodes": {\n    "psigreen-l4spotnodeset-26": "NodeName=psigreen-l4spotnodeset-26 Arch=x86_64 CoresPerSocket=2  CPUAlloc=4 CPUEfctv=4 CPUTot=4 CPULoad=1.01 AvailableFeatures=(null) ActiveFeatures=(null) Gres=gpu:1 NodeAddr=10.0.0.42 NodeHostName=psigreen-l4spotnodeset-26 Version=23.11.8 OS=Linux 4.18.0-553.94.1+2.1.el8_10_ciq.x86_64 #1 SMP Fri Jan 30 12:31:49 UTC 2026  RealMemory=15504 AllocMem=15504 FreeMem=270 Sockets=1 Boards=1 State=ALLOCATED+CLOUD ThreadsPerCore=2 TmpDisk=0 Weight=1 Owner=N/A MCS_label=N/A Partitions=l4spot  BootTime=2026-11-17T00:52:38 SlurmdStartTime=2026-11-17T00:53:20 LastBusyTime=2026-11-17T00:54:43 ResumeAfterTime=None CfgTRES=cpu=4,mem=15504M,billing=4 AllocTRES=cpu=4,mem=15504M CapWatts=n/a CurrentWatts=0 AveWatts=0 ExtSensorsJoules=n/a ExtSensorsWatts=0 ExtSensorsTemp=n/a\\n",\n    "psigreen-l4spotnodeset-30": "NodeName=psigreen-l4spotnodeset-30 Arch=x86_64 CoresPerSocket=2  CPUAlloc=0 CPUEfctv=4 CPUTot=4 CPULoad=0.00 AvailableFeatures=(null) ActiveFeatures=(null) Gres=gpu:1 NodeAddr=psigreen-l4spotnodeset-30 NodeHostName=psigreen-l4spotnodeset-30 Version=23.11.8 OS=Linux 4.18.0-553.94.1+2.1.el8_10_ciq.x86_64 #1 SMP Fri Jan 30 12:31:49 UTC 2026  RealMemory=15504 AllocMem=0 FreeMem=299 Sockets=1 Boards=1 State=DOWN+CLOUD+NOT_RESPONDING+POWERING_UP ThreadsPerCore=2 TmpDisk=0 Weight=1 Owner=N/A MCS_label=N/A Partitions=l4spot  BootTime=None SlurmdStartTime=2026-11-17T00:30:55 LastBusyTime=2026-11-17T01:18:33 ResumeAfterTime=None CfgTRES=cpu=4,mem=15504M,billing=4 AllocTRES= CapWatts=n/a CurrentWatts=0 AveWatts=0 ExtSensorsJoules=n/a ExtSensorsWatts=0 ExtSensorsTemp=n/a Reason=GCP Error: ZONE_RESOURCE_POOL_EXHAUSTED_WITH_DETAILS: The zone \'projects/psivant-prod/zones/us-central1-c\' does not have enough resources available to fulfill the request.  \'(resource type:compute)\'. [slurm@2026-11-17T01:18:33]\\n"\n  },\n  "gpuQueue": "PARTITION|AVAIL|STATE|NODES\\ngpu*|up|idle~|15\\ngpu*|up|alloc|60\\nl4spot|up|down#|3\\nl4spot|up|down*|2\\nl4spot|up|alloc|27\\n",\n  "files": {\n    "vulkan_devices.py": {\n      "bytes": 3747,\n      "sha256": "13476c5fa373a39519906417a44dd33d93e573270a78b0546fb31b4eb708e9ad"\n    },\n    "collect_driver_libraries.py": {\n      "bytes": 2546,\n      "sha256": "12c76cfea62482e24690bfd48d603d72ef1f61c3f9ad12836eb1f92c4538efd9"\n    },\n    "probe-adaptation.json": {\n      "bytes": 1850,\n      "sha256": "27c5dbd8e90e35d69ea8733a2fc9cb255da110ae1829a81a7eb66094c3d8159e"\n    },\n    "container.sh": {\n      "bytes": 218,\n      "sha256": "3077582737b3eb60bf2268fb8103e668428ea709de1fc097454a38b568022c64"\n    },\n    "gpu.sh": {\n      "bytes": 3538,\n      "sha256": "565be051747c66e408ee76bd12573eabf6f796a02ebc8c9ee105572acbd946f8"\n    },\n    "submission.json": {\n      "bytes": 11309,\n      "sha256": "0341a519e8125619ee890cc43ab0a604b2edb54b7075e4983d7fea2ac895a7d3"\n    },\n    "source-manifest.json": {\n      "bytes": 630,\n      "sha256": "1af42b5bea4500493215274907b492442927cb6f97166f443beafbc39bbe84f0"\n    },\n    "chrome-wrapper.sh": {\n      "bytes": 472,\n      "sha256": "d83935fa804672e1d466b06c0a18e9b2667f97c64d2c9dc131b275144c364e1b"\n    },\n    "probe.mjs": {\n      "bytes": 4510,\n      "sha256": "41c85b6c0bd7845cdaa44df496cc5f22c129b5ddb1ccb9794e0ebf2b58d1e08b"\n    },\n    "source-sha256.txt": {\n      "bytes": 578,\n      "sha256": "41355f5cf25174405506f68d3f6677c0e1cde6f4cacdcc5823b5334b2859462f"\n    }\n  },\n  "markers": {\n    "gpu-started": false,\n    "gpu-identity.txt": false,\n    "result.json": false,\n    "original": false,\n    "enable-gpu": false\n  }\n}\n')
assert'ZONE_RESOURCE_POOL_EXHAUSTED_WITH_DETAILS'in recorded_failure['nodes']['psigreen-l4spotnodeset-30']
queue=run(['squeue','-h','-u',getpass.getuser(),'-o','%i|%j|%T|%P'])
assert not any(any(name in r for name in ['molarium-driver-binding','molarium-qualified-controls','molarium-device-discovery'])for r in queue.splitlines())
nodes=run(['scontrol','show','nodes','-o']);healthy=[];excluded=[]
for row in nodes.splitlines():
 fields=dict(w.split('=',1)for w in row.split()if'='in w)
 name=fields.get('NodeName','');parts=fields.get('Partitions','').split(',')
 if not set(parts)&{'gpu','l4spot'}:continue
 assert fields['Gres']=='gpu:1'and int(fields['RealMemory'])>=14336 and int(fields['CPUTot'])>=4
 state_value=fields['State']
 booted=fields.get('BootTime')not in [None,'None'] and fields.get('SlurmdStartTime')not in [None,'None']
 ready=any(s in state_value for s in ['ALLOCATED','IDLE','MIXED'])and not any(s in state_value for s in ['DOWN','POWER','DRAIN','FAIL','NOT_RESPOND'])
 (healthy if booted and ready else excluded).append(name)
assert healthy and excluded
for part in ['gpu','l4spot']:assert'State=UP'in run(['scontrol','show','partition',part])
root=Path('/workspacenfs/rafal_wiewiora/molarium-nvidia-device-discovery-20261117-attempt002');assert not root.exists()
assert datetime.datetime.now(datetime.timezone.utc)<datetime.datetime(2026,11,20,22,30,tzinfo=datetime.timezone.utc)
root.mkdir();(root/'logs').mkdir()
for name in list(manifest)+['source-manifest.json','source-sha256.txt']:(root/name).write_bytes((old/name).read_bytes())
for name,digest in manifest.items():assert sha(root/name)==digest
assert sha(root/'source-manifest.json')==pin
parent={'jobId':20230,'state':state,'noPayloadMarkers':True,'logs':[],'identity':identity,'failedNodeCurrent':failed_node,'recordedFailure':recorded_failure,'sourceManifestSha256':pin,'scientificCallsRepeated':0}
(root/'recovery-parent.json').write_text(json.dumps(parent,indent=2)+'\n')
command=['sbatch','--parsable','--partition=gpu,l4spot','--exclude='+','.join(excluded),'--ntasks=1','--cpus-per-task=4','--mem=14G','--gres=gpu:1','--time=00:10:00','--deadline=2026-11-20T22:30:00','--nice=0','--no-requeue','--job-name=molarium-device-discovery','--comment=project:molarium,experiment:nvidia-device-discovery,owner:rafal','--output=logs/gpu-%j.log','gpu.sh']
job=run(command,root).strip();assert job.isdigit()
r={'schema':'molarium.existing-node-capability-retry.v1','jobId':int(job),'submittedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'root':str(root),'owner':'rafal','identity':identity,'cluster':'psigreen','controller':'psigreen-controller','sourceManifestSha256':pin,'parent':parent,'healthyBootedNodesAtSubmission':healthy,'excludedUnbootedOrUnreadyNodes':excluded,'nodeInventory':nodes,'activeQueueBefore':queue,'partitions':['gpu','l4spot'],'cpu':4,'memory':'14G','gpuCount':1,'timeLimitMinutes':10,'nice':0,'qos':'normal','requeue':False,'retentionDeadline':'2026-11-20T22:30:00Z','newNativeForwards':0,'modelCallsPlanned':0,'newVmActions':0,'sourceChanges':0,'numericalGateChanges':0,'completedCalculationsRepeated':0,'policy':'One explicit immutable no-requeue retry on already booted managed capacity. Waits normally for genuine allocation; no job takeover, priority/cluster change or automatic replacement loop.'}
(root/'submission.json').write_text(json.dumps(r,indent=2)+'\n');r['liveJob']=run(['scontrol','show','job',job,'-o']);print(json.dumps(r))
'''
command=['gcloud','compute','ssh','rafal_wiewiora_psivant_com@psigreen-login-001','--project=psivant-prod','--zone=us-central1-c','--tunnel-through-iap','--account=rafal.wiewiora@psithera.com','--ssh-flag=-o BatchMode=yes','--ssh-flag=-o LogLevel=ERROR','--verbosity=error','--command=python3 -c '+shlex.quote(remote)]
x=subprocess.run(command,text=True,capture_output=True,timeout=90);assert x.returncode==0,x.stderr
r=json.loads(x.stdout);p=ops/'nvidia-device-discovery-20261117-attempt002';p.mkdir();(p/'submission.json').write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps({k:v for k,v in r.items()if k not in ['nodeInventory','activeQueueBefore','liveJob','parent','healthyBootedNodesAtSubmission','excludedUnbootedOrUnreadyNodes']},indent=2));print('eligibleAlreadyBooted',len(r['healthyBootedNodesAtSubmission']),'excluded',len(r['excludedUnbootedOrUnreadyNodes']));print(r['liveJob'])
