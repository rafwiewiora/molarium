"""Finite regular-queue recovery after two verified pre-payload Spot losses."""
from pathlib import Path
import datetime
import getpass
import hashlib
import json
import os
import subprocess
import time
import urllib.request


def run(args, cwd=None):
    return subprocess.check_output(args, cwd=str(cwd) if cwd else None, text=True)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    with path.open('x') as stream:
        stream.write(json.dumps(value, indent=2) + '\n')


os.environ['TZ'] = 'UTC'
time.tzset()
metadata = 'http://metadata.google.internal/computeMetadata/v1/'
identity = {key: urllib.request.urlopen(urllib.request.Request(
    metadata + key, headers={'Metadata-Flavor': 'Google'})).read().decode()
    for key in ['project/project-id', 'instance/name', 'instance/id', 'instance/zone']}
assert identity['project/project-id'] == 'psivant-prod'
assert identity['instance/name'] == 'psigreen-login-001'
assert identity['instance/id'] == '3894148826269628555'
assert identity['instance/zone'].endswith('/us-central1-c')
config = run(['scontrol', 'show', 'config'])
assert 'ClusterName             = psigreen' in config and 'psigreen-controller' in config
base = Path('/workspacenfs/rafal_wiewiora')
binding_old = base / 'molarium-gpu-driver-binding-20261116-attempt002'
controls_old = base / 'molarium-nvidia-qualified-controls-20261116-attempt001'
states = run(['sacct', '-X', '-j', '20198,20203', '-n', '-P',
              '--format=JobID,State,ExitCode,Elapsed,Start,End,NodeList'])
rows = {row[0]: row for row in (line.split('|') for line in states.splitlines() if line.strip())}
assert rows['20198'][1] == 'NODE_FAIL' and rows['20203'][1] == 'CANCELLED'
for root in [binding_old, controls_old]:
    for marker in ['gpu-started', 'model-controls-started', 'binding-result.json', 'results']:
        assert not (root / marker).exists(), (root, marker)
    assert not list((root / 'logs').iterdir()), root
queue = run(['squeue', '-h', '-u', getpass.getuser(), '-o', '%i|%j|%T|%P'])
assert not any('molarium-driver-binding' in row or 'molarium-qualified-controls' in row
               for row in queue.splitlines())
partition = run(['scontrol', 'show', 'partition', 'gpu'])
assert 'State=UP' in partition and 'psigreen-gpunodeset' in partition
inventory = run(['sinfo', '-p', 'gpu', '-N', '-h', '-o', '%N|%t|%m|%G|%C'])

binding_pin = '19ddefa9fa09f0d1ee0c9a624907b83677c041e2487fc0f48faba3a50200cdff'
controls_pin = '36a44e87c303140ef01fe2c35cac00a9c93725cdf8e9c194d3469244cfbd1e78'
for root, expected in [(binding_old, binding_pin), (controls_old, controls_pin)]:
    assert sha(root / 'source-manifest.json') == expected
    for name, digest in json.loads((root / 'source-manifest.json').read_bytes()).items():
        assert sha(root / name) == digest, name

binding = base / 'molarium-gpu-driver-binding-20261116-attempt003'
controls = base / 'molarium-nvidia-qualified-controls-20261116-attempt002'
assert not binding.exists() and not controls.exists()
for target, previous in [(binding, binding_old), (controls, controls_old)]:
    target.mkdir()
    manifest = json.loads((previous / 'source-manifest.json').read_bytes())
    for name in list(manifest) + ['source-manifest.json', 'source-sha256.txt']:
        (target / name).write_bytes((previous / name).read_bytes())
    (target / 'logs').mkdir()
    write(target / 'recovery-parent.json', {
        'parentJob': 20198 if target == binding else 20203,
        'authoritativeStates': states, 'gpuStarted': False, 'modelControlsStarted': False,
        'logs': [], 'identity': identity,
        'reason': 'Two binding attempts lost Spot nodes before payload. This bounded recovery uses only the regular managed gpu partition at normal priority.',
        'partitionInventory': inventory, 'retentionDeadline': '2026-11-20T22:30:00Z',
        'standaloneVmActions': []})

# Only the parent attempt path changes; runtime, kernels and numerical gates do not.
old_verifier = (controls_old / 'verify_sources.py').read_bytes()
old_path = b"parent = base / 'molarium-gpu-driver-binding-20261116-attempt002'"
new_path = b"parent = base / 'molarium-gpu-driver-binding-20261116-attempt003'"
assert old_verifier.count(old_path) == 1
(controls / 'verify_sources.py').write_bytes(old_verifier.replace(old_path, new_path))
manifest = json.loads((controls / 'source-manifest.json').read_bytes())
manifest['verify_sources.py'] = sha(controls / 'verify_sources.py')
(controls / 'source-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
(controls / 'source-sha256.txt').write_text(''.join(digest + '  ' + name + '\n'
                                                   for name, digest in manifest.items()))
write(controls / 'source-adaptation.json', {
    'parentSourceManifestSha256': controls_pin,
    'sourceManifestSha256': sha(controls / 'source-manifest.json'),
    'changedSourceFiles': ['verify_sources.py'],
    'oldVerifierSha256': hashlib.sha256(old_verifier).hexdigest(),
    'newVerifierSha256': sha(controls / 'verify_sources.py'),
    'onlyChange': {'from': old_path.decode(), 'to': new_path.decode()},
    'runtimeCapabilitySourceIdentical': sha(controls / 'runtime-capability.sh') == sha(binding / 'gpu.sh'),
    'newNativeForwards': 0, 'numericalGatesChanged': False})

common = ['sbatch', '--parsable', '--partition=gpu', '--ntasks=1',
          '--cpus-per-task=4', '--mem=14G', '--gres=gpu:1',
          '--deadline=2026-11-20T22:30:00', '--nice=0', '--no-requeue',
          '--output=logs/gpu-%j.log']


def submit(root, name, minutes, extra):
    job = run(common + ['--time=00:%02d:00' % minutes,
        '--job-name=' + name,
        '--comment=project:molarium,experiment:nvidia-runtime-controls,owner:rafal'] + extra + ['gpu.sh'], root).strip()
    assert job.isdigit(), job
    receipt = {
        'schema': 'molarium.regular-nvidia-recovery.v1', 'jobId': int(job),
        'submittedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'owner': 'rafal', 'cluster': 'psigreen', 'controller': 'psigreen-controller',
        'identity': identity, 'root': str(root),
        'sourceManifestSha256': sha(root / 'source-manifest.json'),
        'partitions': ['gpu'], 'cpu': 4, 'memory': '14G', 'gpuCount': 1,
        'timeLimitMinutes': minutes, 'nice': 0, 'qos': 'normal',
        'retentionDeadline': '2026-11-20T22:30:00Z', 'slurmDeadline': '2026-11-20T22:30:00Z',
        'dependencyArguments': extra, 'newNativeForwards': 0,
        'browserTrunkCyclesPlanned': 0 if minutes == 10 else 4,
        'completePosePredictionsPlanned': 0, 'standaloneVmActions': []}
    write(root / 'submission.json', receipt)
    print(json.dumps(receipt), flush=True)
    print(run(['scontrol', 'show', 'job', job]), flush=True)
    return int(job)


parent_job = submit(binding, 'molarium-driver-binding', 10, [])
submit(controls, 'molarium-qualified-controls', 30,
       ['--dependency=afterok:' + str(parent_job), '--kill-on-invalid-dep=yes'])
