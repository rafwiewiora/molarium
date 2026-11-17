"""Derive frozen stock A3Ms from checksum-verified published RnP CSV alignments."""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import tarfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def to_a3m(data, sequence, maximum=256):
    reader=csv.DictReader(io.StringIO(data.decode('utf8')))
    if reader.fieldnames!=['key','sequence']:
        raise ValueError('Expected the published Boltz key,sequence CSV')
    rows=[('query',sequence)];seen={sequence};used=[];duplicates=0;read=0
    for i,row in enumerate(reader):
        value=row['sequence'].strip()
        if not re.fullmatch(r'[A-Za-z-]+',value):
            raise ValueError('Unexpected alignment character at CSV row '+str(i))
        aligned=re.sub('[a-z]','',value)
        if len(aligned)!=len(sequence):
            raise ValueError('Alignment width differs from protein sequence')
        if i==0 and (row['key']!='0' or value!=sequence):
            raise ValueError('Published alignment query differs from actual inference sequence')
        read+=1
        if aligned in seen:
            duplicates+=1
            continue
        seen.add(aligned);rows.append(('rnp-csv-row-'+str(i),value))
        used.append({'csvRow':i,'key':row['key'],'sequenceSha256':sha(value.encode())})
        if len(rows)==maximum:
            break
    if read==0:
        raise ValueError('Empty published alignment')
    return ''.join('>'+label+'\n'+value+'\n' for label,value in rows),{
        'rowsIncludingQuery':len(rows),'sourceRowsExamined':read,'duplicateAlignedRowsSkipped':duplicates,'sourceRows':used}


def prepare(selection_file, msa_root, output):
    raw=selection_file.read_bytes();selection=json.loads(raw)
    receipt_raw=(msa_root/'receipt.json').read_bytes();receipt=json.loads(receipt_raw)
    inventory_raw=(msa_root/'members.jsonl').read_bytes()
    if selection['schema']!='molarium.rnp-spectrum-selection.v1' or receipt['status']!='complete' or not receipt['officialArchiveChecksumVerified']:
        raise ValueError('Completed checksum-verified sources and frozen selection required')
    if receipt['poolSha256']!=selection['poolSha256'] or sha(inventory_raw)!=receipt['inventorySha256']:
        raise ValueError('Alignment/candidate source identity mismatch')
    inventory={x['file']:x for x in map(json.loads,inventory_raw.splitlines())}
    output.mkdir(exist_ok=False);(output/'a3m').mkdir();(output/'csv').mkdir()
    records=[]
    for case in selection['selected']:
        if not re.fullmatch(r'[a-z0-9_-]+',case['caseId']) or not case['nativeQualification']['nativeBestA']<2:
            raise ValueError('Invalid selected native-positive case')
        name='files/'+case['systemId']+'/'+case['proteinChain']+'.csv'
        entry=inventory[name];data=(msa_root/name).read_bytes()
        if len(data)!=entry['bytes'] or sha(data)!=entry['sha256']:
            raise ValueError('Published CSV integrity mismatch')
        a3m,details=to_a3m(data,case['sequence'])
        (output/'a3m'/(case['caseId']+'.a3m')).write_text(a3m)
        (output/'csv'/(case['caseId']+'.csv')).write_bytes(data)
        records.append({'caseId':case['caseId'],'originalArchiveMember':entry['archiveMember'],
                        'sourceCsvSha256':sha(data),'a3mSha256':sha(a3m.encode()),**details})
    value={'schema':'molarium.rnp-stock-alignments.v1','status':'complete','createdAt':datetime.now(timezone.utc).isoformat(),
           'selectionSha256':sha(raw),'poolSha256':selection['poolSha256'],'sourceReceiptSha256':sha(receipt_raw),
           'sourceManifestSha256':sha(inventory_raw),'scriptSha256':sha(Path(__file__).read_bytes()),
           'policy':'Query plus first255 unique aligned rows in original published CSV order. Lowercase insertions are retained; uniqueness ignores them. No new search.',
           'records':records,'neuralForwards':0}
    (output/'alignments.json').write_text(json.dumps(value,indent=2)+'\n')
    shutil.copyfile(msa_root/'receipt.json',output/'source-receipt.json')
    shutil.copyfile(msa_root/'members.jsonl',output/'source-members.jsonl')
    shutil.copyfile(selection_file,output/'selection.json')
    shutil.copyfile(__file__,output/'prepare_rnp_msas.py')
    archive=output.with_suffix('.tar.gz')
    with tarfile.open(archive,'x:gz') as t:
        t.add(output,arcname=output.name)
    h=hashlib.sha256()
    with archive.open('rb')as f:
        for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
    transfer={'file':archive.name,'bytes':archive.stat().st_size,'sha256':h.hexdigest(),'selectionSha256':sha(raw),'cases':len(records),'neuralForwards':0}
    output.with_suffix('.transfer.json').write_text(json.dumps(transfer,indent=2)+'\n')
    return transfer


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--selection',type=Path,required=True);p.add_argument('--msa-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();print(json.dumps(prepare(a.selection,a.msa_root,a.output)))
