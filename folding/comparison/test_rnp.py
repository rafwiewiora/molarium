import csv
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
import numpy as np
from rdkit import Chem
from rnp_cohort import candidates
from rnp_qualify import named_input, positioned_native, protein
from fetch_rnp_evidence import wanted_member
from select_rnp import select


class RnpGates(unittest.TestCase):
    def pool(self, boltz2_rmsd=1.9, release='2024-01-01', extra=None):
        directory=tempfile.TemporaryDirectory();self.addCleanup(directory.cleanup);root=Path(directory.name)
        case={'system_id':'system','ligand_instance_chain':'1.B','ligand_is_proper':'True','release_date':release,
              'ligand_smiles':'CCCCCCCCCCCCCCC','sucos_shape_pocket_qcov_2023':'30','entry_pdb_id':'XXXX','ligand_ccd_code':'LIG','cluster':'c1'}
        case.update(extra or {})
        (root/'inputs.json').write_text(json.dumps({'system':{'sequences':{'1.A':'A'*60},'smiles':['CCCCCCCCCCCCCCC']}}))
        with (root/'annotations.csv').open('w') as f:
            w=csv.DictWriter(f,fieldnames=list(case));w.writeheader();w.writerow(case)
        with tarfile.open(root/'predictions.tar.gz','w:gz') as t:
            for name,rmsd in [('boltz',.01),('boltz2',boltz2_rmsd)]:
                b=io.StringIO();w=csv.DictWriter(b,fieldnames=['target','ligand_instance_chain','ligand_is_proper','rmsd','seed','sample','method']);w.writeheader()
                w.writerow({'target':'system','ligand_instance_chain':'1.B','ligand_is_proper':'True','rmsd':rmsd,'seed':1,'sample':0,'method':'boltz'})
                data=b.getvalue().encode();info=tarfile.TarInfo('predictions/'+name+'.csv');info.size=len(data);t.addfile(info,io.BytesIO(data))
        return root

    def test_generation_threshold_cutoff_and_similarity_are_gates(self):
        self.assertEqual(len(candidates(self.pool())[0]),1)
        self.assertEqual(len(candidates(self.pool(boltz2_rmsd=2))[0]),0) # Boltz-1's excellent pose must not qualify Boltz-2.
        self.assertEqual(len(candidates(self.pool(release='2023-06-01'))[0]),0)
        self.assertEqual(len(candidates(self.pool(extra={'sucos_shape_pocket_qcov_2023':'nan'}))[0]),0)
        self.assertEqual(len(candidates(self.pool(extra={'ligand_smiles':'CCCCCCCCCCCCCCN'}))[0]),0)

    def test_extractor_does_not_select_another_method_sample_or_reference(self):
        cases={'system':{'publishedHits':[{'seed':'1','sample':'2'}],'ligandInstanceChain':'1.B'}}
        self.assertEqual(wanted_member('x/prediction_files/boltz2/system/seed-1_sample-2.cif','native',cases),Path('system/seed-1_sample-2.cif'))
        for name in ['x/prediction_files/boltz/system/seed-1_sample-2.cif','x/prediction_files/boltz2/system/seed-1_sample-3.cif']:
            self.assertIsNone(wanted_member(name,'native',cases))
        self.assertIsNone(wanted_member('ground_truth/system/ligand_files/1.C.sdf','reference',cases))
        with self.assertRaises(ValueError):wanted_member('../prediction_files/boltz2/system/seed-1_sample-2.cif','native',cases)

    def test_native_mapping_is_coordinate_independent_and_fails_closed(self):
        smiles='C[C@H](O)CC';m=named_input(smiles)
        rows=[{'chain':'B','name':a.GetProp('native_name'),'element':a.GetSymbol().upper(),'xyz':np.array([i,0.,0.])}for i,a in enumerate(m.GetAtoms())]
        a=positioned_native(smiles,rows);b=positioned_native(smiles,list(reversed([{**r,'xyz':r['xyz']+100}for r in rows])))
        self.assertEqual(Chem.MolToSmiles(a),Chem.MolToSmiles(b))
        np.testing.assert_allclose(b.GetConformer().GetPositions()-a.GetConformer().GetPositions(),100)
        with self.assertRaisesRegex(ValueError,'names disagree'):positioned_native(smiles,rows[:-1])
        with self.assertRaisesRegex(ValueError,'element differs'):positioned_native(smiles,[{**rows[0],'element':'N'},*rows[1:]])
        with self.assertRaisesRegex(ValueError,'names disagree'):positioned_native(smiles,[*rows,rows[0]])

    def test_protein_correspondence_cannot_be_guessed_by_geometric_fit(self):
        records=[{'chain':'A','residue':str(i+1),'resName':name,'name':'CA','xyz':np.zeros(3),'occupancy':1.,'alt':'.'}for i,name in enumerate(['ALA','CYS','ASP'])]
        self.assertEqual(protein(records,'A','ACD',True)[1],[1,2,3])
        with self.assertRaisesRegex(ValueError,'correspondence'):protein(records,'A','ACE',True)
        with self.assertRaisesRegex(ValueError,'Missing'):protein(records[:-1],'A','ACD',True)

    def test_selection_caps_and_shortfalls_do_not_change_with_native_rmsd_order(self):
        cases=[{'caseId':str(i),'systemId':str(i),'similarityBin':0,'candidateOrderSha256':str(i),'sequenceSha256':'same','cluster':'same'}for i in range(4)]
        pool={'policy':{'targetByBin':[3,0,0,0]},'candidates':cases}
        score={'summary':[{'caseId':str(i),'systemId':str(i),'status':'qualified','nativeBestA':1/(i+1)}for i in range(4)]}
        chosen,excluded,shortfall=select(pool,score)
        self.assertEqual([c['caseId']for c in chosen],['0','1'])
        self.assertEqual(shortfall,[1,0,0,0]);self.assertEqual(len(excluded),2)


if __name__=='__main__':unittest.main()
