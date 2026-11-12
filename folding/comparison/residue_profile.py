"""Describe whole-protein alignment residuals without trimming or refitting a core."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from pose_metrics import pdb_atoms,fit_proteins


def main():
    p=argparse.ArgumentParser();p.add_argument('--left',type=Path,required=True);p.add_argument('--right',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();lb=a.left.read_bytes();rb=a.right.read_bytes();left=json.loads(lb);right=json.loads(rb)
    if left['run']['request']['sequence']!=right['run']['request']['sequence']:raise ValueError('Protein sequences differ')
    lc={c['id']:c['smiles']for c in left['run']['compounds']};rc={c['id']:c['smiles']for c in right['run']['compounds']}
    if lc!=rc:raise ValueError('Compound identities differ')
    profiles=[];keys=None
    for l in left['poses']:
        for r in right['poses']:
            if l['compoundId']!=r['compoundId']:continue
            if l['status']!='complete' or r['status']!='complete':raise ValueError('Use complete ensembles')
            la=pdb_atoms(l['result']['pdb']);ra=pdb_atoms(r['result']['pdb']);transform,rmsd=fit_proteins(la,ra)
            ca=lambda atoms:{(x['chain'],x['residue'],x['resName']):x['xyz']for x in atoms if x['record']=='ATOM'and x['name']=='CA'}
            ref=ca(la);pred=ca(ra);current=list(ref)
            if keys is not None and current!=keys:raise ValueError('Residue ordering differs')
            keys=current
            displacement=[float(np.linalg.norm(transform(pred[k])-ref[k]))for k in keys]
            if not np.isclose(np.sqrt(np.mean(np.square(displacement))),rmsd):raise ValueError('Alignment residual mismatch')
            profiles.append({'compoundId':l['compoundId'],'leftSeed':l['seed'],'rightSeed':r['seed'],'proteinCaRmsdA':rmsd,'displacementA':displacement})
    if not profiles:raise ValueError('No matching completed pairs')
    values=np.array([x['displacementA']for x in profiles]);med=np.median(values,axis=0)
    out={'schema':'molarium.protein-alignment-residuals.v1','purpose':'Exploratory localization of the existing full-protein fit; no residues trimmed and no core refit.',
      'sources':[{'file':path.name,'sha256':hashlib.sha256(data).hexdigest()}for path,data in [(a.left,lb),(a.right,rb)]],
      'pairs':len(profiles),'medianOfResidueMedianDisplacementsA':float(np.median(med)),
      'residues':[{'chain':k[0],'residue':k[1],'resName':k[2],'medianDisplacementA':float(med[i]),
        'meanDisplacementA':float(np.mean(values[:,i])),'p90DisplacementA':float(np.percentile(values[:,i],90))}for i,k in enumerate(keys)],
      'profiles':profiles}
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(out,indent=2,allow_nan=False)+'\n')
    print(json.dumps({'pairs':len(profiles),'residues':len(keys),'medianOfResidueMediansA':out['medianOfResidueMedianDisplacementsA']}))


if __name__=='__main__':main()
