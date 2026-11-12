"""Capture a source-side output inventory only after verifying its job stopped."""
import argparse
import hashlib
import json
from pathlib import Path
import time


def main():
    p=argparse.ArgumentParser();p.add_argument('--native',type=Path,required=True);p.add_argument('--job-id',required=True)
    p.add_argument('--job-state',choices=['CANCELLED','NODE_FAIL','PREEMPTED','FAILED','TIMEOUT','OUT_OF_MEMORY'],required=True)
    a=p.parse_args();receipt=a.native/'receipt.json';r=json.loads(receipt.read_text())
    recorded_job=r.get('executionConfig',{}).get('slurmJobId')
    if recorded_job is not None and recorded_job!=a.job_id:raise ValueError('Scheduler job differs from native receipt')
    target=a.native/'stopped-output-inventory.json'
    if target.exists():raise ValueError('Preserve the existing stopped-source inventory')
    files={str(f.relative_to(a.native)):{'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'bytes':f.stat().st_size}
      for f in sorted(a.native.rglob('*'))if f.is_file()and f.suffix in ['.cif','.pdb']and '_model'in f.name}
    if not files:raise ValueError('No saved model outputs; do not claim completed science')
    record={'schema':'molarium.stopped-native-output-inventory.v1','nativeReceiptSha256':hashlib.sha256(receipt.read_bytes()).hexdigest(),
      'stoppedJob':{'id':a.job_id,'state':a.job_state},'files':files,'capturedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    target.write_text(json.dumps(record,indent=2)+'\n');print(json.dumps({'outputs':len(files),'inventory':str(target)}))


if __name__=='__main__':main()
