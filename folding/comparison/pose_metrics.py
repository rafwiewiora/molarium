"""Protein-frame pose agreement. CalcRMS evaluates ligand coordinates in place;
there is no independent ligand fit. Terminal conjugated-group symmetry is enabled.
"""
import itertools
import math
import numpy as np
from rdkit import Chem
from rdkit.Chem import rdMolAlign


def pdb_atoms(text):
    atoms=[]
    for line in text.splitlines():
        if line[:6] not in ['ATOM  ','HETATM']:
            continue
        element=line[76:78].strip().upper()
        if element in ['H','D']:
            continue
        atoms.append({'record':line[:6].strip(),'name':line[12:16].strip(),
            'resName':line[17:20].strip(),'chain':line[21], 'residue':line[22:27].strip(),
            'element':element,'xyz':np.array([float(line[k:k+8])for k in [30,38,46]])})
    return atoms


def fit_proteins(reference, predicted):
    def ca(atoms):
        return {(a['chain'],a['residue']):a for a in atoms if a['record']=='ATOM' and a['name']=='CA'}
    a,b=ca(reference),ca(predicted)
    if a.keys()!=b.keys() or len(a)<3 or any(a[k]['resName']!=b[k]['resName']for k in a):
        raise ValueError('Protein C-alpha sequence/identity mismatch; explicit residue correspondence is required.')
    x=np.array([b[k]['xyz']for k in a]);y=np.array([a[k]['xyz']for k in a]);cx=x.mean(0);cy=y.mean(0)
    u,_s,vt=np.linalg.svd((x-cx).T@(y-cy));r=u@vt
    if np.linalg.det(r)<0:
        u[:,-1]*=-1;r=u@vt
    transform=lambda p:(np.asarray(p)-cx)@r+cy
    return transform, float(np.sqrt(np.mean(np.sum((transform(x)-y)**2,axis=1))))


def component_mol(component,template=None):
    m=Chem.RWMol()
    aromatic=set()
    for b in component['bonds']:
        if b['order'] in [1.5,4]:aromatic.update([b['from'],b['to']])
    for i,a in enumerate(component['atoms']):
        atom=Chem.Atom(int(a['element']));atom.SetFormalCharge(int(a.get('charge',0)))
        atom.SetIsAromatic(i in aromatic)
        if 'explicitHs'in a:atom.SetNumExplicitHs(int(a['explicitHs']))
        m.AddAtom(atom)
    types={1:Chem.BondType.SINGLE,2:Chem.BondType.DOUBLE,3:Chem.BondType.TRIPLE,1.5:Chem.BondType.AROMATIC,4:Chem.BondType.AROMATIC}
    for b in component['bonds']:m.AddBond(b['from'],b['to'],types[b['order']])
    m=m.GetMol();m.UpdatePropertyCache(strict=False);Chem.GetSymmSSSR(m)
    # The compact component omits hydrogen atoms. Restore bracket hydrogens such
    # as aromatic [nH] from an exact chemical graph match before sanitization.
    if template is None and component.get('smiles'):template=Chem.MolFromSmiles(component['smiles'])
    if template is not None:
        match=m.GetSubstructMatch(template,useChirality=False)
        if len(match)!=template.GetNumAtoms()or m.GetNumAtoms()!=template.GetNumAtoms()or m.GetNumBonds()!=template.GetNumBonds():
            raise ValueError('Component chemical graph differs from declared SMILES')
        for i,j in enumerate(match):m.GetAtomWithIdx(j).SetNumExplicitHs(template.GetAtomWithIdx(i).GetNumExplicitHs())
    Chem.SanitizeMol(m);return m


def ligand_mol(result, atoms, smiles, transform=lambda x:x):
    template=Chem.RemoveHs(Chem.MolFromSmiles(smiles))
    if template is None:raise ValueError('Invalid declared SMILES')
    component=result['component'];graph=component_mol(component,template)
    if graph.GetNumAtoms()!=template.GetNumAtoms() or graph.GetNumBonds()!=template.GetNumBonds():
        raise ValueError('Ligand graph differs from the declared SMILES')
    mapping=graph.GetSubstructMatch(template,useChirality=False)
    if len(mapping)!=template.GetNumAtoms():raise ValueError('No exact ligand graph correspondence; do not infer bonds from predicted distances.')
    named={a['name']:a for a in atoms if a['record']=='HETATM' and a['chain']=='B'}
    if len(named)!=graph.GetNumAtoms():raise ValueError('Missing/duplicate/unexpected ligand atoms')
    conformer=Chem.Conformer(template.GetNumAtoms())
    for i,j in enumerate(mapping):
        a=component['atoms'][j];record=named[a['name']]
        expected=Chem.GetPeriodicTable().GetElementSymbol(a['element']).upper()
        if record['element']!=expected:raise ValueError('Ligand element mismatch')
        conformer.SetAtomPosition(i,tuple(float(x)for x in transform(record['xyz'])))
    mol=Chem.Mol(template);mol.RemoveAllConformers();mol.AddConformer(conformer);return mol


def contacts(atoms, cutoff=4.0):
    protein=[a for a in atoms if a['record']=='ATOM'];ligand=np.array([a['xyz']for a in atoms if a['record']=='HETATM'and a['chain']=='B'])
    if not len(ligand):raise ValueError('No ligand atoms')
    out=set();severe=0;minimum=float('inf')
    for a in protein:
        distances=np.linalg.norm(ligand-a['xyz'],axis=1);minimum=min(minimum,float(distances.min()))
        severe+=int(np.sum(distances<1.2))
        if np.any(distances<=cutoff):out.add((a['chain'],a['residue']))
    return out, {'contactResidues':len(out),'severeHeavyAtomPairsUnder1_2A':severe,'minimumProteinLigandDistanceA':minimum}


def compare(reference,prediction,smiles):
    ref_atoms=pdb_atoms(reference['pdb']);pred_atoms=pdb_atoms(prediction['pdb'])
    transform,ca_rmsd=fit_proteins(ref_atoms,pred_atoms)
    ref=ligand_mol(reference,ref_atoms,smiles);pred=ligand_mol(prediction,pred_atoms,smiles,transform)
    rmsd=rdMolAlign.CalcRMS(pred,ref,maxMatches=1000000,symmetrizeConjugatedTerminalGroups=True)
    a=np.array(ref.GetConformer().GetPositions());b=np.array(pred.GetConformer().GetPositions())
    c1,q1=contacts(ref_atoms);c2,q2=contacts(pred_atoms);union=c1|c2
    return {'proteinCaRmsdA':ca_rmsd,'ligandProteinFrameSymmetryRmsdA':float(rmsd),
        'ligandCentroidDisplacementA':float(np.linalg.norm(a.mean(0)-b.mean(0))),
        'contactResidueJaccard':len(c1&c2)/len(union) if union else None,
        'referenceGeometry':q1,'predictedGeometry':q2}


def compare_ensembles(left,right,smiles):
    left=sorted(left,key=lambda p:p['seed']);right=sorted(right,key=lambda p:p['seed'])
    if not left or len(left)!=len(right) or len(left)>8:raise ValueError('Use equally sized nonempty ensembles of at most eight poses.')
    if len({p['seed']for p in left})!=len(left) or [p['seed']for p in left]!=[p['seed']for p in right]:
        raise ValueError('Ensembles require the same unique seed set.')
    matrix=[[compare(a['result'],b['result'],smiles)for b in right]for a in left]
    rmsd=np.array([[p['ligandProteinFrameSymmetryRmsdA']for p in row]for row in matrix])
    assignment=min(itertools.permutations(range(len(right))),key=lambda p:sum(rmsd[i,j]for i,j in enumerate(p)))
    return {'leftSeeds':[p['seed']for p in left],'rightSeeds':[p['seed']for p in right],
        'pairwise':matrix,'seedPairedMeanRmsdA':float(np.diag(rmsd).mean()),
        'nearestPoseMeanRmsdA':float(rmsd.min(axis=1).mean()),
        'reverseNearestPoseMeanRmsdA':float(rmsd.min(axis=0).mean()),
        'oneToOneMeanRmsdA':float(np.mean([rmsd[i,j]for i,j in enumerate(assignment)])),
        'oneToOneAssignment':list(assignment)}


def seed_spread(poses,smiles):
    """Within-method variability, excluding identical-pose diagonal comparisons."""
    pairs=[{'leftSeed':a['seed'],'rightSeed':b['seed'],**compare(a['result'],b['result'],smiles)}
      for a,b in itertools.combinations(sorted(poses,key=lambda p:p['seed']),2)]
    return {'pairs':pairs,'meanRmsdA':float(np.mean([p['ligandProteinFrameSymmetryRmsdA']for p in pairs]))if pairs else None}
