#!/usr/bin/env python3
"""CPU smoke test for the independent panel boundary."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from run_independent_validation import canonical_sha256 as digest, parity_gate, vector_parity


ROOT = Path(__file__).resolve().parent

class IndependentPanelTest(unittest.TestCase):
    def test_parity_gate_uses_both_energy_and_force_limits(self):
        self.assertTrue(parity_gate(0.01, 1.0e-4, 0.02, "kcal/mol")["passed"])
        self.assertFalse(parity_gate(0.03, 1.0e-4, 0.02, "kcal/mol")["passed"])
        self.assertFalse(parity_gate(0.01, 2.0e-3, 0.02, "kcal/mol")["passed"])

    def test_vector_parity_reports_component_units_without_shape_artifacts(self):
        parity = vector_parity([1.0, 2.0, 3.0], [[1.0, 2.5, 2.0]])
        self.assertAlmostEqual(parity["forceRmsDelta"], (1.25 / 3) ** 0.5)
        self.assertEqual(parity["forceMaxAbsDelta"], 1.0)
        self.assertGreater(parity["forceRelativeRms"], 0)

    def test_rdkit_and_openmm_packet(self):
        atoms = [
            {"element": "C", "x": 0.000, "y": 0.000, "z": 0.000},
            {"element": "H", "x": 1.190, "y": 0.000, "z": 0.000},
        ]
        system = {
            "particles": [{"mass_amu": 12.011}, {"mass_amu": 1.008}],
            "constraints": [],
            "bonds": [{"i": 0, "j": 1, "r0_nm": 0.109, "k_kj_nm2": 100000.0}],
            "angles": [], "torsions": [],
            "nonbonded": [
                {"charge_e": 0, "sigma_nm": 0.34, "epsilon_kj": 0.1},
                {"charge_e": 0, "sigma_nm": 0.1, "epsilon_kj": 0.01},
            ],
            "exceptions": [{"i": 0, "j": 1, "chargeprod_e2": 0,
                            "sigma_nm": 1, "epsilon_kj": 0}],
        }
        bonds = [{"a": 0, "b": 1, "order": 1, "aromatic": False}]
        atoms[0]["atomId"] = "C1"; atoms[0]["formalCharge"] = 0; atoms[0]["aromatic"] = False
        atoms[1]["atomId"] = "H1"; atoms[1]["formalCharge"] = 0; atoms[1]["aromatic"] = False
        molecule = {"atoms": atoms, "bonds": bonds, "parameterization": {"system": system}}
        topology = {"atoms": [{"atomId": atom["atomId"], "element": atom["element"],
                                "formalCharge": 0, "aromatic": False} for atom in atoms],
                    "bonds": bonds}
        integrity = {"atomOrderSha256": digest(["C1", "H1"]),
                     "topologySha256": digest(topology),
                     "coordinatesSha256": digest([[atom[axis] for axis in "xyz"] for atom in atoms]),
                     "numericSystemSha256": digest(system), "atomCount": 2, "bondCount": 1}
        packet = {"schema": "molarium.analogue-pose-panel/v1", "protocol": {"id": "smoke"},
                  "poses": [{"id": "ch-smoke", "caseId": "smoke",
                             "molecule": molecule, "integrity": integrity}]}
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.json"
            output = Path(directory) / "output.json"
            source.write_text(json.dumps(packet))
            completed = subprocess.run([sys.executable, str(ROOT / "run_independent_validation.py"),
                                        "--input", str(source), "--output", str(output),
                                        "--mmff94", "--openmm-platform", "Reference"],
                                       capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            report = json.loads(output.read_text())
            self.assertEqual(report["schema"], "molarium.independent-panel-results/v1")
            engines = report["results"][0]["engines"]
            by_engine = {entry["engine"]: entry for entry in engines}
            self.assertTrue(isinstance(by_engine["RDKit MMFF94"]["initialEnergyKcalMol"], float),
                            engines)
            openmm_result = next(entry for entry in engines if entry["engine"].startswith("OpenMM"))
            self.assertEqual(openmm_result["engine"], "OpenMM", engines)
            self.assertAlmostEqual(openmm_result["potentialEnergyKjMol"], 5.0, places=8)

            packet["poses"][0]["molecule"]["parameterization"]["system"]["customForces"] = []
            packet["poses"][0]["integrity"]["numericSystemSha256"] = digest(
                packet["poses"][0]["molecule"]["parameterization"]["system"])
            source.write_text(json.dumps(packet))
            rejected = subprocess.run([sys.executable,
                                       str(ROOT / "run_independent_validation.py"),
                                       "--input", str(source), "--output", str(output),
                                       "--openmm-platform", "Reference", "--require-engines"],
                                      capture_output=True, text=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("unsupported numeric System force classes", rejected.stderr)


if __name__ == "__main__":
    unittest.main()
