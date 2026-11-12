import unittest
import tempfile
import zipfile
import shutil
import json
import subprocess
import sys
import hashlib
from pathlib import Path
from types import SimpleNamespace
from native_cohort import remaining_groups,validate_inventory,assemble,plan


class RecoverySelectionTests(unittest.TestCase):
    def test_public_interruption_archive_reproduces_the_exact_42_pose_input_digest(self):
        root=Path(__file__).resolve().parents[2]
        fixture=root/'reviews/cofold-method-comparison-2026-11-12'
        frozen=json.loads((fixture/'standard-openbind-recovery-plan.json').read_text())
        with tempfile.TemporaryDirectory()as directory:
            d=Path(directory)
            with zipfile.ZipFile(fixture/'standard-openbind-interrupted-six.zip')as z:z.extractall(d)
            shutil.copy2(d/'receipt.public.json',d/'raw/receipt.json')
            shutil.copy2(d/'stopped-output-inventory.json',d/'raw/stopped-output-inventory.json')
            plan(SimpleNamespace(inputs=d/'inputs',attempt=[str(d/'raw')+'='+str(d/'inputs')],allow_interrupted=True,output=d/'retry'))
            recovered=json.loads((d/'retry/resume-plan.json').read_text())
        self.assertEqual(recovered['preservedPoses'],6);self.assertEqual(recovered['remainingPoses'],42)
        self.assertEqual(recovered['groups'],frozen['groups'])

    def test_six_saved_plus_42_resumed_fixture_keeps_coordinates_and_interruption_status(self):
        root=Path(__file__).resolve().parents[2]
        fixture=root/'reviews/cofold-method-comparison-2026-11-12/native-openbind0-torch-reference'
        original=json.loads((fixture/'library.json').read_text())
        with tempfile.TemporaryDirectory()as directory:
            d=Path(directory)
            with zipfile.ZipFile(fixture/'native-artifacts.zip')as z:z.extractall(d)
            full=json.loads((d/'receipt.public.json').read_text())
            # Simulate an interruption using frozen coordinates, never inference.
            partial=d/'partial';partial.mkdir();saved=[];remaining=[]
            for output in full['outputs']:
                (saved if int(Path(output['path']).name.split('_')[1])<2 else remaining).append(output)
            for output in saved:
                target=partial/output['path'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(d/'raw'/output['path'],target)
            r={k:v for k,v in full.items()if k not in ['outputs','originalReceiptSha256','redactedFields']};r['status']='running';r.pop('elapsedSeconds',None)
            (partial/'receipt.json').write_text(json.dumps(r))
            inventory={'nativeReceiptSha256':hashlib.sha256((partial/'receipt.json').read_bytes()).hexdigest(),
              'files':{o['path']:{'sha256':o['sha256']}for o in saved}}
            (partial/'stopped-output-inventory.json').write_text(json.dumps(inventory))
            retry=d/'retry'
            plan(SimpleNamespace(inputs=d/'inputs',attempt=[str(partial)+'='+str(d/'inputs')],allow_interrupted=True,output=retry))
            group=retry/'groups/group-000/inputs';resumed=d/'resumed';resumed.mkdir()
            for output in remaining:
                target=resumed/output['path'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(d/'raw'/output['path'],target)
            r={k:v for k,v in full.items()if k not in ['originalReceiptSha256','redactedFields']};r['outputs']=remaining
            r['inputSha256']=hashlib.sha256((group/'comparison.json').read_bytes()).hexdigest()
            r['inputFiles']={p.name:hashlib.sha256(p.read_bytes()).hexdigest()for p in group.iterdir()if p.is_file()}
            (resumed/'receipt.json').write_text(json.dumps(r))
            out=d/'compound_999_parent'
            assemble(SimpleNamespace(inputs=d/'inputs',attempt=[str(partial)+'='+str(d/'inputs'),str(resumed)+'='+str(group)],allow_interrupted=True,output=out))
            exported=d/'library.json'
            subprocess.run([sys.executable,str(root/'folding/comparison/convert_native.py'),'--native',str(out),
              '--inputs',str(d/'inputs/comparison.json'),'--output',str(exported)],check=True,capture_output=True)
            recovered=json.loads(exported.read_text())
        identify=lambda b:{(p['compoundId'],p['seed']):p['result']['provenance']['outputPdbSha256']for p in b['poses']}
        self.assertEqual(identify(recovered),identify(original));self.assertEqual(len(recovered['poses']),48)
        self.assertIsNone(recovered['run']['provenance']['timing']['elapsedSeconds'])
        self.assertEqual({s['originalStatus']for s in recovered['run']['provenance']['nativeAttempts']},{'running','complete'})

    def test_full_frozen_cohort_assembly_preserves_all_48_original_pdb_outputs(self):
        root=Path(__file__).resolve().parents[2]
        fixture=root/'reviews/cofold-method-comparison-2026-11-12/native-openbind0-torch-reference'
        original=json.loads((fixture/'library.json').read_text())
        with tempfile.TemporaryDirectory()as directory:
            d=Path(directory)
            with zipfile.ZipFile(fixture/'native-artifacts.zip')as z:z.extractall(d)
            shutil.copy2(d/'receipt.public.json',d/'raw/receipt.json')
            out=d/'assembled'
            assemble(SimpleNamespace(inputs=d/'inputs',attempt=[str(d/'raw')+'='+str(d/'inputs')],allow_interrupted=False,output=out))
            exported=d/'library.json'
            subprocess.run([sys.executable,str(root/'folding/comparison/convert_native.py'),'--native',str(out),
              '--inputs',str(d/'inputs/comparison.json'),'--output',str(exported)],check=True,capture_output=True)
            recovered=json.loads(exported.read_text())
        identify=lambda b:{(p['compoundId'],p['seed']):p['result']['provenance']['outputPdbSha256']for p in b['poses']}
        self.assertEqual(identify(recovered),identify(original));self.assertEqual(len(recovered['poses']),48)
        self.assertEqual(recovered['poses'][0]['result']['provenance']['nativeAttempt']['originalStatus'],'complete')
        self.assertEqual(recovered['poses'][0]['result']['provenance']['nativeAttempt']['receiptSha256'],original['poses'][0]['result']['provenance']['nativeReceiptSha256'])

    def test_incomplete_transfer_cannot_turn_saved_science_into_retry_work(self):
        receipt={'status':'complete','outputs':[{'path':'a.cif','sha256':'a'},{'path':'b.cif','sha256':'b'}]}
        with self.assertRaisesRegex(ValueError,'retrieve preserved'):
            validate_inventory(receipt,'receipt',{'a.cif':'a'})
        validate_inventory(receipt,'receipt',{'a.cif':'a','b.cif':'b'})
        interrupted={'status':'running'}
        inventory={'nativeReceiptSha256':'receipt','files':{'a.cif':{'sha256':'a'},'b.cif':{'sha256':'b'}}}
        with self.assertRaisesRegex(ValueError,'source-side'):
            validate_inventory(interrupted,'different-receipt',{'a.cif':'a'},inventory)
        with self.assertRaisesRegex(ValueError,'retrieve preserved'):
            validate_inventory(interrupted,'receipt',{'a.cif':'a'},inventory)
        validate_inventory(interrupted,'receipt',{'a.cif':'a','b.cif':'b'},inventory)

    def test_saved_poses_are_never_in_retry_groups_even_with_a_partial_seed_set(self):
        spec={'compounds':[{'id':str(i)}for i in range(16)],'seeds':[0,1,2]}
        saved={(i,s)for i in [0,1]for s in spec['seeds']}|{(2,0)}
        groups=remaining_groups(spec,saved)
        planned=[(i,s)for g in groups for i in g['indices']for s in g['seeds']]
        expected={(i,s)for i in range(16)for s in spec['seeds']}
        self.assertEqual(len(planned),41);self.assertEqual(len(set(planned)),41)
        self.assertFalse(set(planned)&saved);self.assertEqual(set(planned)|saved,expected)
        self.assertIn({'indices':[2],'seeds':[1,2]},groups)

    def test_complete_cohort_has_no_more_work_and_unknown_pose_keys_reject(self):
        spec={'compounds':[{'id':'a'}],'seeds':[0,1]}
        self.assertEqual(remaining_groups(spec,{(0,0),(0,1)}),[])
        with self.assertRaisesRegex(ValueError,'Unknown'):
            remaining_groups(spec,{(1,0)})


if __name__=='__main__':unittest.main()
