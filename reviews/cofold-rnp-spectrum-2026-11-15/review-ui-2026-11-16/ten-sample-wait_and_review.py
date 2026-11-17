"""Wait for the existing completed report, then review its real ten-sample files.

No model, scheduler, scientific analysis, git or deployment operations.
"""
from pathlib import Path
import datetime
import hashlib
import importlib.util
import json
import os
import signal
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parent
OPS=ROOT.parent
REPO=Path('/Users/bb/repos/marco/tmp/molarium-chemrxiv-v1')
PREPARER=OPS/'final-report-preparer-20261116-attempt001/result'
PREPARER_PID=36066
DEADLINE=datetime.datetime(2026,11,17,5,30,tzinfo=datetime.timezone.utc)
now=lambda:datetime.datetime.now(datetime.timezone.utc)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()


def save(p,value):
    q=p.with_suffix('.tmp');q.write_text(json.dumps(value,indent=2)+'\n');q.replace(p)


def run(command,log,environment, per_case=False):
    remaining=(DEADLINE-now()).total_seconds()
    if remaining<=0:raise TimeoutError('Finite UI deadline reached')
    with log.open('xb')as stream:
        child=subprocess.Popen(command,cwd=REPO,env=environment,stdin=subprocess.DEVNULL,
                               stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
        state['childPid']=child.pid;save(OUT/'progress.json',state)
        try:code=child.wait(timeout=min(600, remaining) if per_case else remaining+30)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid,signal.SIGTERM)
            try:child.wait(timeout=10)
            except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
            raise
    if code:raise RuntimeError('UI child failed with exit code '+str(code))


OUT=ROOT/'result';OUT.mkdir()
pins=json.loads((ROOT/'source-pins.json').read_bytes())
frozen=json.loads((ROOT/'source-manifest.json').read_bytes())
assert (DEADLINE-now()).total_seconds()>0
verify=lambda:all(sha(REPO/name)==digest for name,digest in pins.items())and all(sha(ROOT/name)==digest for name,digest in frozen.items())
state={'status':'waiting-for-existing-publication','preparerPid':PREPARER_PID,
       'deadline':DEADLINE.isoformat(),'newNeuralForwards':0,'publicationActions':0,'plannedCases':48,'samplesPerCase':10}
try:
    while True:
        if now()>=DEADLINE:raise TimeoutError('Finite UI deadline reached')
        if not verify():raise ValueError('Frozen UI source changed; no new UI run attempted')
        source=json.loads((PREPARER/'progress.json').read_bytes())
        state.update(sourceState=source['status'],checkedAt=now().isoformat());save(OUT/'progress.json',state)
        if source['status']=='prepared-for-review':break
        if source['status']not in ['waiting','preparing']:raise RuntimeError('Existing report preparer needs attention')
        handle=subprocess.run(['ps','-p',str(PREPARER_PID),'-o','command='],text=True,capture_output=True)
        if handle.returncode or 'prepare_rnp_publication.py'not in handle.stdout or str(PREPARER)not in handle.stdout:
            if json.loads((PREPARER/'progress.json').read_bytes())['status']=='prepared-for-review':break
            raise RuntimeError('Expected existing report preparer is not live; no restart')
        time.sleep(30)
    source=json.loads((PREPARER/'progress.json').read_bytes())
    assert source['status']=='prepared-for-review'
    publication=PREPARER/'publication'
    receipt=json.loads((publication/'receipt.json').read_bytes())
    assert receipt['status']=='prepared-for-review'and source['receiptSha256']==sha(publication/'receipt.json')
    assert receipt['newNeuralForwards']==receipt['publicationActions']==0
    # The existing preparer did the independent score/graph verification. Bind every original artifact here.
    for entry in receipt['files']:
        p=publication/entry['path']
        assert p.resolve().is_relative_to(publication.resolve())and p.stat().st_size==entry['bytes']and sha(p)==entry['sha256']
    exports=publication/'checkpoint-480/review-libraries'
    manifest=json.loads((exports/'manifest.json').read_bytes())
    assert manifest['samplesPerCase']==10 and len(manifest['caseIds'])==48 and len(manifest['libraries'])==96
    assert manifest['independentVerification']['scope']=='complete' and manifest['independentVerification']['recomputedPredictions']==480
    first=manifest['caseIds'][0]
    preflight=OUT/'preflight';preflight.mkdir()
    save(preflight/'source-pins.json',pins)
    state.update(status='running-ten-sample-preflight',caseId=first,sourceReceiptSha256=sha(publication/'receipt.json'))
    save(OUT/'progress.json',state)
    environment={**os.environ,'CHROME_PATH':str(ROOT/'chrome-software-review.sh'),
        'MOLARIUM_STOCK_REVIEW_REQUIRE_SOFTWARE':'1','MOLARIUM_STOCK_REVIEW_EXPORTS':str(exports),
        'MOLARIUM_STOCK_REVIEW_CASE_ID':first,'MOLARIUM_STOCK_REVIEW_REPORT':str(preflight/'result.json'),
        'MOLARIUM_STOCK_REVIEW_SCREENSHOT':str(preflight/'review.png')}
    run(['bun','scripts/stock-cofold-review.browser.mjs'],preflight/'browser.log',environment,per_case=True)
    if not verify():raise ValueError('Frozen sources changed during actual ten-sample preflight')
    spec=importlib.util.spec_from_file_location('frozen_cohort_runner',ROOT/'runner.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.validate_result(json.loads((preflight/'result.json').read_bytes()),manifest,sha(exports/'manifest.json'),first,exports)
    cohort_deadline=min(DEADLINE,now()+datetime.timedelta(hours=3.5))
    state.update(status='running-all48-ten-sample-review',cohortDeadline=cohort_deadline.isoformat());save(OUT/'progress.json',state)
    run([sys.executable,str(ROOT/'runner.py'),'--repository',str(REPO),'--exports',str(exports),
         '--chrome-wrapper',str(ROOT/'chrome-software-review.sh'),'--preflight',str(preflight),
         '--output',str(OUT/'cohort'),'--deadline',cohort_deadline.isoformat()],OUT/'cohort.log',os.environ.copy())
    if not verify():raise ValueError('Frozen sources changed during ten-sample cohort')
    run([sys.executable,str(ROOT/'verify-saved-cohort.py'),'--cohort',str(OUT/'cohort'),
         '--exports',str(exports),'--output',str(OUT/'saved-receipt-verification.json')],OUT/'verification.log',os.environ.copy())
    state.update(status='verified-for-review',finishedAt=now().isoformat(),
                 verificationSha256=sha(OUT/'saved-receipt-verification.json'))
    save(OUT/'progress.json',state)
except Exception as exc:
    state.update(status='needs-attention',error=str(exc),finishedAt=now().isoformat(),scienceRestarted=False)
    save(OUT/'progress.json',state);raise
