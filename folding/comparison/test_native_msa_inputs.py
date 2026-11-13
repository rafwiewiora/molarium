import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from native_run import resolved_input_files


class NativeMsaInputsTests(unittest.TestCase):
    def test_resolution_preserves_frozen_sources_and_rejects_substituted_alignment(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);inputs=root/'inputs';output=root/'outputs'
            (inputs/'msa').mkdir(parents=True);(inputs/'boltz').mkdir();output.mkdir()
            msa=inputs/'msa/colabfold_main.a3m';msa.write_text('>query\nACDE\n>homologue\nACDF\n')
            spec={'alignment':{'sha256':hashlib.sha256(msa.read_bytes()).hexdigest()}}
            query=inputs/'openbind-query.json'
            query.write_text(json.dumps({'queries':{'q':{'use_msas':True,'chains':[
                {'main_msa_file_paths':['msa/colabfold_main.a3m']}]}}}))
            boltz=inputs/'boltz/q.yaml'
            boltz.write_text(json.dumps({'sequences':[{'protein':{'msa':'msa/colabfold_main.a3m'}}]}))
            before={p:p.read_bytes()for p in [query,boltz,msa]}
            resolved_query,resolved_boltz=resolved_input_files(inputs,output,spec)
            self.assertEqual(json.loads(resolved_query.read_text())['queries']['q']['chains'][0]['main_msa_file_paths'],[str(msa.resolve())])
            self.assertEqual(json.loads((resolved_boltz/'q.yaml').read_text())['sequences'][0]['protein']['msa'],str(msa.resolve()))
            self.assertEqual(before,{p:p.read_bytes()for p in before})
            msa.write_text('>query\nAAAA\n')
            with self.assertRaisesRegex(ValueError,'hash mismatch'):
                resolved_input_files(inputs,output,spec)


if __name__=='__main__':unittest.main()
