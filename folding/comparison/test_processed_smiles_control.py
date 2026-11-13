"""Replay the completed stock-native same-spelling control, no model execution."""
from pathlib import Path
import hashlib
import json
import tempfile
import unittest
import zipfile
import numpy as np
from compare_feature_snapshots import compare
from feature_snapshot import load_snapshot


class ProcessedSmilesControlTests(unittest.TestCase):
    def test_complete_control_preserves_source_and_eliminates_name_mismatch(self):
        repo=Path(__file__).resolve().parents[2]
        root=repo/'reviews/cofold-feature-parity-2026-11-13'
        native=root/'native-9t51-a1jtm-processed-smiles'
        receipt=json.loads((native/'receipt.json').read_bytes())
        self.assertEqual(receipt['status'],'complete')
        self.assertEqual(receipt['forwardCalls'],0)
        self.assertEqual(receipt['capturedBatches'],1)
        self.assertEqual(receipt['scriptSha256'],hashlib.sha256((root/'producers/capture_native_features-processed-smiles.py').read_bytes()).hexdigest())
        self.assertEqual(receipt['resolvedQuerySha256'],hashlib.sha256((native/'processed-smiles-query.json').read_bytes()).hexdigest())
        query=json.loads((native/'processed-smiles-query.json').read_bytes())
        ligand=next(iter(query['queries'].values()))['chains'][1]
        self.assertEqual(ligand['smiles'],receipt['processedSmilesControl']['processedSmiles'])
        with tempfile.TemporaryDirectory()as directory,zipfile.ZipFile(root/'native-features.zip')as z:
            prefix='inputs/9t51-a1jtm/';out=Path(directory)
            self.assertEqual(receipt['referenceNativeReceiptSha256'],hashlib.sha256(z.read('references/9t51-a1jtm.json')).hexdigest())
            for name in z.namelist():
                if name.startswith(prefix):
                    target=out/name[len(prefix):];self.assertTrue(target.resolve().is_relative_to(out.resolve()))
                    target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(name))
            report=compare(native,root/'browser-9t51-a1jtm',repo/'reviews/cofold-recent-pdb-2026-11-13/browser-openbind0-msa256-standard/library-3.json',out)
        self.assertEqual(report,json.loads((root/'comparison-9t51-a1jtm-processed-smiles.json').read_bytes()))
        self.assertEqual(report['chemicalCorrespondence']['selection'],'identity parser order')
        self.assertTrue(report['fields']['ref_atom_name_chars']['exact'])
        self.assertEqual(report['coverage']['activeAtoms'],1679)
        self.assertEqual({k for k,v in report['fields'].items()if not v['exact']},{'token_index','entity_id','ref_pos_raw'})
        self.assertFalse(report['referenceCoordinateDiagnostics']['byMolecularKind']['protein']['exact'])

    def test_integer_relations_do_not_misdescribe_entity_labels_as_uniform_shift(self):
        repo=Path(__file__).resolve().parents[2]
        root=repo/'reviews/cofold-feature-parity-2026-11-13'
        native,_=load_snapshot(root/'native-9t51-a1jtm-processed-smiles/features')
        browser,_=load_snapshot(root/'browser-9t51-a1jtm')
        record=json.loads((root/'processed-smiles-numbering.json').read_bytes())
        for nk,bk in [('token_index','tokenIndex'),('entity_id','entityId')]:
            left,right=native[nk][0],browser[bk];r=record['relationships'][nk]
            self.assertEqual(r['rawNativeMinusBrowserValues'],np.unique(left-right).tolist())
            self.assertEqual(r['pairwiseDifferencesEqual'],bool(np.array_equal(left[:,None]-left[None,:],right[:,None]-right[None,:])))
            self.assertEqual(r['pairwiseEqualitiesEqual'],bool(np.array_equal(left[:,None]==left[None,:],right[:,None]==right[None,:])))
        self.assertEqual(record['relationships']['token_index']['rawNativeMinusBrowserValues'],[-1])
        self.assertEqual(record['relationships']['entity_id']['rawNativeMinusBrowserValues'],[-1,1])
        self.assertTrue(record['relationships']['entity_id']['pairwiseEqualitiesEqual'])


if __name__=='__main__':unittest.main()
