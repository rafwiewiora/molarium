"""Freeze the complete stock-page job set before the first new neural prediction."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil


def sha(data):return hashlib.sha256(data).hexdigest()
def save(path,value):
    with path.open('x')as f:json.dump(value,f,indent=2,allow_nan=False);f.write('\n')


def prepare(selection_file,repository,alignments,components,output):
    raw=selection_file.read_bytes();selection=json.loads(raw)
    msa=json.loads((alignments/'alignments.json').read_bytes())
    source_receipt=json.loads((alignments/'source-receipt.json').read_bytes())
    manifest=json.loads((components/'component-provenance.json').read_bytes())
    if msa['selectionSha256']!=sha(raw) or manifest['selectionSha256']!=sha(raw) or manifest.get('failures'):
        raise ValueError('Alignment/components do not match the frozen selection')
    if source_receipt['status']!='complete' or not source_receipt['officialArchiveChecksumVerified'] or sha((alignments/'source-receipt.json').read_bytes())!=msa['sourceReceiptSha256']:
        raise ValueError('Published alignment source is not verified')
    prefix='reviews/cofold-rnp-spectrum-2026-11-15'
    native_file=prefix+'/native-qualification.json';native_bytes=(repository/native_file).read_bytes()
    if sha(native_bytes)!=selection['qualificationSha256']:
        raise ValueError('Native qualification source changed')
    native=json.loads(native_bytes);by_case={r['caseId']:r for r in msa['records']}
    if len(by_case)!=len(msa['records']) or set(by_case)!={c['caseId']for c in selection['selected']}:
        raise ValueError('Incomplete or repeated selected alignments')
    output.mkdir(exist_ok=False);(output/'inputs').mkdir();(output/'a3m').mkdir()
    shutil.copytree(components/'components',output/'components')
    for name in ['component-provenance.json','conformer-audit.json']:
        shutil.copyfile(components/name,output/name)
    shutil.copyfile(alignments/'alignments.json',output/'alignment-provenance.json')
    shutil.copyfile(alignments/'source-receipt.json',output/'alignment-source-receipt.json')
    shutil.copyfile(selection_file,output/'selection.json')
    pairs=[];texts={}
    for c in selection['selected']:
        identity=c['caseId']
        if not re.fullmatch('[a-z0-9_-]+',identity):raise ValueError('Unsafe case identity')
        text=(alignments/'a3m'/(identity+'.a3m')).read_text()
        if sha(text.encode())!=by_case[identity]['a3mSha256'] or text.splitlines()[:2]!=['>query',c['sequence']]:
            raise ValueError('Frozen alignment bytes/query mismatch')
        component='components/'+identity+'.json';comp_bytes=(components/component).read_bytes()
        if sha(comp_bytes)!=manifest['components'][component]['sha256'] or manifest['components'][component]['smiles']!=c['smiles']:
            raise ValueError('Frozen stock component changed')
        hits=[p for p in native['poses']if p['caseId']==identity and p.get('status')=='complete' and p['ligandRmsdA']<2 and p['method']=='native-boltz2-published-rnp']
        if not hits or min(p['ligandRmsdA']for p in hits)!=c['nativeQualification']['nativeBestA']:
            raise ValueError('Missing strict same-model native hit')
        ref=prefix+'/references/'+identity+'/reference.json'
        pairs.append({'caseId':identity,'model':'boltz2','name':c['pdbId']+' · '+c['ccdId'],
                      'similarity':c['similarity'],'similarityBin':c['similarityBin'],'cluster':c['cluster'],
                      'sequenceSha256':c['sequenceSha256'],'nativeBestA':c['nativeQualification']['nativeBestA'],
                      'nativeHasStereoClashPassingHit':c['nativeQualification']['nativeHasStereoClashPassingHit'],
                      'nativeScoreFile':native_file,'nativeScoreSha256':sha(native_bytes),
                      'referenceFile':ref,'referenceSha256':sha((repository/ref).read_bytes()),
                      'panelFile':prefix+'/selection.json','panelSha256':sha((repository/prefix/'selection.json').read_bytes()),
                      'msaRows':by_case[identity]['rowsIncludingQuery']})
        texts[identity]=text;(output/'a3m'/(identity+'.a3m')).write_text(text)
    jobs=[]
    # Cover every selected case at each seed before starting the next seed.
    # This order is fixed before inference and does not depend on outcomes.
    for seed in range(10):
        for c in selection['selected']:
            name=c['caseId']+'-boltz2-seed'+str(seed);file='inputs/'+name+'.json'
            value={'name':name,'dialect':'alphafold3','version':3,'modelSeeds':[seed],
                   'sequences':[{'protein':{'id':'A','sequence':c['sequence'],'unpairedMsa':texts[c['caseId']],'pairedMsa':'','templates':[]}},
                                {'ligand':{'id':'B','smiles':c['smiles']}}]}
            save(output/file,value)
            jobs.append({'index':len(jobs),'caseId':c['caseId'],'model':'boltz2','seed':seed,
                         'input':file,'inputSha256':sha((output/file).read_bytes())})
    plan={'schema':'molarium.stock-localfold-benchmark.v1','status':'planned-not-run',
          'selection':'Frozen native-qualified Runs N Poses similarity cohort; stable quotas/caps and explicit low-bin shortfall. Selected before new stock inference.',
          'selectionSha256':sha(raw),'sourceRevision':'5ea3d42c911949700401b54003cb28c557fcf2a6',
          'steps':200,'recycles':3,'recycleSemantics':'Three additional stock UI recycles = four trunk passes; no native recycle equivalence asserted.',
          'seeds':list(range(10)),'samplesPerPair':10,'perSeedDiffusionSamples':1,'pairs':pairs,'jobs':jobs,
          'executionOrder':'Seed-major, frozen selected-case order within each seed; no outcome-dependent ordering.',
          'stockInputWarnings':'See conformer-audit.json. Flagged input conformers remain unchanged and in the denominator.',
          'nativeTopologyLimitation':selection['nativeTopologyLimitation']}
    save(output/'plan.json',plan)
    return {'pairs':len(pairs),'jobs':len(jobs),'planSha256':sha((output/'plan.json').read_bytes()),'neuralForwards':0}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for flag in ['selection','repository','alignments','components','output']:p.add_argument('--'+flag,type=Path,required=True)
    a=p.parse_args();print(json.dumps(prepare(a.selection,a.repository,a.alignments,a.components,a.output)))
