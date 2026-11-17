import csv
import hashlib
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
from prepare_rnp_msas import to_a3m
from prepare_rnp_stock_plan import prepare as prepare_plan
from summarize_rnp_stock import summarize


class RnpGates(unittest.TestCase):
    def test_three_sample_checkpoint_is_complete_without_claiming_ten_sample_completion(self):
        pairs=[{'caseId':'one','model':'boltz2','similarityBin':0,'nativeHasStereoClashPassingHit':True}]
        jobs=[{'index':i,'caseId':'one','model':'boltz2','seed':i}for i in range(10)]
        rows=[{**j,'status':'complete','ligandRmsdA':1. if j['seed']==2 else 3.,'within2A':j['seed']==2,'limitedValidityPass':True}
              if j['seed']<3 else {**j,'status':'not-started'}for j in jobs]
        value=summarize({'pairs':pairs,'jobs':jobs},{'poses':rows})['allSelected']
        self.assertFalse(value['final']);self.assertIsNone(value['finalLimitedValidityCaseHitRate'])
        self.assertTrue(value['firstThree']['fullyProcessed']);self.assertEqual(value['firstThree']['completePredictions'],3)
        self.assertEqual(value['firstThree']['limitedValidityCaseHitRate'],1.)
        rows[2]={'index':2,'caseId':'one','model':'boltz2','seed':2,'status':'running'}
        value=summarize({'pairs':pairs,'jobs':jobs},{'poses':rows})['allSelected']
        self.assertFalse(value['firstThree']['fullyProcessed']);self.assertIsNone(value['firstThree']['limitedValidityCaseHitRate'])

    def test_partial_summary_does_not_emit_final_rates_or_drop_execution_failures(self):
        pairs=[{'caseId':'one','model':'boltz2','similarityBin':0,'nativeHasStereoClashPassingHit':True}]
        jobs=[{'index':i,'caseId':'one','model':'boltz2','seed':i}for i in range(2)]
        rows=[{**jobs[0],'status':'complete','ligandRmsdA':1.,'within2A':True,'limitedValidityPass':True},{**jobs[1],'status':'running'}]
        value=summarize({'pairs':pairs,'jobs':jobs},{'poses':rows})
        self.assertIsNone(value['allSelected']['finalLimitedValidityCaseHitRate']);self.assertEqual(value['allSelected']['observedLimitedValidityPassingHitCases'],1)
        rows[1]['status']='failed';value=summarize({'pairs':pairs,'jobs':jobs},{'poses':rows})
        self.assertTrue(value['allSelected']['final']);self.assertEqual(value['allSelected']['plannedPredictions'],2)
        self.assertEqual(value['allSelected']['executionFailures'],1)
        rows[0]['ligandRmsdA']=2.
        with self.assertRaisesRegex(ValueError,'strict threshold'):summarize({'pairs':pairs,'jobs':jobs},{'poses':rows})

    def test_plan_freezes_ten_exact_stock_jobs_and_rejects_changed_alignments(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);repo=root/'repository';align=root/'align';components=root/'components'
            prefix=repo/'reviews/cofold-rnp-spectrum-2026-11-15';prefix.mkdir(parents=True)
            (prefix/'references/case').mkdir(parents=True);(prefix/'references/case/reference.json').write_text('{}')
            native={'poses':[{'caseId':'case','status':'complete','method':'native-boltz2-published-rnp','ligandRmsdA':1.0}]}
            native_bytes=json.dumps(native).encode();(prefix/'native-qualification.json').write_bytes(native_bytes)
            case={'caseId':'case','pdbId':'TEST','ccdId':'LIG','sequence':'ACDE','smiles':'C[C@H](O)CC','similarity':20,
                  'similarityBin':0,'cluster':'c1','sequenceSha256':'sequence','nativeQualification':{'nativeBestA':1.,'nativeHasStereoClashPassingHit':True}}
            selection={'selected':[case],'qualificationSha256':hashlib.sha256(native_bytes).hexdigest(),'nativeTopologyLimitation':'test reconstruction limitation'}
            raw=json.dumps(selection).encode();source=root/'selection.json';source.write_bytes(raw);(prefix/'selection.json').write_bytes(raw)
            (align/'a3m').mkdir(parents=True);text='>query\nACDE\n>hit\nAC-E\n';(align/'a3m/case.a3m').write_text(text)
            receipt=json.dumps({'status':'complete','officialArchiveChecksumVerified':True}).encode();(align/'source-receipt.json').write_bytes(receipt)
            metadata={'selectionSha256':hashlib.sha256(raw).hexdigest(),'sourceReceiptSha256':hashlib.sha256(receipt).hexdigest(),
                      'records':[{'caseId':'case','a3mSha256':hashlib.sha256(text.encode()).hexdigest(),'rowsIncludingQuery':2}]}
            (align/'alignments.json').write_text(json.dumps(metadata));(components/'components').mkdir(parents=True)
            component=b'{}';(components/'components/case.json').write_bytes(component)
            (components/'component-provenance.json').write_text(json.dumps({'selectionSha256':hashlib.sha256(raw).hexdigest(),
                'components':{'components/case.json':{'sha256':hashlib.sha256(component).hexdigest(),'smiles':case['smiles']}},'failures':[]}))
            (components/'conformer-audit.json').write_text('{}')
            summary=prepare_plan(source,repo,align,components,root/'plan')
            self.assertEqual(summary['jobs'],10)
            plan=json.loads((root/'plan/plan.json').read_bytes());self.assertEqual([j['seed']for j in plan['jobs']],list(range(10)))
            for j in plan['jobs']:
                job=json.loads((root/'plan'/j['input']).read_bytes());self.assertEqual(job['sequences'][1]['ligand']['smiles'],case['smiles'])
                self.assertEqual(job['sequences'][0]['protein']['unpairedMsa'],text);self.assertEqual(job['sequences'][0]['protein']['templates'],[])
            (align/'a3m/case.a3m').write_text(text+'>changed\n----\n')
            with self.assertRaisesRegex(ValueError,'alignment bytes/query mismatch'):prepare_plan(source,repo,align,components,root/'tampered-plan')

    def test_csv_alignment_query_order_insertions_and_uniqueness(self):
        raw=b'key,sequence\n0,ACDE\n1,ACDE\n1,AcCDE\n1,AC-E\n-1,ACa-E\n1,AWDE\n'
        text,report=to_a3m(raw,'ACDE',maximum=3)
        self.assertEqual(text,'>query\nACDE\n>rnp-csv-row-3\nAC-E\n>rnp-csv-row-5\nAWDE\n')
        self.assertEqual(report['rowsIncludingQuery'],3)
        self.assertEqual(report['duplicateAlignedRowsSkipped'],4)
        for bad in [b'key,sequence\n0,AWDE\n',b'key,sequence\n0,ACDE\n1,ACD\n',b'wrong,header\n0,ACDE\n']:
            with self.assertRaises(ValueError):to_a3m(bad,'ACDE')

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
