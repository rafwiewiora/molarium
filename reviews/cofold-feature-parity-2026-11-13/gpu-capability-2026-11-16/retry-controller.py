"""One immutable retry after a verified pre-payload Spot node failure."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import subprocess
import time
import urllib.request


def command(args, cwd=None):
    return subprocess.check_output(args, cwd=str(cwd) if cwd else None, text=True)


os.environ['TZ'] = 'UTC'
time.tzset()
meta = 'http://metadata.google.internal/computeMetadata/v1/'
identity = {k: urllib.request.urlopen(urllib.request.Request(meta + k,
            headers={'Metadata-Flavor': 'Google'})).read().decode()
            for k in ['project/project-id', 'instance/zone', 'instance/id']}
assert identity['project/project-id'] == 'psivant-prod'
assert identity['instance/zone'].endswith('/us-central1-c')
assert identity['instance/id'] == '3894148826269628555'
config = command(['scontrol', 'show', 'config'])
assert 'ClusterName             = psigreen' in config and 'psigreen-controller' in config
base = Path('/workspacenfs/rafal_wiewiora')
old = base / 'molarium-gpu-capability-20261116-attempt001'
state = command(['sacct', '-X', '-j', '20182', '-n', '-P',
                 '--format=JobID,State,ExitCode,Elapsed,Start,End,NodeList'])
rows = [line.split('|') for line in state.splitlines() if line.strip()]
assert len(rows) == 1 and rows[0][0] == '20182' and rows[0][1] == 'NODE_FAIL'
assert not (old / 'gpu-started').exists() and not (old / 'probe-result.json').exists()
assert not list((old / 'logs').iterdir()), 'Cannot call this an unstarted retry with existing logs'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(old / 'source-manifest.json') == '64bbb3c47deb0920a4aca1f73fc57e9f13a6dca9edb5083b78e096d6bd4cdfbc'
manifest = json.loads((old / 'source-manifest.json').read_bytes())
for name, digest in manifest.items():
    assert sha(old / name) == digest
queued = command(['squeue', '-h', '-u', __import__('getpass').getuser(), '-o', '%i|%j|%T|%P'])
assert not any('molarium-gpu-capability' in line for line in queued.splitlines())
assert '--deadline' in command(['sbatch', '--help'])
root = base / 'molarium-gpu-capability-20261116-attempt002'
root.mkdir()
for name in list(manifest) + ['source-manifest.json', 'source-sha256.txt']:
    (root / name).write_bytes((old / name).read_bytes())
parent = {'jobId': 20182, 'state': state, 'gpuStarted': False, 'logs': [],
          'scope': 'NODE_FAIL before task payload; no capability or model calculation ran.',
          'oldSourceManifestSha256': sha(old / 'source-manifest.json')}
(root / 'retry-parent.json').write_text(json.dumps(parent, indent=2) + '\n')
(root / 'logs').mkdir()
job = command(['sbatch', '--parsable', '--partition=gpu,l4spot', '--ntasks=1',
               '--cpus-per-task=4', '--mem=14G', '--gres=gpu:1', '--time=00:10:00',
               '--deadline=2026-11-20T22:30:00', '--nice=0', '--no-requeue',
               '--job-name=molarium-gpu-capability',
               '--comment=project:molarium,experiment:browser-capability,owner:rafal',
               '--output=logs/gpu-%j.log', 'gpu.sh'], root).strip()
assert job.isdigit()
receipt = {'schema': 'molarium.gpu-capability-retry.v1', 'jobId': int(job),
           'submittedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'identity': identity, 'cluster': 'psigreen', 'controller': 'psigreen-controller',
           'owner': 'rafal', 'purpose': 'Physical NVIDIA browser capability and logging only; no model calls.',
           'sourceManifestSha256': sha(root / 'source-manifest.json'), 'sourcesUnchanged': True,
           'cpu': 4, 'memory': '14G', 'gpuCount': 1, 'timeLimit': '10min', 'nice': 0,
           'partitions': ['gpu', 'l4spot'], 'retentionDeadline': '2026-11-20T22:30:00Z',
           'slurmDeadline': '2026-11-20T22:30:00', 'parent': parent,
           'controllerSha256': sha(Path(__file__)), 'standaloneVmActions': []}
(root / 'submission.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
print(command(['scontrol', 'show', 'job', job]))
