"""Stage preserved attempts for analysis; never execute or repeat a prediction.

All sources and plans must agree. A completed prediction cannot be replaced or
duplicated. Later attempts may resolve unfinished records; every original
progress snapshot remains in the staged provenance.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def save(path,value):path.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n')


def merge(batches,output):
    if len(batches)<2 or len({p.resolve()for p in batches})!=len(batches):raise ValueError('Distinct source attempts required')
    source_info=[];chosen={};history=[];common=None;plan_raw=None
    for number,batch in enumerate(batches):
        manifest=json.loads((batch/'source-manifest.json').read_bytes())
        for name,digest in manifest.items():
            if Path(name).name!=name or sha(batch/'source'/name)!=digest:raise ValueError('Consumed source integrity mismatch')
        if common is not None and manifest!=common:raise ValueError('Different consumed code cannot be silently merged')
        common=manifest
        raw=(batch/'frozen-plan/plan.json').read_bytes()
        if plan_raw is not None and raw!=plan_raw:raise ValueError('Source attempts used different frozen plans')
        plan_raw=raw;plan=json.loads(raw)
        for job in plan['jobs']:
            path=Path(job['input'])
            if path.is_absolute()or '..'in path.parts or sha(batch/'frozen-plan'/path)!=job['inputSha256']:
                raise ValueError('Frozen input identity mismatch')
        for pair in plan['pairs']:
            for field,digest in [('nativeScoreFile','nativeScoreSha256'),('referenceFile','referenceSha256')]:
                path=Path(pair[field])
                if path.is_absolute()or '..'in path.parts or sha(batch/'reference-evidence'/path)!=pair[digest]:raise ValueError('Frozen reference identity mismatch')
        progress_raw=(batch/'progress.json').read_bytes();progress=json.loads(progress_raw)
        if progress['planSha256']!=hashlib.sha256(raw).hexdigest():raise ValueError('Source progress/plan identity mismatch')
        label='attempt-'+str(number).zfill(3);source_info.append({'id':label,'progressSha256':hashlib.sha256(progress_raw).hexdigest(),
             'sourceManifestSha256':sha(batch/'source-manifest.json'),'startedAt':progress.get('startedAt'),'stateAtSnapshot':progress['status']})
        seen=set()
        for record in progress['records']:
            index=record['index']
            if not isinstance(index,int)or not 0<=index<len(plan['jobs'])or index in seen:raise ValueError('Repeated or invalid prediction index')
            seen.add(index);job=plan['jobs'][index]
            if any(record[k]!=job[k]for k in ['caseId','model','seed']):raise ValueError('Attempt/job identity mismatch')
            if index in chosen and chosen[index][1]['status']=='complete':
                raise ValueError('Repeated completed prediction or overlapping later attempt; explicit audit required')
            relative=Path(record['directory'])
            if relative.is_absolute()or '..'in relative.parts:raise ValueError('Attempt directory escapes source')
            directory=batch/relative
            if record['status']=='complete':
                if sha(directory/'receipt.json')!=record['receiptSha256']or sha(directory/'score.json')!=record['scoreSha256']:raise ValueError('Completed checkpoint hash mismatch')
                receipt=json.loads((directory/'receipt.json').read_bytes())
                if receipt['status']!='complete'or receipt.get('neuralInferenceCompleted')is not True or receipt['inputSha256']!=job['inputSha256']:
                    raise ValueError('Incomplete or mismatched neural receipt')
                for name,meta in receipt['outputs'].items():
                    path=Path(name)
                    if path.is_absolute()or '..'in path.parts or sha(directory/path)!=meta['sha256']:raise ValueError('Completed output identity mismatch')
            history.append({'source':label,**record})
            chosen[index]=(number,record,directory)
        source_info[-1]['rawProgress']=progress_raw.decode()
    output.mkdir(exist_ok=False)
    shutil.copytree(batches[0]/'frozen-plan',output/'frozen-plan');shutil.copytree(batches[0]/'reference-evidence',output/'reference-evidence')
    shutil.copytree(batches[0]/'source',output/'source');shutil.copyfile(batches[0]/'source-manifest.json',output/'source-manifest.json')
    (output/'source-attempts').mkdir();records=[];selections=[]
    for source in source_info:
        (output/'source-attempts'/(source['id']+'.progress.json')).write_text(source.pop('rawProgress'))
    for source,batch in zip(source_info,batches):
        shutil.copyfile(batch/'source-manifest.json',output/'source-attempts'/(source['id']+'.source-manifest.json'))
    for index,(source,record,directory)in sorted(chosen.items()):
        target=output/'predictions'/str(index).zfill(3);target.mkdir(parents=True)
        if record['status']in ['complete','failed']:
            for name in ['input.json','receipt.json','prediction.pdb','job.zip','upstream.log','archive-check.log','failure.txt','profile-retirement.json','score.json']:
                path=directory/name
                if path.is_file():
                    try:os.link(path,target/name)
                    except OSError:shutil.copyfile(path,target/name)
            log=batches[source]/f'{index:03d}-launcher.log'
            if log.is_file():shutil.copyfile(log,output/log.name)
        records.append({**record,'directory':str(target.relative_to(output))});selections.append({'index':index,'source':source_info[source]['id'],'status':record['status']})
    progress={'status':'data-only-combined-snapshot','planSha256':hashlib.sha256(plan_raw).hexdigest(),
              'planned':len(plan['jobs']),'records':records,'sourceAttempts':source_info,'newNeuralForwards':0}
    save(output/'progress.json',progress)
    save(output/'merge-receipt.json',{'schema':'molarium.stock-attempt-merge.v1','createdAt':datetime.now(timezone.utc).isoformat(),
         'planSha256':progress['planSha256'],'sources':source_info,'selections':selections,'attemptHistory':history,
         'completedPredictions':sum(r['status']=='complete'for r in records),'newNeuralForwards':0,
         'scope':'Storage/analysis staging only. Original attempts unchanged. Complete checkpoint files are linked or copied without coordinate edits.'})
    return {'completed':sum(r['status']=='complete'for r in records),'planned':len(plan['jobs']),'sourceAttempts':len(batches),'newNeuralForwards':0}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--batch',type=Path,action='append',required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();print(json.dumps(merge(a.batch,a.output)))
