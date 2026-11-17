"""One declared physical-Apple trained-trunk measurement, then raw-array analysis."""
from pathlib import Path
import datetime,hashlib,json,os,signal,subprocess,time
ROOT=Path(__file__).resolve().parent;FIXTURE=ROOT.parent/'trained-trunk-apple-20261117-attempt001/fixture';TRANSFER=FIXTURE.parent;REPO=ROOT/'frozen'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
source=json.loads((ROOT/'source-manifest.json').read_bytes());pins=json.loads((ROOT/'production-source-pins.json').read_bytes())
def verify():
 assert all(sha(ROOT/n)==h for n,h in source.items())
 assert all(sha(REPO/n)==h for n,h in pins.items())
def save(value):
 p=ROOT/'progress.json';q=ROOT/'progress.tmp';q.write_text(json.dumps(value,indent=2)+'\n');q.replace(p)
state={'status':'starting','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'newNativeCalls':0,'newConversions':0,'newSlurmJobs':0,'plannedBrowserTrunkCycles':4,'plannedBoundaries':32,'planSha256':sha(ROOT/'plan.json')};save(state)
try:
 verify();assert json.loads((TRANSFER/'transfer-receipt.json').read_bytes())['status']=='verified'
 # A distinct physical-Apple control. The separate NVIDIA allocation is unchanged.
 env={**os.environ,'CHROME_PATH':'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','MOLARIUM_REQUIRE_NVIDIA':'0','MOLARIUM_HEADLESS_SOFTWARE_WEBGPU':'0','OPENBLAS_NUM_THREADS':'1','PYTHONPYCACHEPREFIX':'/private/tmp/molarium-cofold-pycache'}
 with(ROOT/'browser.log').open('xb')as log:
  child=subprocess.Popen(['bun',str(ROOT/'runner.mjs'),str(FIXTURE),str(ROOT/'measured')],cwd=REPO,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  state.update(status='measuring',browserPid=child.pid);save(state)
  try:code=child.wait(timeout=1800)
  except subprocess.TimeoutExpired:
   os.killpg(child.pid,signal.SIGTERM)
   try:child.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
   raise
 state['measurementExitCode']=code;verify()
 if code:raise RuntimeError('Browser measurement did not complete; preserve original outputs')
 raw=json.loads((ROOT/'measured/receipt.json').read_bytes())
 assert raw['status']=='complete'and len(raw['outputs'])==32 and len(raw['records'])==4 and'apple'in json.dumps(raw['adapter']).lower()
 state.update(status='analyzing',measuredBrowserTrunkCycles=4,capturedBoundaries=32);save(state)
 with(ROOT/'analysis.log').open('xb')as log:
  result=subprocess.run(['/Users/bb/repos/marco/tmp/molarium-cofold-analysis-env/bin/python',str(REPO/'folding/comparison/check_trained_trunk.py'),'--fixture',str(FIXTURE),'--measured',str(ROOT/'measured'),'--output',str(ROOT/'analysis.json')],cwd=REPO,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=300)
 verify();analysis=json.loads((ROOT/'analysis.json').read_bytes());assert len(analysis['records'])==32
 state.update(status='measured-pass'if analysis['passesAllDeclaredGates']else'measured-gates-failed',analysisExitCode=result.returncode,analysisSha256=sha(ROOT/'analysis.json'),measurementReceiptSha256=sha(ROOT/'measured/receipt.json'),finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
 save(state)
except Exception as exc:
 state.update(status='needs-attention',error=str(exc),finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),scienceRestarted=False);save(state);raise
