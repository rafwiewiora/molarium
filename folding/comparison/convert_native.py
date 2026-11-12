"""Convert native output coordinates for portable unscored Foldarium review.

Atom correspondence uses native output bond connectivity and the declared input
SMILES. It never infers a bond from a predicted interatomic distance.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import time
import numpy as np
from rdkit import Chem
import biotite.structure as struc
from biotite.structure.io import pdbx
from biotite.sequence import ProteinSequence


def sha(data):return hashlib.sha256(data).hexdigest()


def validate_receipt(receipt, spec_bytes):
    if receipt['status']!='complete':
        raise ValueError('Only complete native attempts can become a complete comparison library')
    if receipt['inputSha256']!=sha(spec_bytes):
        raise ValueError('Comparison input digest differs from the consumed native attempt')
    spec=json.loads(spec_bytes)
    if len(set(spec['seeds']))!=len(spec['seeds']):raise ValueError('Duplicate declared seeds')
    if len({c['id']for c in spec['compounds']})!=len(spec['compounds']):raise ValueError('Duplicate compound identities')
    return spec


def validate_coverage(poses, spec):
    expected={(c['id'],s)for c in spec['compounds']for s in spec['seeds']}
    observed=[(p['compoundId'],p['seed'])for p in poses]
    if len(observed)!=len(expected) or set(observed)!=expected:
        raise ValueError('Native output must contain exactly one pose for every compound/seed')


def convert(path, smiles, sequence, native_topology=None):
    cif=pdbx.CIFFile.read(path)
    array=pdbx.get_structure(cif,model=1,include_bonds=True,use_author_fields=False,extra_fields=['b_factor'])
    heavy=~np.isin(np.char.upper(array.element),['H','D']);array=array[heavy]
    length=len(sequence)
    protein_chains=[chain for chain in dict.fromkeys(array.chain_id)if np.sum((array.chain_id==chain)&(array.atom_name=='CA'))==length]
    if len(protein_chains)!=1:raise ValueError('Cannot identify the complete declared protein chain')
    protein_chain=protein_chains[0];other=[c for c in dict.fromkeys(array.chain_id)if c!=protein_chain]
    if len(other)!=1:raise ValueError('Expected one protein and one ligand chain')
    ligand_chain=other[0];ligand_indices=np.flatnonzero(array.chain_id==ligand_chain)
    names=[str(array.atom_name[i])for i in ligand_indices]
    if len(set(names))!=len(names) or any(len(n)>4 for n in names):raise ValueError('Ligand atom names are not unique PDB-compatible identities')
    index={int(i):j for j,i in enumerate(ligand_indices)}
    if array.bonds is None:raise ValueError('Native output has no explicit chemical topology')
    bonds=[(index[int(a)],index[int(b)],int(order))for a,b,order in array.bonds.as_array()if int(a)in index and int(b)in index]
    if native_topology is not None:
        declared=Chem.MolFromSmiles(smiles);cached=Chem.MolFromSmiles(native_topology['smiles'])
        if cached is None or Chem.MolToSmiles(cached)!=Chem.MolToSmiles(declared):
            raise ValueError('Native cached ligand chemical state differs from declared input')
        cached_atoms=native_topology['atoms'];by_name={a['name']:a for a in cached_atoms}
        if len(by_name)!=len(cached_atoms) or set(by_name)!=set(names):raise ValueError('Native cached atom names differ from output')
        for j,i in enumerate(ligand_indices):
            if by_name[names[j]]['element']!=Chem.GetPeriodicTable().GetAtomicNumber(str(array.element[i]).title()):
                raise ValueError('Native cached atom element differs from output')
        named_index={name:j for j,name in enumerate(names)}
        bonds=[(named_index[cached_atoms[b['from']]['name']],named_index[cached_atoms[b['to']]['name']],
          9 if b['order']==4 else b['order'])for b in native_topology['bonds']]
    template=Chem.RemoveHs(Chem.MolFromSmiles(smiles))
    if template is None or template.GetNumAtoms()!=len(names) or template.GetNumBonds()!=len(bonds):
        raise ValueError('Native ligand topology/atom count does not match declared input')
    # Coordinate-independent atom assignment. Bond order and charge are restored
    # from the declared SMILES; native writers may represent aromaticity as Kekule.
    native=Chem.RWMol()
    for i in ligand_indices:
        atom=Chem.Atom(str(array.element[i]).title());atom.SetNoImplicit(True);native.AddAtom(atom)
    for a,b,_order in bonds:native.AddBond(a,b,Chem.BondType.SINGLE)
    query=Chem.RWMol()
    for a in template.GetAtoms():query.AddAtom(Chem.AtomFromSmarts(f'[#{a.GetAtomicNum()}]'))
    for b in template.GetBonds():query.AddBond(b.GetBeginAtomIdx(),b.GetEndAtomIdx(),Chem.BondType.SINGLE)
    native=native.GetMol();native.UpdatePropertyCache(strict=False)
    candidates=native.GetSubstructMatches(query.GetMol(),uniquify=False,maxMatches=10000)
    mapping=None
    types={1:Chem.BondType.SINGLE,2:Chem.BondType.DOUBLE,3:Chem.BondType.TRIPLE,
      5:Chem.BondType.AROMATIC,6:Chem.BondType.AROMATIC,7:Chem.BondType.AROMATIC,9:Chem.BondType.AROMATIC}
    for candidate in candidates:
        typed=Chem.RWMol()
        reverse={j:i for i,j in enumerate(candidate)}
        for j,i in enumerate(ligand_indices):
            source=template.GetAtomWithIdx(reverse[j]);atom=Chem.Atom(str(array.element[i]).title())
            atom.SetFormalCharge(source.GetFormalCharge());atom.SetNumExplicitHs(source.GetNumExplicitHs());typed.AddAtom(atom)
        for i,j,order in bonds:
            if order not in types:raise ValueError('Unsupported native ligand bond type')
            typed.AddBond(i,j,types[order])
            if types[order]==Chem.BondType.AROMATIC:typed.GetAtomWithIdx(i).SetIsAromatic(True);typed.GetAtomWithIdx(j).SetIsAromatic(True)
        typed=typed.GetMol()
        try:Chem.SanitizeMol(typed)
        except Exception:continue
        matched=typed.GetSubstructMatch(template,useChirality=False)
        if len(matched)==len(names):mapping=matched;break
    if mapping is None:raise ValueError('Native bond topology/order differs from declared SMILES; no coordinate-based fallback is allowed')
    inverse={j:i for i,j in enumerate(mapping)}
    comp_atoms=[]
    for j,i in enumerate(ligand_indices):
        a=template.GetAtomWithIdx(inverse[j])
        comp_atoms.append({'name':names[j],'element':a.GetAtomicNum(),'charge':a.GetFormalCharge(),
            # These are exported predicted coordinates, not a claim to recover the native input conformer.
            'x':float(array.coord[i,0]),'y':float(array.coord[i,1]),'z':float(array.coord[i,2])})
    comp_bonds=[{'from':mapping[b.GetBeginAtomIdx()],'to':mapping[b.GetEndAtomIdx()],
        'order':4 if b.GetIsAromatic()else int(b.GetBondTypeAsDouble())}for b in template.GetBonds()]
    residues={};observed=[]
    for a in array:
        if a.chain_id==protein_chain and a.atom_name=='CA':
            key=(int(a.res_id),str(a.ins_code));residues[key]=len(residues)+1
            observed.append(ProteinSequence.convert_letter_3to1(str(a.res_name)))
    if ''.join(observed)!=sequence:raise ValueError('Native protein sequence differs from the requested sequence')
    lines=[];plddt=[];pdb_atoms=[]
    for i,a in enumerate(array):
        is_protein=a.chain_id==protein_chain;chain='A'if is_protein else'B';residue=residues[(int(a.res_id),str(a.ins_code))]if is_protein else 1
        name=str(a.atom_name);element=str(a.element).upper();res_name=str(a.res_name)if is_protein else'LIG'
        if len(name)>4:raise ValueError('Atom identity exceeds PDB name width')
        confidence=float(a.b_factor)
        lines.append(f'{"ATOM  "if is_protein else"HETATM"}{i+1:5d} {name:>4s} {res_name:3s} {chain}{residue:4d}    '+
            ''.join(f'{float(v):8.3f}'for v in a.coord)+f'  1.00{confidence:6.2f}          {element:>2s}')
        plddt.append(confidence);pdb_atoms.append({'slot':i,'atomName':name,'resName':res_name,'chain':chain,'resSeq':residue})
    pdb='\n'.join(lines)+'\nEND\n'
    component={'code':'LIG','atoms':comp_atoms,'bonds':comp_bonds,'smiles':smiles,
      'chemistrySource':'Declared input SMILES mapped by native atom names and explicit native '+('input-cache'if native_topology is not None else'output')+' connectivity; no bond inference from coordinates.',
      'referenceCoordinates':'Exported native prediction, not the native input conformer.'}
    proof={'nativeChainMapping':{str(protein_chain):'A',str(ligand_chain):'B'},
      'inputAtomToNativeName':[names[j]for j in mapping],'nativeConnectivitySha256':sha(json.dumps(bonds).encode()),
      'bondOrderAndChargeSource':'declared input SMILES','nativeInputConformerRecovered':False}
    if native_topology is not None:
        proof['nativeTopologySource']={'file':native_topology['sourceFile'],'sha256':native_topology['sourceSha256'],
          'mapping':'Native input-cache atom names matched to native output atom names; no coordinate inference.'}
    return pdb,component,plddt,{'plddt':'one value per exported PDB atom','pdbAtoms':pdb_atoms},proof


def main():
    p=argparse.ArgumentParser();p.add_argument('--native',type=Path,required=True);p.add_argument('--inputs',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();a.native=a.native.resolve()
    receipt_bytes=(a.native/'receipt.json').read_bytes();receipt=json.loads(receipt_bytes)
    spec=validate_receipt(receipt,a.inputs.read_bytes())
    topologies_path=a.native/'ligand-topologies.json';topologies=None
    if topologies_path.exists():
        topologies=json.loads(topologies_path.read_text())
        if topologies['nativeReceiptSha256']!=sha(receipt_bytes):raise ValueError('Topology extraction receipt mismatch')
    if receipt['method']=='boltz2' and topologies is None:raise ValueError('Boltz mmCIF requires its separately preserved named input-topology extraction')
    poses=[];method=receipt['method'];protocol=receipt['protocol'];precision='bf16-mixed'if method=='boltz2'else receipt['settings']['precision']
    for output in receipt['outputs']:
        path=(a.native/output['path']).resolve()
        if not path.is_relative_to(a.native.resolve()):raise ValueError('Output path escapes the native attempt')
        data=path.read_bytes()
        if sha(data)!=output['sha256']:raise ValueError('Native output digest mismatch')
        index=int(re.search(r'compound_(\d+)',str(path)).group(1));compound=spec['compounds'][index]
        if method=='openbind0':seed=int(re.search(r'_seed_(\d+)',path.name).group(1))
        else:seed=int(next(part[5:]for part in path.parts if part.startswith('seed-')))
        if seed not in spec['seeds']:raise ValueError('Unexpected native seed')
        topology=topologies['outputs'][output['path']]if topologies else None
        if topology:
            if topology['nativeOutputSha256']!=sha(data):raise ValueError('Topology/output hash mismatch')
            cache=(a.native/topology['sourceFile']).resolve()
            if not cache.is_relative_to(a.native) or sha(cache.read_bytes())!=topology['sourceSha256']:
                raise ValueError('Native input-cache digest mismatch')
        pdb,component,plddt,layout,proof=convert(path,compound['smiles'],spec['sequence'],topology)
        confidence={}
        if method=='openbind0':conf=path.with_name(path.name.rsplit('_model.',1)[0]+'_confidences_aggregated.json')
        else:conf=path.with_name('confidence_'+path.stem+'.json')
        if conf.exists():confidence=json.loads(conf.read_text())
        lower={k.lower().replace('_',''):v for k,v in confidence.items()}
        source={'method':method,'protocol':protocol,'effectivePrecision':precision,'settings':receipt['settings'],
          'nativeCheckpointSha256':receipt['checkpointSha256'],'nativeReceiptSha256':sha(receipt_bytes),'nativeOutputSha256':sha(data),
          'nativeOutputFile':str(path.relative_to(a.native)),'inputSpecSha256':receipt['inputSha256'],
          'environment':receipt['environment'],'atomMapping':proof,'request':{'sequence':spec['sequence'],'ligand':{'type':'smiles','value':compound['smiles']},'seed':seed},
          'outputPdbSha256':sha(pdb.encode()),'nativeConfidence':confidence}
        result={'schema':'molarium.native-fold-result.v1','kind':'native','sequence':spec['sequence'],
          'model':f'{"OpenBind-0"if method=="openbind0"else"Boltz-2"} · native {protocol}',
          'provider':'CUDA / PyTorch','pdb':pdb,'component':component,'plddt':plddt,'confidenceLayout':layout,
          'meanPlddt':float(np.mean(plddt)),'ptm':lower.get('ptm'),'iptm':lower.get('iptm'),'elapsedMs':None,
          'provenance':source,'pae':None}
        poses.append({'id':f'{method}-{protocol}-{index}-seed{seed}','compoundId':compound['id'],'seed':seed,'sample':spec['seeds'].index(seed),
          'status':'complete','result':result})
    validate_coverage(poses,spec)
    run={'id':f'native-{method}-{protocol}-20261112','name':f'{method} native {protocol}','createdAt':receipt['finishedAt'],'status':'complete',
      'request':{'sequence':spec['sequence'],'model':method},'compounds':spec['compounds'],'samples':len(spec['seeds']),
      'total':len(poses),'completed':len(poses),'failed':0,
      'provenance':{'comparisonInputSha256':receipt['inputSha256'],'nativeReceiptSha256':sha(receipt_bytes),
        'timing':{'elapsedSeconds':receipt['elapsedSeconds'],'boundary':'Native CLI after checkpoint hashing and framework import; includes model load, featurization, inference and output.'},
        'precisionNote':'Boltz-2 CLI uses bf16-mixed for both protocols; the common input precision field is consumed only by OpenFold3.'}}
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps({'schema':'foldarium.cofolding-library.v1','run':run,'poses':poses,'decisions':[]},allow_nan=False)+'\n')
    print(json.dumps({'method':method,'protocol':protocol,'poses':len(poses),'output':str(a.output)}))


if __name__=='__main__':main()
