"""WIP: convert a completed trained input-embedder fixture, no neural arithmetic.

Calls the pinned upstream weight-name/layout converters. The only stripped imports
are unused AF3 blob I/O dependencies; forward functions are never reimplemented.
Do not run until the frozen native export is complete.
"""
import argparse,ast,hashlib,json,sys,types,copy
from pathlib import Path
import numpy as np
repo=Path(__file__).resolve().parents[2]
from feature_snapshot import load_snapshot
from capture_native_features import freeze_features
from compare_feature_snapshots import alphabet_profile,atom_name_codes

PINS={'common.py':'2ce60315eec67571154d5b7238df28132b74870c31c51ddef4382bfa0c4a3dd0',
      'openfold3.py':'1d8843c8ca57ad0780bb8d6be740f56beb852c37d4b3d652791f37179f67283d'}

def converter(root):
 package='_molarium_frozen_of3_converter';pkg=types.ModuleType(package);pkg.__path__=[str(root/'converters')];sys.modules[package]=pkg
 for name in ['common','openfold3']:
  path=root/'converters'/(name+'.py');raw=path.read_bytes();assert hashlib.sha256(raw).hexdigest()==PINS[path.name]
  tree=ast.parse(raw,filename=str(path));filtered=[]
  for node in tree.body:
   if isinstance(node,ast.ImportFrom)and node.module=='alphafold3.model.params':continue
   if isinstance(node,ast.Import)and [n.name for n in node.names]==['zstandard']:continue
   filtered.append(node)
  tree.body=filtered
  module=types.ModuleType(package+'.'+name);module.__package__=package;module.__file__=str(path);sys.modules[module.__name__]=module
  exec(compile(tree,str(path),'exec'),module.__dict__)
  setattr(pkg,name,module)
 return pkg.openfold3


def main():
 p=argparse.ArgumentParser()
 for name in ['native','browser','converter-root','output']:p.add_argument('--'+name,type=Path,required=True)
 a=p.parse_args();receipt=json.loads((a.native/'receipt.json').read_bytes())
 assert receipt['status']=='complete'and receipt['forwardCalls']==0 and receipt['trainedEmbedder']['embedderForwardCalls']==1
 strict=receipt['trainedEmbedder']['strictPrecision'];assert strict['matmul']=='highest'and not strict['cudaTf32']and not strict['cudnnTf32']
 for f in receipt['outputs']+receipt['trainedEmbedder']['files']:
  raw=(a.native/f['path']).read_bytes();assert len(raw)==f['bytes']and hashlib.sha256(raw).hexdigest()==f['sha256']
 state,_=load_snapshot(a.native/'trained-embedder/weights');out,_=load_snapshot(a.native/'trained-embedder/outputs')
 native,_=load_snapshot(a.native/'features');browser,_=load_snapshot(a.browser);browser=copy.deepcopy(browser)
 n=lambda k:native[k][0]
 assert receipt['processedSmilesControl']['processedSmiles']==json.loads((a.browser/'receipt.json').read_bytes())['smiles']
 assert not np.any(n('is_rna'))and not np.any(n('is_dna'))
 active=np.flatnonzero(browser['predDenseAtomMask']);assert np.array_equal(n('atom_to_token_index'),active//browser['dense'])
 assert np.all(n('atom_mask')==1)and len(active)==len(n('atom_mask'))
 protein=browser['isLigand'][active//browser['dense']]==0
 assert np.array_equal(atom_name_codes(n('ref_atom_name_chars'))[protein],browser['refAtomNameChars'].reshape(-1,4)[active][protein]), 'Protein atom order/gathers differ'
 # No atom reordering: expose every actual model-visible feature at its own slot.
 for nk,bk in [('ref_pos','refPos'),('ref_mask','refMask'),('ref_charge','refCharge'),('ref_space_uid','refSpaceUid')]:
  target=browser[bk].reshape((-1,3)if nk=='ref_pos'else(-1,));target[active]=n(nk)
 browser['refElement'][active]=n('ref_element').argmax(-1)+1
 browser['refAtomNameChars'].reshape(-1,4)[active]=atom_name_codes(n('ref_atom_name_chars'))
 from compare_feature_snapshots import NATIVE_TO_BROWSER
 browser['aatype']=NATIVE_TO_BROWSER[n('restype').argmax(-1)].astype(np.int32)
 browser['profile']=alphabet_profile(n('profile')).astype(np.float32).reshape(-1)
 browser['deletionMean']=n('deletion_mean').copy()
 for nk,bk in [('token_mask','seqMask'),('residue_index','residueIndex'),('token_index','tokenIndex'),('asym_id','asymId'),('entity_id','entityId'),('sym_id','symId')]:
  browser[bk]=n(nk).copy()
 browser['features']={k:browser[k]for k in ['residueIndex','tokenIndex','asymId','entityId','symId']}
 c=converter(a.converter_root);params={}
 sd={'input_embedder.'+k:v for k,v in state.items()}
 c.map_evoformer_conditioning(sd,params)
 a.output.mkdir()
 freeze_features(browser,a.output/'controlled-batch')
 payload=bytearray();tensors={}
 for scope,leaves in sorted(params.items()):
  for name,value in sorted(leaves.items()):
   array=np.asarray(value,dtype='<f4');data=array.tobytes()
   tensors[scope+'/'+name]={'shape':list(array.shape),'dtype':'float32','byteOffset':len(payload),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
   payload.extend(data)
 assert len(tensors)>20
 (a.output/'weights.bin').write_bytes(payload)
 manifest={'model':{'name':'openbind0'},'tensors':tensors,'blob':{'file':'weights.bin','bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest()}}
 (a.output/'weights.json').write_text(json.dumps(manifest,indent=2)+'\n')
 remap=c._AF3_TO_OF3_AATYPE
 expected=out['s_input'][0][:,np.concatenate([384+remap,416+remap,[448],np.arange(384)])].astype('<f4')
 (a.output/'expected-target.bin').write_bytes(expected.tobytes())
 record={'scope':'Matched native feature bytes and full-FP32 trained weights for the production buildTargetFeat path only; no trunk, denoising, confidence, trajectory or pose accuracy claim.',
  'nativeReceiptSha256':hashlib.sha256((a.native/'receipt.json').read_bytes()).hexdigest(),
  'weightConverterRepository':'https://github.com/sokrypton/alphafold3','weightConverterRevision':'e68d628df1d815cccb48bb1118d8763a594bfa23','weightConverterFiles':PINS,
  'converterImportChanges':'Unused top-level alphafold3.model.params and zstandard blob-I/O imports omitted. Executed mapping functions unchanged; no neural forward code taken from this converter.',
  'expectedShape':list(expected.shape),'expectedTargetSha256':hashlib.sha256(expected.tobytes()).hexdigest(),
  'gatesDeclaredBeforeRun':{'relativeRms':1e-4,'maxAbsoluteDifference':1e-3,'requireFinite':True},
  'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
 (a.output/'receipt.json').write_text(json.dumps(record,indent=2)+'\n')
 print(json.dumps({'weights':len(tensors),'bytes':len(payload),'expectedShape':list(expected.shape)}))
if __name__=='__main__':main()
