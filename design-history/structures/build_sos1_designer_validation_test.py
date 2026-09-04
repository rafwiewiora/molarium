#!/usr/bin/env python3
"""Focused boundary and geometry tests for SOS1 post-freeze validation."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile
import unittest

import numpy as np


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "build_sos1_designer_validation", HERE / "build-sos1-designer-validation.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class DesignerValidationTest(unittest.TestCase):
    def fixture(self):
        manifest = {"protocol": {"initialCoordinateInput": "PDB 5OVE/AXE only"}}
        campaign = {"protocolBoundary": {
            "coordinateInputs": ["PDB 5OVE SOS1 protein", "PDB 5OVE ligand AXE"],
            "forbiddenBeforeFreeze": ["5OVF--5OVI protein coordinates",
                                      "5OVF--5OVI ligand coordinates"],
        }}
        checkpoints = {"open-phe890-pocket": {"frozenBeforeHoldoutAccess": True},
                       "finish-bay-293": {"frozenBeforeHoldoutAccess": True}}
        audit = [{"action": "designRoute.load", "args": {"routeId": "sos1-hit-only"}},
                 {"action": "pose.refine", "args": {"count": 8}}]
        return manifest, checkpoints, audit, campaign

    def test_holdout_boundary_accepts_registered_hit_only_replay(self):
        values = self.fixture()
        with tempfile.TemporaryDirectory() as scratch:
            result = MODULE.assert_replay_holdout_boundary(
                *values, run_dir=Path(scratch))
        self.assertTrue(result["passed"])
        self.assertEqual(result["laterCoordinateInputs"], 0)

    def test_holdout_boundary_rejects_later_structure_in_action_args(self):
        manifest, checkpoints, audit, campaign = self.fixture()
        audit.append({"action": "molecule.load", "args": {"pdbId": "5OVH"}})
        with self.assertRaisesRegex(RuntimeError, "holdout input"):
            MODULE.assert_replay_holdout_boundary(
                manifest, checkpoints, audit, campaign)

    def test_holdout_boundary_rejects_holdout_file_inside_run(self):
        values = self.fixture()
        with tempfile.TemporaryDirectory() as scratch:
            (Path(scratch) / "5OVI.pdb").write_text("holdout")
            with self.assertRaisesRegex(RuntimeError, "contains holdout file"):
                MODULE.assert_replay_holdout_boundary(
                    *values, run_dir=Path(scratch))

    def test_measurement_report_cannot_embed_coordinates(self):
        MODULE.assert_measurement_only_output({
            "torsion": {"predictedDegrees": 175.0, "holdoutDegrees": -170.0},
            "atomNames": ["N7", "C12", "C15", "SX1"],
        })
        with self.assertRaisesRegex(RuntimeError, "forbidden coordinate payload"):
            MODULE.assert_measurement_only_output({
                "holdout": {"coordinatesAngstrom": [[1.0, 2.0, 3.0]]}})

    def test_dihedral_and_periodic_difference(self):
        points = [np.array([0.0, 1.0, 0.0]), np.array([0.0, 0.0, 0.0]),
                  np.array([1.0, 0.0, 0.0]), np.array([1.0, 0.0, 1.0])]
        self.assertAlmostEqual(abs(MODULE.dihedral(points)), 90.0)
        self.assertAlmostEqual(MODULE.circular_difference(175.0, -175.0), 10.0)


if __name__ == "__main__":
    unittest.main()
