"""Compare already computed libraries; never run or rerun inference here."""
import argparse
import hashlib
import json
from pathlib import Path
import statistics
from pose_metrics import compare_ensembles,seed_spread


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--library',action='append',required=True,help='label=library.json')
    p.add_argument('--pair',action='append',required=True,help='left-label:right-label')
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();libraries={};sources=[]
    for spec in a.library:
        label,file=spec.split('=',1);data=Path(file).read_bytes();b=json.loads(data)
        if label in libraries:raise ValueError('Duplicate label')
        if any(x['status']!='complete'for x in b['poses']):raise ValueError('Explicitly resolve incomplete inputs before a complete-case comparison')
        libraries[label]=b;sources.append({'label':label,'file':Path(file).name,'sha256':hashlib.sha256(data).hexdigest()})
    report={'schema':'molarium.cofold-pose-agreement.v1','purpose':'Implementation/protocol agreement on arbitrary test pairs, not experimental pose accuracy.',
      'definitions':{'alignment':'Least-squares corresponding protein C-alpha atoms; same transform moves the complete predicted complex.',
        'ligandRmsd':'RDKit CalcRMS in the protein frame, without ligand fitting; conjugated terminal-group symmetry enabled.',
        'ensemble':'Seed-paired, directed left-to-right nearest-of-ensemble (and reverse), and one-to-one assignment statistics are retained with every pairwise result.',
        'contacts':'Protein residue has a heavy atom within 4.0 A of a ligand heavy atom.',
        'clashes':'Number of protein/ligand heavy-atom pairs under 1.2 A; a limited geometry diagnostic.'},
      'sources':sources,'comparisons':[]}
    for pair in a.pair:
        left,right=pair.split(':',1);l=libraries[left];r=libraries[right]
        if l['run']['request']['sequence']!=r['run']['request']['sequence']:raise ValueError('Protein sequences differ')
        lc={c['id']:c for c in l['run']['compounds']};rc={c['id']:c for c in r['run']['compounds']}
        if lc.keys()!=rc.keys() or any(lc[k]['smiles']!=rc[k]['smiles']for k in lc):raise ValueError('Compound identities differ')
        cases=[]
        for cid,c in lc.items():
            lp=[p for p in l['poses']if p['compoundId']==cid];rp=[p for p in r['poses']if p['compoundId']==cid]
            if sorted(p['seed']for p in lp)!=sorted(p['seed']for p in rp):raise ValueError('Seed sets differ')
            cases.append({'compoundId':cid,'smiles':c['smiles'],**compare_ensembles(lp,rp,c['smiles']),
              'leftSeedSpread':seed_spread(lp,c['smiles']),'rightSeedSpread':seed_spread(rp,c['smiles'])})
        report['comparisons'].append({'left':left,'right':right,'compounds':len(cases),
          'medianSeedPairedRmsdA':statistics.median(c['seedPairedMeanRmsdA']for c in cases),
          'medianNearestEnsembleRmsdA':statistics.median(c['nearestPoseMeanRmsdA']for c in cases),
          'medianOneToOneRmsdA':statistics.median(c['oneToOneMeanRmsdA']for c in cases),
          'medianLeftSeedSpreadRmsdA':statistics.median(c['leftSeedSpread']['meanRmsdA']for c in cases)if len(lp)>1 else None,
          'medianRightSeedSpreadRmsdA':statistics.median(c['rightSeedSpread']['meanRmsdA']for c in cases)if len(rp)>1 else None,'cases':cases})
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    for c in report['comparisons']:print(json.dumps({k:v for k,v in c.items()if k!='cases'}))


if __name__=='__main__':main()
