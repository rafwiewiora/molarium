"""Scientific input certificates and replay of both public native/JS snapshots."""
from pathlib import Path
import hashlib
import json
import tempfile
import unittest
import zipfile
import numpy as np
from compare_feature_snapshots import alphabet_profile, compare, graph_maps, stats


class FeatureComparisonTests(unittest.TestCase):
    def test_stereo_is_required_and_symmetric_same_spelling_keeps_identity(self):
        with self.assertRaisesRegex(ValueError, 'stereochemistry'):
            graph_maps('F[C@](Cl)(Br)I', 'F[C@@](Cl)(Br)I')
        left,right,maps,chosen=graph_maps('CC(C)O', 'CC(C)O')
        self.assertEqual(chosen,tuple(range(4)))
        self.assertGreater(len(maps),1)
        self.assertEqual(left.GetNumAtoms(),right.GetNumAtoms())

    def test_alphabet_merge_preserves_mass_and_gap_does_not_become_unknown(self):
        native=np.eye(32,dtype=np.float32)
        out=alphabet_profile(native)
        self.assertTrue(np.array_equal(out.sum(-1),np.ones(32)))
        self.assertEqual(out[31].argmax(),21)
        self.assertEqual(out[25].argmax(),30)
        self.assertEqual(out[30].argmax(),30)
        self.assertEqual(out[21].argmax(),22)

    def test_shape_mismatch_or_nonfinite_is_never_an_exact_match(self):
        with self.assertRaisesRegex(ValueError,'shape mismatch'):
            stats(np.zeros(2),np.zeros(3))
        with np.errstate(invalid='ignore'):
            report=stats(np.array([np.nan,np.inf]),np.array([np.nan,np.inf]))
        self.assertFalse(report['exact'])
        self.assertEqual(report['nonFiniteValues'],2)

    def test_public_transfer_and_both_comparisons_replay_without_model_or_pickle(self):
        repo=Path(__file__).resolve().parents[2]
        root=repo/'reviews/cofold-feature-parity-2026-11-13'
        receipt=json.loads((root/'transfer-receipt.json').read_bytes())
        raw=(root/'native-features.zip').read_bytes()
        self.assertEqual(len(raw),receipt['archive']['bytes'])
        self.assertEqual(hashlib.sha256(raw).hexdigest(),receipt['archive']['sha256'])
        with tempfile.TemporaryDirectory()as directory,zipfile.ZipFile(root/'native-features.zip')as z:
            output=Path(directory)
            self.assertEqual(set(z.namelist()),{f['file']for f in receipt['archive']['files']})
            for item in receipt['archive']['files']:
                data=z.read(item['file']);self.assertEqual(hashlib.sha256(data).hexdigest(),item['sha256'])
                self.assertEqual(len(data),item['bytes'])
                path=output/item['file'];self.assertTrue(path.resolve().is_relative_to(output.resolve()))
                path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
            for name in ['capture_native_features.py','native_run.py']:
                self.assertEqual((root/'producers'/name).read_bytes(),(output/name).read_bytes())
            for case,number in [('9t51-a1jtm',3),('32qy-a1keo',8)]:
                actual=compare(root/('native-'+case),root/('browser-'+case),
                    repo/f'reviews/cofold-recent-pdb-2026-11-13/browser-openbind0-msa256-standard/library-{number}.json',output/'inputs'/case)
                expected=json.loads((root/('comparison-'+case+'.json')).read_bytes())
                self.assertEqual(actual,expected)
                self.assertEqual(actual['coverage']['atomsDropped'],0)
                self.assertEqual({k for k,v in actual['fields'].items()if not v['exact']},
                                 {'token_index','entity_id','ref_atom_name_chars','ref_pos_raw'})
                self.assertTrue(actual['fields']['token_bonds']['exact'])
                self.assertTrue(actual['fields']['msa']['exact'])
            changed=output/'inputs/9t51-a1jtm/comparison.json'
            changed.write_bytes(changed.read_bytes()+b' ')
            with self.assertRaisesRegex(ValueError,'native input files changed'):
                compare(root/'native-9t51-a1jtm',root/'browser-9t51-a1jtm',
                    repo/'reviews/cofold-recent-pdb-2026-11-13/browser-openbind0-msa256-standard/library-3.json',changed.parent)


if __name__=='__main__':unittest.main()
