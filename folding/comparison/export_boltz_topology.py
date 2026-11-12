"""Serialize trusted native Boltz molecule caches using their original RDKit runtime."""
import hashlib,json,pickle,sys
from pathlib import Path
from rdkit import Chem,rdBase
root=Path(sys.argv[1]);receipt=(root/'receipt.json').read_bytes();r=json.loads(receipt)
assert r['status']=='complete'
records={}
for output in r['outputs']:
    model=root/output['path'];data=model.read_bytes();assert hashlib.sha256(data).hexdigest()==output['sha256']
    compound=model.parent.name
    cache=model.parents[2]/'processed/mols'/f'{compound}.pkl'
    raw=cache.read_bytes();mols=pickle.loads(raw)
    assert list(mols)==['LIG1']
    mol=Chem.RemoveHs(mols['LIG1'])
    records[output['path']]={'nativeOutputSha256':output['sha256'],
      'sourceFile':str(cache.relative_to(root)),'sourceSha256':hashlib.sha256(raw).hexdigest(),
      'smiles':Chem.MolToSmiles(mol),
      'atoms':[{'name':a.GetProp('name'),'element':a.GetAtomicNum(),'charge':a.GetFormalCharge()}for a in mol.GetAtoms()],
      'bonds':[{'from':b.GetBeginAtomIdx(),'to':b.GetEndAtomIdx(),'order':4 if b.GetIsAromatic()else int(b.GetBondTypeAsDouble())}for b in mol.GetBonds()]}
result={'schema':'molarium.native-ligand-topologies.v1','rdkitVersion':rdBase.rdkitVersion,
 'nativeReceiptSha256':hashlib.sha256(receipt).hexdigest(),'source':'Boltz processed/mols RDKit caches, named input chemical graphs; no distance inference.',
 'selectedInputConformerRecovered':False,'outputs':records}
(root/'ligand-topologies.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'outputs':len(records),'rdkitVersion':rdBase.rdkitVersion}))
