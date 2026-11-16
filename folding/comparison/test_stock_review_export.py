import copy
import unittest

from export_stock_review import bundle, digest, export


class ReviewExportIdentity(unittest.TestCase):
    def test_reference_is_separate_coordinates_are_unchanged_and_no_decisions_are_copied(self):
        pair = {'caseId': 'case', 'name': 'Synthetic storage fixture', 'referenceSha256': 'reference'}
        job = {'sequences': [{'protein': {'sequence': 'ACD'}}, {'ligand': {'smiles': 'CC'}}]}
        rows = [{'index': 3, 'seed': 0, 'status': 'complete'}, {'index': 4, 'seed': 1, 'status': 'failed', 'error': 'preserved error'}]
        pdb = 'ATOM  original protein\nHETATM original ligand\n'
        results = {3: {'pdb': pdb, 'component': {'atoms': [{'name': 'C1'}], 'bonds': []}, 'elapsedMs': None}}
        original = copy.deepcopy(results)
        reference = {'result': {'pdb': 'ATOM  reference\nHETATM reference ligand\n', 'component': {}}}
        sources = {'sourceScoresSha256': 'scores', 'createdAt': '2026-11-16T00:00:00Z'}
        predictions = bundle(pair, job, rows, results, reference, sources, 2, False)
        with_reference = bundle(pair, job, rows, results, reference, sources, 2, True)
        self.assertEqual(results, original)
        self.assertEqual(predictions['poses'][0]['result']['pdb'], pdb)
        self.assertEqual(with_reference['poses'][1]['result']['pdb'], pdb)
        self.assertEqual([p['sample'] for p in predictions['poses']], [0, 1])
        self.assertEqual([p['sample'] for p in with_reference['poses']], [0, 1, 2])
        self.assertEqual(with_reference['poses'][0]['role'], 'experimental-reference')
        self.assertIsNone(with_reference['poses'][0]['result']['iptm'])
        self.assertEqual(with_reference['poses'][0]['result']['provenance']['outputPdbSha256'], digest(reference['result']['pdb'].encode()))
        self.assertEqual(predictions['poses'][1]['error'], 'preserved error')
        self.assertEqual(with_reference['run']['failed'], 1)
        self.assertEqual(predictions['decisions'], with_reference['decisions'])
        self.assertEqual(predictions['decisions'], [])
        self.assertNotEqual(predictions['run']['id'], with_reference['run']['id'])

    def test_duplicate_or_untrusted_case_names_fail_before_reading_any_package(self):
        for cases in [[], ['case', 'case'], ['../case'], ['case/file']]:
            with self.assertRaisesRegex(ValueError, 'distinct frozen case IDs'):
                export(None, None, cases, 2)


if __name__ == '__main__':
    unittest.main()
