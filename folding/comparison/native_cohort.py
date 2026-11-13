"""Preserve validated OpenBind outputs across interrupted immutable attempts.

Plan missing query/seed groups, then assemble a full cohort without inference.
Never edit the original receipts or label an interrupted CLI run complete.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import shutil
import time
import numpy as np
from convert_native import convert
from pose_metrics import pdb_atoms


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def write(path,value):path.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n')


def receipt_identity(receipt,actual_sha):
    original=receipt.get('originalReceiptSha256')
    if original is None:return actual_sha
    if receipt.get('redactedFields')!=['argv (private absolute paths)']or not re.fullmatch('[0-9a-f]{64}',original):
        raise ValueError('Unrecognized receipt redaction; preserve exact provenance')
    return original


def validate_inventory(receipt,receipt_sha,observed,inventory=None):
    if receipt['status']=='complete':
        expected={r['path']:r['sha256']for r in receipt['outputs']}
    else:
        if inventory is None or inventory.get('nativeReceiptSha256')!=receipt_sha:
            raise ValueError('Interrupted sources require a matching source-side stopped-output inventory')
        expected={path:item['sha256']for path,item in inventory['files'].items()}
    if observed!=expected:
        raise ValueError('Output transfer is missing or changed; retrieve preserved files instead of recalculating them')


def remaining_groups(spec, completed):
    expected={(i,s)for i in range(len(spec['compounds']))for s in spec['seeds']}
    if not completed<=expected:raise ValueError('Unknown recovered query/seed')
    groups={}
    for i in range(len(spec['compounds'])):
        missing=tuple(s for s in spec['seeds']if (i,s)not in completed)
        if missing:groups.setdefault(missing,[]).append(i)
    return [{'seeds':list(seeds),'indices':indices}for seeds,indices in groups.items()]


def collect(inputs, arguments, allow_interrupted=False):
    spec=json.loads((inputs/'comparison.json').read_text());cohort_sha=sha(inputs/'comparison.json')
    sources=[];outputs=[];keys=set();checkpoint=None;protocol=None;settings=None
    for n,argument in enumerate(arguments):
        native_dir,input_dir=map(Path,argument.split('=',1));receipt_path=native_dir/'receipt.json'
        receipt=json.loads(receipt_path.read_text());source_spec=json.loads((input_dir/'comparison.json').read_text())
        if receipt['schema']!='molarium.native-cofold-receipt.v1':raise ValueError('Use original native attempt receipts, not an already assembled cohort')
        if receipt['inputSha256']!=sha(input_dir/'comparison.json'):raise ValueError('Consumed input digest mismatch')
        for name,digest in receipt['inputFiles'].items():
            source_input=(input_dir/name).resolve()
            if not source_input.is_relative_to(input_dir.resolve())or sha(source_input)!=digest:
                raise ValueError('Consumed input-file digest mismatch')
        if receipt['inputSha256']!=cohort_sha and source_spec.get('resume',{}).get('parentCohortInputSha256')!=cohort_sha:
            raise ValueError('Attempt does not descend from this cohort')
        if receipt['method']!='openbind0':raise ValueError('This recovery path requires explicit-topology OpenBind mmCIF')
        if receipt['status']!='complete'and not allow_interrupted:raise ValueError('Stop the job and explicitly allow interrupted-source recovery')
        paths=sorted(native_dir.rglob('*_model.cif'));observed={str(p.relative_to(native_dir)):sha(p)for p in paths}
        inventory_path=native_dir/'stopped-output-inventory.json'
        inventory=json.loads(inventory_path.read_text())if inventory_path.exists()else None
        actual_receipt_sha=sha(receipt_path);identity=receipt_identity(receipt,actual_receipt_sha)
        validate_inventory(receipt,identity,observed,inventory)
        if checkpoint and (receipt['checkpointSha256']!=checkpoint or receipt['protocol']!=protocol or receipt['settings']!=settings):
            raise ValueError('Attempt checkpoint/protocol differs')
        checkpoint=receipt['checkpointSha256'];protocol=receipt['protocol'];settings=receipt['settings']
        if source_spec['sequence']!=spec['sequence']:raise ValueError('Protein sequence differs')
        if source_spec.get('alignment')!=spec.get('alignment'):
            raise ValueError('Provided alignment differs from the parent cohort')
        declared={c['id']:c['smiles']for c in spec['compounds']}
        if any(declared.get(c['id'])!=c['smiles']for c in source_spec['compounds']):raise ValueError('Chemical identities differ')
        source={'id':f'part-{n:03d}','receiptSha256':identity,'inputSha256':receipt['inputSha256'],
          'originalStatus':receipt['status'],'runnerSha256':receipt['runnerSha256'],'environment':receipt['environment'],
          'executionConfig':receipt.get('executionConfig'),'elapsedSeconds':receipt.get('elapsedSeconds'),
          'startedAt':receipt['startedAt'],'finishedAt':receipt.get('finishedAt')}
        if actual_receipt_sha!=identity:source['transferredPublicReceiptSha256']=actual_receipt_sha
        if inventory is not None:source['stoppedOutputInventorySha256']=sha(inventory_path)
        saved=[];recorded={r['path']:r['sha256']for r in receipt.get('outputs',[])}
        for path in paths:
            match=re.fullmatch(r'compound_(\d+)_seed_(\d+)_sample_1_model.cif',path.name)
            if not match:raise ValueError('Unexpected native output identity')
            i,seed=map(int,match.groups());key=(i,seed)
            if i>=len(spec['compounds']) or seed not in spec['seeds']or key in keys:raise ValueError('Unknown/duplicate recovered pose')
            query_id=f'compound_{i:03d}'
            query=json.loads((input_dir/'openbind-query.json').read_text())['queries'].get(query_id)
            if query is None or query['chains'][1]['smiles']!=spec['compounds'][i]['smiles']or seed not in source_spec['seeds']:
                raise ValueError('Output is not in its consumed query/seed set')
            digest=sha(path);relative=str(path.relative_to(native_dir))
            if receipt['status']=='complete'and recorded.get(relative)!=digest:raise ValueError('Complete-attempt output hash mismatch')
            pdb,component,confidence,_layout,_proof=convert(path,spec['compounds'][i]['smiles'],spec['sequence'])
            if not np.isfinite([x['xyz']for x in pdb_atoms(pdb)]).all()or not np.isfinite(confidence).all():raise ValueError('Nonfinite native output')
            if sha(path)!=digest:raise ValueError('Source changed during recovery; stop active work before planning')
            record={'index':i,'compoundId':spec['compounds'][i]['id'],'queryId':query_id,'seed':seed,
              'source':source['id'],'path':relative,'sha256':digest,'bytes':path.stat().st_size}
            keys.add(key);saved.append(record);outputs.append({**record,'_path':path,'_inputDir':input_dir,'_source':source})
        if not saved:raise ValueError('No validated outputs in supplied attempt')
        source['savedOutputs']=saved;sources.append(source)
    if not sources:raise ValueError('At least one preserved source is required')
    return spec,cohort_sha,sources,outputs,keys,checkpoint,protocol,settings


def plan(a):
    spec,digest,sources,outputs,keys,checkpoint,protocol,settings=collect(a.inputs,a.attempt,a.allow_interrupted)
    groups=remaining_groups(spec,keys)
    if not groups:raise ValueError('Cohort is already complete; assemble it instead of submitting more science')
    alignment=None
    if spec.get('alignment'):
        alignment=(a.inputs/'msa/colabfold_main.a3m').read_bytes()
        if hashlib.sha256(alignment).hexdigest()!=spec['alignment']['sha256']:
            raise ValueError('Provided alignment file differs from its declared digest')
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.mkdir()
    query=json.loads((a.inputs/'openbind-query.json').read_text())
    runner=json.loads((a.inputs/f'openbind-{protocol}.yaml').read_text())
    for n,group in enumerate(groups):
        name=f'group-{n:03d}';folder=a.output/'groups'/name/'inputs';folder.mkdir(parents=True)
        subset=copy.deepcopy(spec);subset['compounds']=[spec['compounds'][i]for i in group['indices']];subset['seeds']=group['seeds']
        ids={c['id']for c in subset['compounds']}
        subset['browser']=[r for r in spec.get('browser',[])if r['compoundId']in ids and r['seed']in group['seeds']]
        subset['resume']={'parentCohortInputSha256':digest,'sourceReceipts':[s['receiptSha256']for s in sources],
          'purpose':'Only missing query/seed pairs; previously saved poses are excluded.'}
        write(folder/'comparison.json',subset)
        if alignment is not None:
            (folder/'msa').mkdir()
            (folder/'msa/colabfold_main.a3m').write_bytes(alignment)
        write(folder/'openbind-query.json',{'queries':{f'compound_{i:03d}':query['queries'][f'compound_{i:03d}']for i in group['indices']}})
        configured=copy.deepcopy(runner);configured['experiment_settings']['seeds']=group['seeds'];write(folder/f'openbind-{protocol}.yaml',configured)
        group.update({'id':name,'expectedPoses':len(group['indices'])*len(group['seeds']),'comparisonSha256':sha(folder/'comparison.json')})
    record={'schema':'molarium.native-resume-plan.v1','parentCohortInputSha256':digest,'method':'openbind0','protocol':protocol,
      'settings':settings,'checkpointSha256':checkpoint,'expectedCohortPoses':len(spec['compounds'])*len(spec['seeds']),
      'preservedPoses':len(outputs),'remainingPoses':sum(g['expectedPoses']for g in groups),'sources':sources,'groups':groups}
    write(a.output/'resume-plan.json',record);print(json.dumps({k:record[k]for k in ['preservedPoses','remainingPoses','groups']}))


def assemble(a):
    spec,digest,sources,outputs,keys,checkpoint,protocol,settings=collect(a.inputs,a.attempt,a.allow_interrupted)
    if remaining_groups(spec,keys):raise ValueError('Full unique query/seed coverage is required; this cohort is still incomplete')
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.mkdir()
    rows=[]
    for record in outputs:
        path=record['_path'];target=a.output/record['source']/record['path'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,target)
        if sha(target)!=record['sha256']:raise ValueError('Copied output digest mismatch')
        confidence=path.with_name(path.name.rsplit('_model.',1)[0]+'_confidences_aggregated.json')
        if confidence.exists():shutil.copy2(confidence,target.with_name(confidence.name))
        source=record['_source'];rows.append({'path':str(target.relative_to(a.output)),'sha256':record['sha256'],'bytes':record['bytes'],
          'sourceAttempt':source['id'],'environment':source['environment']})
    interrupted=any(s['originalStatus']!='complete'for s in sources)
    now=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    result={'schema':'molarium.native-assembled-cohort.v1','status':'complete','method':'openbind0','protocol':protocol,
      'settings':settings,'seeds':spec['seeds'],'inputSha256':digest,'checkpointSha256':checkpoint,'runnerSha256':None,
      'environment':sources[0]['environment']if all(s['environment']==sources[0]['environment']for s in sources)else {'gpu':'Mixed; per-output source environments retained'},
      'outputs':rows,'sources':sources,'elapsedSeconds':None if interrupted else sum(s['elapsedSeconds']for s in sources),
      'timingBoundary':'Assembled across immutable attempts. Total CLI wall time unavailable if an attempt was interrupted.',
      'startedAt':min(s['startedAt']for s in sources),'finishedAt':now,'assembledAt':now,
      'note':'This complete cohort does not relabel any interrupted native CLI as complete. Every pose is validated and preserved without inference.'}
    write(a.output/'receipt.json',result);print(json.dumps({'poses':len(rows),'sources':len(sources),'interruptedSources':interrupted}))


def main():
    parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='command',required=True)
    for name in ['plan','assemble']:
        p=sub.add_parser(name);p.add_argument('--inputs',type=Path,required=True);p.add_argument('--attempt',action='append',required=True,help='native-result-directory=exact-consumed-input-directory')
        p.add_argument('--output',type=Path,required=True);p.add_argument('--allow-interrupted',action='store_true',help='Operator has verified that all interrupted source jobs are stopped')
    a=parser.parse_args();(plan if a.command=='plan'else assemble)(a)


if __name__=='__main__':main()
