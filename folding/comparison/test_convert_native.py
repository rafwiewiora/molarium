import tempfile
import unittest
import json
from pathlib import Path
import numpy as np
import biotite.structure as struc
from biotite.structure.io import pdbx
from convert_native import convert, validate_receipt, validate_coverage, sha


class NativeConversionTests(unittest.TestCase):
    def test_different_input_manifest_cannot_be_attached_to_native_results(self):
        spec=json.dumps({'seeds':[0,1],'compounds':[{'id':'ethanol','smiles':'CCO'}]}).encode()
        receipt={'status':'complete','inputSha256':sha(spec)}
        self.assertEqual(validate_receipt(receipt,spec)['seeds'],[0,1])
        with self.assertRaisesRegex(ValueError,'digest differs'):
            validate_receipt(receipt,spec+b' ')

    def test_duplicate_outputs_cannot_replace_a_missing_seed(self):
        spec={'compounds':[{'id':'ethanol'}],'seeds':[0,1]}
        with self.assertRaisesRegex(ValueError,'exactly one'):
            validate_coverage([{'compoundId':'ethanol','seed':0}]*2,spec)
        validate_coverage([{'compoundId':'ethanol','seed':s}for s in [0,1]],spec)

    def test_atom_assignment_preserves_native_double_bond_order_without_distances(self):
        a=struc.AtomArray(7)
        a.chain_id=np.array(['X']*3+['Y']*4);a.res_id=np.array([20,21,22,1,1,1,1])
        a.res_name=np.array(['ALA','CYS','ASP']+['LIG']*4);a.atom_name=np.array(['CA']*3+['C1','C2','C3','C4'])
        a.element=np.array(['C']*7);a.hetero=np.array([False]*3+[True]*4)
        a.coord=np.array([[0,0,0],[1,2,0],[2,1,3],[0,20,0],[30,20,0],[60,20,0],[90,20,0]],np.float32)
        a.bonds=struc.BondList(7,np.array([[3,4,2],[4,5,1],[5,6,1]],np.uint32))
        a.set_annotation('b_factor',np.array([90.]*7))
        with tempfile.TemporaryDirectory()as d:
            path=Path(d)/'native.cif';cif=pdbx.CIFFile();pdbx.set_structure(cif,a);cif.write(path)
            pdb,c,plddt,layout,proof=convert(path,'CCC=C','ACD')
            # Boltz mmCIF omits the ligand bond table. Its named native input
            # graph provides correspondence without using predicted distances.
            a.bonds=struc.BondList(7);cif=pdbx.CIFFile();pdbx.set_structure(cif,a);cif.write(path)
            with self.assertRaisesRegex(ValueError,'topology/atom count'):
                convert(path,'CCC=C','ACD')
            topology={'smiles':'C=CCC','sourceFile':'processed/mols/test.pkl','sourceSha256':'a'*64,
              'atoms':[{'name':f'C{i+1}','element':6,'charge':0}for i in range(4)],
              'bonds':[{'from':0,'to':1,'order':2},{'from':1,'to':2,'order':1},{'from':2,'to':3,'order':1}]}
            recovered=convert(path,'CCC=C','ACD',topology)
            self.assertEqual(recovered[1]['bonds'],c['bonds'])
            self.assertEqual(recovered[4]['nativeTopologySource']['sha256'],'a'*64)
            with self.assertRaisesRegex(ValueError,'chemical state differs'):
                convert(path,'CCCC','ACD',topology)
        doubles=[b for b in c['bonds']if b['order']==2]
        self.assertEqual(len(doubles),1)
        self.assertEqual({c['atoms'][doubles[0][k]]['name']for k in ['from','to']},{'C1','C2'})
        self.assertEqual(len(plddt),7);self.assertIn('HETATM',pdb)
        self.assertEqual(proof['nativeChainMapping'],{'X':'A','Y':'B'})
        self.assertFalse(proof['nativeInputConformerRecovered'])


if __name__=='__main__':unittest.main()
