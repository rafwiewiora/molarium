"""Wait for verified alignments, then execute one immutable physical-GPU stock batch.

No new remote jobs, VMs, replacements, or retries are submitted by this monitor.
Every case and all ten seeds are frozen before the first neural prediction.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tarfile
import time

def sha(path):
    h=hashlib.sha256()
    with path.open('rb')as f:
        for block in iter(lambda:f.read(4*1024*1024),b''):h.update(block)
    return h.hexdigest()


def save(path,value):
    temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(value,indent=2)+'\n');temporary.replace(path)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['ops','repository','upstream-root','components','output','remote-config']:p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--parent-job',required=True);p.add_argument('--prep-job',required=True)
    p.add_argument('--wait-hours',type=float,default=12);p.add_argument('--frozen',action='store_true')
    a=p.parse_args()
    if not a.parent_job.isdigit() or not a.prep_job.isdigit() or not 0<a.wait_hours<=24:
        raise ValueError('Bounded wait and exact existing Slurm IDs required')
    if not a.frozen:
        a.output.mkdir(exist_ok=False);source=a.output/'source';source.mkdir()
        names=['wait_rnp_stock.py','prepare_rnp_stock_plan.py','run_stock_benchmark.py','run_stock_localfold.py',
               'score_stock_localfold.py','pose_metrics.py','experimental_reference.py','requirements-analysis.txt',
               'assemble_stock_benchmark.py','check_stock_benchmark.py']
        for name in names:shutil.copyfile(Path(__file__).with_name(name),source/name)
        save(a.output/'source-manifest.json',{name:sha(source/name)for name in names})
        shutil.copyfile(a.remote_config,a.output/'remote-config.json')
        (a.output/'remote-config.sha256').write_text(sha(a.output/'remote-config.json')+'\n')
        os.execv(sys.executable,[sys.executable,str(source/'wait_rnp_stock.py'),*sys.argv[1:],'--frozen'])
    pins=json.loads((a.output/'source-manifest.json').read_bytes())
    remote=json.loads((a.output/'remote-config.json').read_bytes())
    if any(not isinstance(remote.get(k),str) or not remote[k] for k in ['root','host','project','zone','account','instanceId','cluster','controller']):
        raise ValueError('An explicit assigned remote identity/configuration is required')
    gcp=['--project='+remote['project'],'--zone='+remote['zone'],'--tunnel-through-iap','--account='+remote['account'],'--verbosity=error']
    def verify():
        for name,digest in pins.items():
            if sha(Path(__file__).with_name(name))!=digest:raise ValueError('Frozen workflow source changed: '+name)
        if sha(a.output/'remote-config.json')!=(a.output/'remote-config.sha256').read_text().strip():
            raise ValueError('Assigned remote configuration changed')
    verify();created=datetime.now(timezone.utc).isoformat()
    progress={'status':'waiting-for-verified-alignments','startedAt':created,'parentJob':a.parent_job,'prepJob':a.prep_job,
              'newRemoteSubmissions':0,'newNeuralPredictions':0,'waitLimitHours':a.wait_hours}
    save(a.output/'progress.json',progress)
    remote_code=r'''import json,re,subprocess,urllib.request
from pathlib import Path
expected='''+repr(remote)+r'''
def meta(key):
 return urllib.request.urlopen(urllib.request.Request('http://metadata.google.internal/computeMetadata/v1/'+key,headers={'Metadata-Flavor':'Google'})).read().decode()
assert meta('project/project-id')==expected['project']
assert meta('instance/id')==expected['instanceId']
assert meta('instance/zone').endswith('/'+expected['zone'])
conf=subprocess.check_output(['scontrol','show','config'],text=True)
assert re.search(r'^SlurmctldHost.*'+re.escape(expected['controller'])+r'\b',conf,re.M)
assert re.search(r'^ClusterName\s*=\s*'+re.escape(expected['cluster'])+r'\s*$',conf,re.M)
root=Path(expected['root'])
receipt=root/'stock-msas001.transfer.json'
value={'ready':receipt.exists()}
if receipt.exists():value['transfer']=json.loads(receipt.read_text())
else:
 value['jobs']=subprocess.check_output(['sacct','-n','-X','-j','''+repr(a.parent_job+','+a.prep_job)+''','--format=JobIDRaw,State,ExitCode','-P'],text=True)
 path=root/'msa001/progress.json'
 if path.exists():value['progress']=json.loads(path.read_text())
print(json.dumps(value))
'''
    deadline=time.monotonic()+a.wait_hours*3600;errors=0
    try:
        while True:
            verify()
            if time.monotonic()>deadline:raise TimeoutError('Bounded alignment wait expired; no new work was submitted')
            command=['gcloud','compute','ssh',remote['host'],*gcp,'--ssh-flag=-o BatchMode=yes','--ssh-flag=-o LogLevel=ERROR',
                     '--command=python3 -c '+shlex.quote(remote_code)]
            result=subprocess.run(command,capture_output=True,text=True,timeout=60)
            if result.returncode:
                errors+=1;progress['lastTransportError']=result.stderr[-2000:];save(a.output/'progress.json',progress)
                if errors>=3:raise RuntimeError('Three failed transport/authentication checks; existing science was not repeated')
                time.sleep(60);continue
            errors=0;state=json.loads(result.stdout);progress['remote']=state;progress['checkedAt']=datetime.now(timezone.utc).isoformat()
            save(a.output/'progress.json',progress);print(json.dumps(state),flush=True)
            if state['ready']:break
            if any(word in state.get('jobs','') for word in ['FAILED','CANCELLED','NODE_FAIL','TIMEOUT','OUT_OF_MEMORY']):
                raise RuntimeError('Existing alignment/preparation job ended unsuccessfully; no automatic retry')
            time.sleep(60)
        transfer=state['transfer'];selection=a.ops/'selection001.json'
        if transfer['selectionSha256']!=sha(selection) or transfer['cases']!=48 or transfer['bytes']>1024**3:
            raise ValueError('Unexpected transfer identity, count or size')
        save(a.output/'transfer-receipt.json',transfer)
        archive=a.output/'stock-msas001.tar.gz'
        subprocess.run(['gcloud','compute','scp',remote['host']+':'+remote['root']+'/stock-msas001.tar.gz',str(archive),*gcp,
                        '--scp-flag=-o BatchMode=yes'],check=True,timeout=1800)
        if archive.stat().st_size!=transfer['bytes'] or sha(archive)!=transfer['sha256']:
            raise ValueError('Alignment transfer checksum mismatch')
        extracted=a.output/'alignment-evidence';extracted.mkdir()
        with tarfile.open(archive)as t:
            for member in t:
                path=Path(member.name)
                if path.is_absolute()or '..'in path.parts or path.parts[0]!='stock-msas001':raise ValueError('Unsafe transfer path')
                target=extracted/path
                if member.isdir():target.mkdir(parents=True,exist_ok=True)
                elif member.isfile()and member.size<=100*1024*1024:
                    target.parent.mkdir(parents=True,exist_ok=True)
                    with target.open('xb')as f:shutil.copyfileobj(t.extractfile(member),f)
                else:raise ValueError('Unsupported transfer member')
        from prepare_rnp_stock_plan import prepare
        plan=a.output/'frozen-input-plan'
        prepared=prepare(selection,a.repository,extracted/'stock-msas001',a.components,plan)
        if prepared['jobs']!=480 or prepared['pairs']!=48:raise ValueError('Frozen benchmark count changed')
        progress.update(status='running-stock-benchmark',prepared=prepared);save(a.output/'progress.json',progress);verify()
        with (a.output/'stock-batch.log').open('x')as log:
            code=subprocess.run([sys.executable,str(Path(__file__).with_name('run_stock_benchmark.py')),
                '--plan',str(plan/'plan.json'),'--repository',str(a.repository),'--upstream-root',str(a.upstream_root),
                '--launcher',str(Path(__file__).with_name('run_stock_localfold.py')),'--output',str(a.output/'stock-batch'),
                '--require-vendor','apple'],stdout=log,stderr=subprocess.STDOUT).returncode
        progress.update(status='stock-batch-complete'if code==0 else'stock-batch-stopped',returnCode=code,
                        batchProgress=str(a.output/'stock-batch/progress.json'))
        save(a.output/'progress.json',progress)
        if code:raise RuntimeError('Stock batch stopped; preserve completed attempts and inspect its progress before any retry')
    except BaseException as e:
        progress.update(status='stopped',error=str(e));raise
    finally:
        progress['updatedAt']=datetime.now(timezone.utc).isoformat();save(a.output/'progress.json',progress)


if __name__=='__main__':main()
