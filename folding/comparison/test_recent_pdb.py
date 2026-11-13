import copy
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from biotite.structure.io import pdbx
from rdkit import Chem
from pose_metrics import component_mol
from recent_pdb import POLICY,chem_properties,similar,prepare,assembly_compatibility
from validate_ligand_inputs import check_component
from experimental_reference import stereo_diagnostic
from pose_metrics import ligand_mol,pdb_atoms

ROOT=Path(__file__).resolve().parents[2]/'reviews/cofold-recent-pdb-2026-11-13'

class RecentPdbTests(unittest.TestCase):
    def test_stereochemistry_uses_graph_equivalence_and_still_rejects_a_real_inversion(self):
        # This cage can change fixed mapped CIP labels when unspecified centres
        # are assigned from 3D while retaining the declared stereochemical graph.
        bundle=json.loads((ROOT/'browser-boltz2-normalized/library-9.json').read_text())
        result=bundle['poses'][0]['result'];smiles=bundle['run']['compounds'][0]['smiles']
        molecule=ligand_mol(result,pdb_atoms(result['pdb']),smiles)
        diagnostic=stereo_diagnostic(molecule)
        self.assertTrue(diagnostic['stereochemicalIdentityMatches'])
        self.assertTrue(diagnostic['mappedCenterDifferences'])
        self.assertEqual(diagnostic['mismatchedCenters'],[])
        # The chiral KIT ligand has one unambiguous specified stereocentre.
        bundle=json.loads((ROOT/'browser-boltz2-baseline/library-2.json').read_text())
        comp=bundle['poses'][0]['result']['component'];smiles=bundle['run']['compounds'][0]['smiles']
        changed=copy.deepcopy(comp)
        for atom in changed['atoms']:atom['x']=-atom['x']
        self.assertFalse(check_component(changed,smiles)['stereochemistry']['stereochemicalIdentityMatches'])

    def test_normalized_browser_inputs_match_independent_features_and_stereochemistry(self):
        records=json.loads((ROOT/'normalized-chemistry.json').read_text())['records']
        self.assertEqual(len(records),9)
        expected_centres=dict(zip([c['id']for c in json.loads((ROOT/'panel.json').read_text())['cases']],
            [0,1,3,0,2,0,0,0,2]))
        for record in records:
            check=check_component(record['component'],record['inputSmiles'])
            self.assertEqual(check['rawBondFeatureDifferences'],[],record['caseId'])
            self.assertEqual(check['stereochemistry']['specifiedTetrahedralCenters'],expected_centres[record['caseId']])
            self.assertTrue(check['stereochemistry']['stereochemicalIdentityMatches'])
            self.assertEqual(check['stereochemistry']['mismatchedCenters'],[],record['caseId'])
            self.assertEqual(check['stereochemistry']['unassignedCenters'],[],record['caseId'])
        for index in [2,8]:
            baseline=json.loads((ROOT/'browser-boltz2-baseline'/f'library-{index}.json').read_text())
            c=baseline['poses'][0]['result']['component']
            self.assertTrue(check_component(c,c['smiles'])['rawBondFeatureDifferences'])

    def test_equivalent_aromatic_spellings_score_but_real_chemical_changes_reject(self):
        for index in [2,8]:
            bundle=json.loads((ROOT/'browser-boltz2-baseline'/f'library-{index}.json').read_text())
            c=bundle['poses'][0]['result']['component'];template=Chem.MolFromSmiles(c['smiles'])
            self.assertEqual(Chem.MolToSmiles(component_mol(c,template),isomericSmiles=False),Chem.MolToSmiles(template,isomericSmiles=False))
            wrong=copy.deepcopy(c);wrong['atoms'][0]['charge']+=1
            with self.assertRaisesRegex(ValueError,'chemical graph'):component_mol(wrong,template)
            wrong=copy.deepcopy(c);carbonyl=next(b for b in wrong['bonds']if b['order']==2 and any(wrong['atoms'][i]['element']==8 for i in [b['from'],b['to']]))
            carbonyl['order']=1
            with self.assertRaisesRegex(ValueError,'chemical graph'):component_mol(wrong,template)

    def test_missing_higher_ranked_sources_cannot_promote_cached_lower_rank(self):
        with tempfile.TemporaryDirectory()as temp:
            root=Path(temp);sources=root/'sources';sources.mkdir()
            cases=[{'pdbId':pdb,'ccdId':'DRG','releaseDate':'2026-11-11','sequence':'A'*80}for pdb in ['AAAA','BBBB']]
            (sources/'BBBB.cif').write_text('cached');(sources/'DRG.cif').write_text('cached')
            ranking=root/'ranking.json';ranking.write_text(json.dumps({'policy':POLICY,'eligible':cases}))
            with patch('recent_pdb.coordinate_candidate')as candidate,contextlib.redirect_stdout(io.StringIO()):prepare(ranking,sources,root/'output')
            candidate.assert_not_called();self.assertFalse((root/'output/panel.json').exists())
            audit=json.loads((root/'output/selection-audit.json').read_text())['records']
            self.assertEqual(audit[0]['status'],'needs-source');self.assertEqual(audit[1]['reason'],'higher-ranked-source-pending')

    def test_generated_biological_partner_is_checked_not_only_asymmetric_unit(self):
        panel=json.loads((ROOT/'panel.json').read_text());c=next(c for c in panel['cases']if c['pdbId']=='9XJQ')
        f=pdbx.CIFFile.read(ROOT/'sources/9XJQ.cif').block
        self.assertEqual(assembly_compatibility(f,c,c['proteinLabelAsymId'],c['ligandLabelAsymId'])['proteinCopies'],1)
        op=f['pdbx_struct_oper_list'];columns={k:[str(op[k].as_array(str)[0])]*2 for k in op}
        columns['id']=['1','2'];columns['vector[3]']=['0','1']
        f['pdbx_struct_oper_list']=pdbx.CIFCategory(columns)
        gen=f['pdbx_struct_assembly_gen'];gen['oper_expression']=pdbx.CIFColumn(['1,2']*len(gen['assembly_id'].as_array(str)))
        with self.assertRaisesRegex(ValueError,'generated-biological-assembly-partner'):
            assembly_compatibility(f,c,c['proteinLabelAsymId'],c['ligandLabelAsymId'])

    def test_artifacts_and_disconnected_species_reject_and_diversity_is_global(self):
        self.assertEqual(chem_properties('O','HOH')[1],'foldarium-artifact-component')
        self.assertEqual(chem_properties('c1ccccc1.CCO','DRG')[1],'disconnected-ligand')
        self.assertEqual(chem_properties('c1ccccc1[Zn]','DRG')[1],'unsupported-or-metal-element')
        sequence='ACDEFGHIKLMNPQRSTVWY'*5
        self.assertTrue(similar(sequence,sequence[:-1]+'A'));self.assertFalse(similar('A'*100,'C'*100))

if __name__=='__main__':unittest.main()
