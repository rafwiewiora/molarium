import unittest
import tempfile
import zipfile
import shutil
import json
import subprocess
import sys
import hashlib
import native_panel_recovery
from pathlib import Path
from types import SimpleNamespace
from native_cohort import remaining_groups,validate_inventory,assemble,plan
from native_run import resolved_input_files


def msa_fixture(directory):
    # Hypothetical recovery inputs around frozen output fixtures. This tests
    # portability/lineage only; it does not claim these were MSA predictions.
    root=Path(__file__).resolve().parents[2]
    with zipfile.ZipFile(root/'reviews/cofold-method-comparison-2026-11-12/standard-openbind-interrupted-six.zip')as z:
        z.extractall(directory)
    inputs=directory/'inputs';native=directory/'raw'
    shutil.copy2(directory/'stopped-output-inventory.json',native/'stopped-output-inventory.json')
    spec=json.loads((inputs/'comparison.json').read_text())
    data=f'>query\n{spec["sequence"]}\n>homolog\n{spec["sequence"]}\n'.encode()
    (inputs/'msa').mkdir();(inputs/'msa/colabfold_main.a3m').write_bytes(data)
    spec['alignment']={'a3m':data.decode(),'sha256':hashlib.sha256(data).hexdigest()}
    (inputs/'comparison.json').write_text(json.dumps(spec))
    query=json.loads((inputs/'openbind-query.json').read_text())
    for q in query['queries'].values():
        q['use_msas']=True;q['chains'][0]['main_msa_file_paths']=['msa/colabfold_main.a3m']
    (inputs/'openbind-query.json').write_text(json.dumps(query))
    receipt=json.loads((directory/'receipt.public.json').read_text())
    for key in ['originalReceiptSha256','redactedFields']:receipt.pop(key,None)
    receipt['status']='running'
    rewrite_fixture_receipt(native,inputs,receipt)
    return inputs,native,data


def rewrite_fixture_receipt(native,inputs,receipt):
    receipt['inputSha256']=hashlib.sha256((inputs/'comparison.json').read_bytes()).hexdigest()
    receipt['inputFiles']={str(p.relative_to(inputs)):hashlib.sha256(p.read_bytes()).hexdigest()
                           for p in inputs.rglob('*')if p.is_file()}
    (native/'receipt.json').write_text(json.dumps(receipt))
    inventory=json.loads((native/'stopped-output-inventory.json').read_text())
    inventory['nativeReceiptSha256']=hashlib.sha256((native/'receipt.json').read_bytes()).hexdigest()
    (native/'stopped-output-inventory.json').write_text(json.dumps(inventory))


class RecoverySelectionTests(unittest.TestCase):
    def test_provided_alignment_is_copied_exactly_and_resolves_inside_the_retry(self):
        with tempfile.TemporaryDirectory()as directory:
            d=Path(directory);inputs,native,data=msa_fixture(d)
            plan(SimpleNamespace(inputs=inputs,attempt=[str(native)+'='+str(inputs)],allow_interrupted=True,output=d/'retry'))
            group=d/'retry/groups/group-000/inputs'
            self.assertEqual((group/'msa/colabfold_main.a3m').read_bytes(),data)
            output=d/'resolve';output.mkdir()
            spec=json.loads((group/'comparison.json').read_text())
            query,_=resolved_input_files(group,output,spec)
            for q in json.loads(query.read_text())['queries'].values():
                path=Path(q['chains'][0]['main_msa_file_paths'][0])
                self.assertTrue(path.is_relative_to(group.resolve()))
                self.assertEqual(path.read_bytes(),data)

    def test_a_resumed_attempt_cannot_change_the_parent_alignment(self):
        with tempfile.TemporaryDirectory()as directory:
            d=Path(directory);inputs,native,_data=msa_fixture(d)
            child=d/'different-alignment';shutil.copytree(inputs,child)
            parent_sha=hashlib.sha256((inputs/'comparison.json').read_bytes()).hexdigest()
            spec=json.loads((child/'comparison.json').read_text())
            data=f'>query\n{spec["sequence"]}\n'.encode()
            spec['alignment']={'a3m':data.decode(),'sha256':hashlib.sha256(data).hexdigest()}
            spec['resume']={'parentCohortInputSha256':parent_sha}
            (child/'msa/colabfold_main.a3m').write_bytes(data)
            (child/'comparison.json').write_text(json.dumps(spec))
            rewrite_fixture_receipt(native,child,json.loads((native/'receipt.json').read_text()))
            with self.assertRaisesRegex(ValueError,'alignment differs'):
                plan(SimpleNamespace(inputs=inputs,attempt=[str(native)+'='+str(child)],allow_interrupted=True,output=d/'retry'))
            self.assertFalse((d/'retry').exists())

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
            cohort=json.loads((out/'receipt.json').read_text())
            members={f'fixture/inputs/{p.relative_to(d/"inputs")}':p.read_bytes()
                     for p in (d/'inputs').rglob('*')if p.is_file()}
            native_panel_recovery.package(members,'fixture',cohort,d/'inputs',[
                {'native':partial,'inputs':d/'inputs','runner':d/'consumed-native_run.py'},
                {'native':resumed,'inputs':group,'runner':d/'consumed-native_run.py'}])
            with tempfile.TemporaryDirectory()as check:
                native_panel_recovery.verify(members,'fixture',cohort,Path(check))
            self.assertEqual(cohort['sources'][0]['originalStatus'],'running')
            self.assertIsNone(cohort['elapsedSeconds'])
            # Independently tamper with the consumed runner, a saved prediction,
            # and the stopped-output inventory. All must fail offline checking.
            targets=['fixture/recovery/part-000/consumed-native_run.py',
                     next(n for n in members if n.startswith('fixture/recovery/part-000/native/')and n.endswith('_model.cif')),
                     'fixture/recovery/part-000/native/stopped-output-inventory.json']
            for name in targets:
                changed=dict(members)
                if name.endswith('stopped-output-inventory.json'):
                    inventory=json.loads(changed[name]);inventory['nativeReceiptSha256']='0'*64
                    changed[name]=json.dumps(inventory).encode()
                else:
                    changed[name]+=b'\n# changed\n'
                with self.subTest(tampered=name),tempfile.TemporaryDirectory()as check:
                    with self.assertRaises((AssertionError,ValueError)):
                        native_panel_recovery.verify(changed,'fixture',cohort,Path(check))
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
