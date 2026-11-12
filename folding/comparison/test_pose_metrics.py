import unittest
import numpy as np
from rdkit import Chem
from rdkit.Chem import rdMolAlign
from pose_metrics import fit_proteins


class PoseMetricTests(unittest.TestCase):
    def test_protein_rigid_fit_preserves_displaced_ligand(self):
        xyz=np.array([[0,0,0],[1,0,0],[0,2,0],[1,2,3]],float)
        moved=np.array([[-y+10,x-4,z+7]for x,y,z in xyz])
        def atoms(x):return [{'record':'ATOM','name':'CA','chain':'A','residue':str(i+1),'resName':'ALA','xyz':p}for i,p in enumerate(x)]
        apply,rmsd=fit_proteins(atoms(xyz),atoms(moved));self.assertLess(rmsd,1e-10)
        np.testing.assert_allclose(apply([10,-1,7]),[3,0,0],atol=1e-10)

    def test_calc_rms_does_not_fit_the_ligand(self):
        m=Chem.MolFromSmiles('CCO');c=Chem.Conformer(3)
        for i,p in enumerate([[0,0,0],[1.5,0,0],[2,1,0]]):c.SetAtomPosition(i,p)
        m.AddConformer(c);n=Chem.Mol(m)
        for i in range(3):
            p=n.GetConformer().GetAtomPosition(i);n.GetConformer().SetAtomPosition(i,(p.x+3,p.y,p.z))
        self.assertAlmostEqual(rdMolAlign.CalcRMS(n,m,symmetrizeConjugatedTerminalGroups=True),3)

    def test_carboxylate_oxygen_symmetry_is_not_a_pose_error(self):
        m=Chem.MolFromSmiles('CC(=O)[O-]');c=Chem.Conformer(4)
        for i,p in enumerate([[0,0,0],[1.5,0,0],[2.2,1,0],[2.2,-1,0]]):c.SetAtomPosition(i,p)
        m.AddConformer(c);n=Chem.Mol(m);a=n.GetConformer().GetAtomPosition(2);b=n.GetConformer().GetAtomPosition(3)
        n.GetConformer().SetAtomPosition(2,b);n.GetConformer().SetAtomPosition(3,a)
        self.assertAlmostEqual(rdMolAlign.CalcRMS(n,m,symmetrizeConjugatedTerminalGroups=True),0)


if __name__=='__main__':unittest.main()
