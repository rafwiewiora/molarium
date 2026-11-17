"""Recompute every selected native baseline from the included raw reference/CIF."""
import argparse
import hashlib
import json
from pathlib import Path
from rdkit.Chem import rdMolAlign
from experimental_reference import stereo_diagnostic
from pose_metrics import pdb_atoms, fit_proteins, ligand_mol
from rnp_qualify import reference, rows, protein, positioned_native, result, geometry
from select_rnp import select


def sha(data):
    return hashlib.sha256(data).hexdigest()


def check(root):
    raw_pool=(root/'candidate-pool.json').read_bytes()
    raw_scores=(root/'native-qualification.json').read_bytes()
    pool=json.loads(raw_pool);scores=json.loads(raw_scores)
    selection=json.loads((root/'selection.json').read_bytes())
    if scores['poolSha256']!=sha(raw_pool) or selection['poolSha256']!=sha(raw_pool) or selection['qualificationSha256']!=sha(raw_scores):
        raise ValueError('Source/selection identity mismatch')
    if sha((root/'sources/consumed-rnp-cohort.py').read_bytes())!=pool['selectorSha256']:
        raise ValueError('Frozen candidate-pool source differs')
    for filename,digest in scores['analysisScripts'].items():
        if sha(Path(__file__).with_name(filename).read_bytes())!=digest:
            raise ValueError('Consumed analysis source differs: '+filename)
    if sha((root/'sources/boltz2-v221-schema.py').read_bytes())!=scores['nativeNamingSource']['sha256']:
        raise ValueError('Native naming source changed')
    selected,excluded,shortfall=select(pool,scores)
    if selected!=selection['selected'] or excluded!=selection['exclusions'] or shortfall!=selection['shortfallByBin']:
        raise ValueError('Selection differs from the frozen policy')
    for case in selected:
        ref=reference(case,root/'reference-sources'/case['caseId'])
        if ref!=json.loads((root/'references'/case['caseId']/'reference.json').read_bytes()):
            raise ValueError('Portable reference differs from raw experimental source')
        hits=[p for p in scores['poses'] if p['caseId']==case['caseId'] and p.get('within2A')]
        best=min(hits,key=lambda p:p['ligandRmsdA'])
        paths=list((root/'native-best'/case['caseId']).glob('*.cif'))
        if len(paths)!=1 or sha(paths[0].read_bytes())!=best['nativeOutputSha256']:
            raise ValueError('Original native CIF identity mismatch')
        _,records=rows(paths[0]);atoms,_=protein(records,'A',case['sequence'],True)
        predicted=result(atoms,positioned_native(case['smiles'],records),native=True)
        a,b=pdb_atoms(ref['result']['pdb']),pdb_atoms(predicted['pdb'])
        observed={r['sequenceIndex'] for r in ref['observedResidues']}
        filtered=[atom for atom in b if atom['record']!='ATOM' or int(atom['residue'])in observed]
        transform,ca=fit_proteins(a,filtered)
        crystal=ligand_mol(ref['result'],a,case['smiles'])
        ligand=ligand_mol(predicted,b,case['smiles'],transform)
        rmsd=float(rdMolAlign.CalcRMS(ligand,crystal,maxMatches=1000000,symmetrizeConjugatedTerminalGroups=True))
        g=geometry(filtered,ligand_mol(predicted,b,case['smiles']))
        stereo=stereo_diagnostic(ligand)
        if not rmsd<2 or abs(rmsd-best['ligandRmsdA'])>1e-8 or abs(ca-best['proteinCaRmsdA'])>1e-8 or g!=best['predictedGeometry'] or stereo!=best['stereochemistry']:
            raise ValueError('Native baseline rescore disagrees: '+case['caseId'])
    return {'selected':len(selected),'byBin':selection['selectedByBin'],
            'strictNativeHitsRecomputed':len(selected),'newNeuralForwards':0}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--report',type=Path,required=True)
    print(json.dumps(check(p.parse_args().report),indent=2))
