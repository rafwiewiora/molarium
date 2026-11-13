import contextlib
import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from experimental_reference import reference,score,stereo_diagnostic
from pose_metrics import component_mol,ligand_mol,pdb_atoms
from rdkit import Chem

ROOT=Path(__file__).resolve().parents[2]/'reviews/cofold-crystal-reference-2026-11-13'

class ExperimentalTests(unittest.TestCase):
    def test_exact_charged_aromatic_chemistry_and_missing_residue_map(self):
        jq=reference(ROOT/'sources','3MXF','JQ1','A','B')
        self.assertEqual(jq['formalCharge'],1)
        m=component_mol(jq['result']['component']);self.assertEqual(m.GetNumAtoms(),31)
        self.assertEqual(Chem.GetFormalCharge(m),1)
        self.assertTrue(any(a.GetIsAromatic()and a.GetNumExplicitHs()==1 and a.GetAtomicNum()==7 for a in m.GetAtoms()))
        t4=reference(ROOT/'sources','181L','BNZ','A','E')
        self.assertEqual(len(t4['sequence']),164);self.assertEqual(len(t4['observedResidues']),162)
        self.assertEqual(len({r['sequenceIndex']for r in t4['observedResidues']}),162)

    def test_reference_stereo_and_frozen_browser_metrics_reproduce(self):
        jq=reference(ROOT/'sources','3MXF','JQ1','A','B')['result']
        m=ligand_mol(jq,pdb_atoms(jq['pdb']),jq['component']['smiles'])
        self.assertEqual(stereo_diagnostic(m)['mismatchedCenters'],[])
        for i,p in enumerate(m.GetConformer().GetPositions()):m.GetConformer().SetAtomPosition(i,(-p[0],p[1],p[2]))
        self.assertEqual(len(stereo_diagnostic(m)['mismatchedCenters']),1)
        libraries=[(model,ROOT/model/f'library-{i}.json')for model in ['browser-openbind0','browser-boltz2']for i in [1,2,3]]
        with tempfile.TemporaryDirectory()as d:
            out=Path(d)/'scores.json'
            with contextlib.redirect_stdout(io.StringIO()):score(ROOT/'panel.json',libraries,out)
            expected=json.loads((ROOT/'browser-scores.json').read_text());actual=json.loads(out.read_text())
            index=lambda r:{(p['caseId'],p['method'],p['seed']):p for p in r['poses']}
            a,b=index(actual),index(expected);self.assertEqual(a.keys(),b.keys());self.assertEqual(len(a),18)
            for key,p in a.items():
                self.assertAlmostEqual(p['ligandRmsdA'],b[key]['ligandRmsdA'],places=6)
                self.assertAlmostEqual(p['proteinCaRmsdA'],b[key]['proteinCaRmsdA'],places=6)
                self.assertEqual(p['stereochemistry'],b[key]['stereochemistry'])

    def test_reference_pose_identity_and_ligand_translation_are_scored_in_protein_frame(self):
        panel=json.loads((ROOT/'panel.json').read_text());c=panel['cases'][0]
        ref=json.loads((ROOT/c['referenceFile']).read_text())['result']
        def bundle(result):return {'run':{'request':{'sequence':c['sequence']},'compounds':[{'id':c['id'],'smiles':c['smiles']}]},
          'poses':[{'status':'complete','seed':i,'result':result}for i in panel['seeds']]}
        moved=copy.deepcopy(ref);lines=[]
        for line in moved['pdb'].splitlines():
            if line.startswith('HETATM'):line=line[:30]+f'{float(line[30:38])+3:8.3f}'+line[38:]
            lines.append(line)
        moved['pdb']='\n'.join(lines)+'\n'
        with tempfile.TemporaryDirectory()as temp:
            temp=Path(temp);a=temp/'same.json';b=temp/'moved.json';out=temp/'score.json'
            a.write_text(json.dumps(bundle(ref)));b.write_text(json.dumps(bundle(moved)))
            with contextlib.redirect_stdout(io.StringIO()):score(ROOT/'panel.json',[('same',a),('moved',b)],out)
            r=json.loads(out.read_text());values={s['method']:s['medianLigandRmsdA']for s in r['summary']}
            self.assertAlmostEqual(values['same'],0,places=7);self.assertAlmostEqual(values['moved'],3,places=7)
            with self.assertRaisesRegex(ValueError,'Duplicate'):
                score(ROOT/'panel.json',[('same',a),('same',a)],out)

if __name__=='__main__':unittest.main()
