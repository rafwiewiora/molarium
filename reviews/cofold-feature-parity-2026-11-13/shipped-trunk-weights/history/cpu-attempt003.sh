#!/bin/bash
set -euo pipefail
export TZ=UTC OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 PYTHONDONTWRITEBYTECODE=1
export CUDA_VISIBLE_DEVICES=""
task_root=/workspacenfs/rafal_wiewiora/molarium-shipped-trunk-weight-audit-20261117-attempt003
cd "$task_root"
/workspacenfs/rafal_wiewiora/molarium-native-cofold-20261112-attempt002/environments/openbind0/bin/python - <<'PY'
from pathlib import Path
import datetime,hashlib,json,os,socket,subprocess,urllib.request
r=Path.cwd()
m='http://metadata.google.internal/computeMetadata/v1/'
i={k:urllib.request.urlopen(urllib.request.Request(m+k,headers={'Metadata-Flavor':'Google'}),timeout=10).read().decode()for k in ['project/project-id','instance/name','instance/id','instance/zone']}
assert i['project/project-id']=='psivant-prod' and i['instance/zone'].endswith('/us-central1-a')
c=subprocess.check_output(['scontrol','show','config'],text=True)
assert 'ClusterName             = psigreen' in c and 'psigreen-controller' in c
assert os.environ['SLURM_JOB_PARTITION']=='compute' and int(os.environ['SLURM_CPUS_PER_TASK'])>=2
assert int(os.environ['SLURM_MEM_PER_NODE'])>=6144
hosts=subprocess.check_output(['scontrol','show','hostnames',os.environ['SLURM_JOB_NODELIST']],text=True).split()
assert i['instance/name'] in hosts and socket.gethostname().split('.')[0] in hosts
job=subprocess.check_output(['scontrol','show','job',os.environ['SLURM_JOB_ID'],'-o'],text=True)
assert 'Nice=0' in job and 'QOS=normal' in job
assert 'gres/gpu' not in job and not os.environ.get('SLURM_JOB_GPUS')
manifest=json.loads((r/'source-manifest.json').read_bytes())
for name,digest in manifest.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==digest,name
(r/'allocation.json').write_text(json.dumps({'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'identity':i,'job':job,'cpus':os.environ['SLURM_CPUS_PER_TASK'],'memoryMiB':os.environ['SLURM_MEM_PER_NODE'],'gpuRequests':0,'newModelCalls':0},indent=2)+'\n')
(r/'audit-started').write_text(datetime.datetime.now(datetime.timezone.utc).isoformat()+'\n')
PY
mkdir results
srun --ntasks=1 --cpus-per-task=2 --cpu-bind=cores /workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261113-attempt002/tools/bun-linux-x64/bun repo/folding/comparison/audit_shipped_trunk_weights.mjs plan.json results/measurement
srun --ntasks=1 --cpus-per-task=2 --cpu-bind=cores /workspacenfs/rafal_wiewiora/molarium-native-cofold-20261112-attempt002/environments/openbind0/bin/python repo/folding/comparison/check_shipped_trunk_quantization.py --plan plan.json --measurement results/measurement --output results/independent-reencoding.json
