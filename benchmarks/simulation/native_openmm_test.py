"""Independent analytic and finite-difference checks of the Python oracle."""
import copy
import json
import math
import unittest
from pathlib import Path
import openmm as mm
from openmm import unit
from native_openmm import accuracy, validate_numeric_system

PACKET = Path(__file__).parent/'generated/packet.json'


class OracleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases={c['id']:c for c in json.loads(PACKET.read_text())['cases']}
        cls.platform=mm.Platform.getPlatformByName('Reference')

    def evaluate(self,case):
        return accuracy(case,self.platform,{},False)

    def test_complete_numeric_contract(self):
        for case in self.cases.values():
            validate_numeric_system(case)
        for key in ('customExternalForces', 'cmap', 'periodicBoxVectors', 'virtualSites'):
            case = copy.deepcopy(self.cases['analytic-total'])
            case['configuredSystem'][key] = []
            with self.assertRaisesRegex(ValueError, 'unsupported numeric System'):
                self.evaluate(case)
        for kind, key, value in [('particles', 'mass_amu', float('inf')),
                                 ('nonbonded', 'epsilon_kj', -1), ('bonds', 'i', 0.5),
                                 ('bonds', 'ignoredForce', 1)]:
            case = copy.deepcopy(self.cases['analytic-total'])
            case['configuredSystem'][kind][0][key] = value
            with self.assertRaises(ValueError):
                self.evaluate(case)

    def test_harmonic_bond_analytic_energy_and_force(self):
        case=self.cases['analytic-bonds']
        atoms=case['molecule']['atoms']
        r=case['configuredSystem']['bonds'][0]
        delta=[(atoms[1][x]-atoms[0][x])*0.1 for x in ('x','y','z')]
        distance=math.sqrt(sum(x*x for x in delta))
        expected=0.5*r['k_kj_nm2']*(distance-r['r0_nm'])**2
        result=self.evaluate(case)
        self.assertAlmostEqual(result['energy'],expected,places=10)
        for axis in range(3):
            f=r['k_kj_nm2']*(distance-r['r0_nm'])*delta[axis]/distance
            self.assertAlmostEqual(result['forces'][axis],f,places=9)
            self.assertAlmostEqual(result['forces'][3+axis],-f,places=9)

    def test_exported_dhfr_matches_actual_upstream_system_xml(self):
        if 'openmm-dhfr-gbsa' not in self.cases:
            self.skipTest('Explicit 46-case subset does not include upstream DHFR')
        case=self.cases['openmm-dhfr-gbsa']
        xml=(PACKET.parent/'openmm-dhfr-gbsa.xml').read_text()
        system=mm.XmlSerializer.deserialize(xml)
        integrator=mm.VerletIntegrator(0.001)
        context=mm.Context(system,integrator,self.platform)
        context.setPositions([[a[k]*0.1 for k in ('x','y','z')] for a in case['molecule']['atoms']])
        state=context.getState(getEnergy=True,getForces=True)
        actual=state.getPotentialEnergy().value_in_unit(unit.kilojoule_per_mole)
        forces=state.getForces(asNumpy=True).value_in_unit(unit.kilojoule_per_mole/unit.nanometer).reshape(-1)
        rebuilt=self.evaluate(case)
        self.assertLess(abs(actual-rebuilt['energy']),1e-8)
        self.assertLess(max(abs(a-b) for a,b in zip(forces,rebuilt['forces'])),1e-8)

    def test_all_tiny_force_terms_are_negative_energy_gradients(self):
        h=1e-6  # nm; reference arithmetic is double
        for name in ['analytic-angles','analytic-torsions','analytic-improper','analytic-lj',
                     'analytic-coulomb','analytic-total','analytic-obc2']:
            case=self.cases[name]
            result=self.evaluate(case)
            for atom in range(4):
                for axis,key in enumerate(('x','y','z')):
                    plus,minus=copy.deepcopy(case),copy.deepcopy(case)
                    plus['molecule']['atoms'][atom][key]+=h*10
                    minus['molecule']['atoms'][atom][key]-=h*10
                    gradient=-(self.evaluate(plus)['energy']-self.evaluate(minus)['energy'])/(2*h)
                    force=result['forces'][atom*3+axis]
                    with self.subTest(case=name,atom=atom,axis=key):
                        self.assertLess(abs(gradient-force),1e-4+1e-6*abs(force))


if __name__=='__main__':
    unittest.main()
