#!/usr/bin/env python3
"""Focused tests for the fail-closed SOS1 holdout evaluator."""

from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path
import unittest

import numpy as np
from rdkit import Chem


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "evaluate_sos1_holdouts", HERE / "evaluate-sos1-holdouts.py")
EVALUATOR = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(EVALUATOR)


def atom(name: str, element: str, point: list[float], residue: str = "LIG") -> dict:
    return {"atomId": f"atom:{name}", "atomName": name, "element": element,
            "residueName": residue, "chain": "A", "residueIndex": 1,
            "coordinatesAngstrom": point}


class EvaluatorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.campaign = json.loads((HERE / "generated/sos1-prospective-campaign.json").read_text())
        cls.final_step = next(step for step in cls.campaign["steps"]
                              if step["id"] == "finish-bay-293")

    def test_final_route_has_disjoint_11_4_7_partition(self) -> None:
        regions = EVALUATOR.route_regions(self.final_step)
        self.assertEqual(len(regions["hard"]), 11)
        self.assertEqual(len(regions["released"]), 4)
        self.assertEqual(len(regions["distalFeature"]), 7)
        self.assertEqual(len(regions["edited"]), 10)
        self.assertEqual(len(regions["mapped"]), 15)
        self.assertTrue(set(regions["hard"]).isdisjoint(regions["released"]))
        self.assertTrue(set(regions["hard"]).isdisjoint(regions["distalFeature"]))

    def test_geometry_reports_plane_and_radial_changes(self) -> None:
        first = np.array([[-1.0, 0.0, 0.0], [0.5, math.sqrt(3) / 2, 0.0],
                          [0.5, -math.sqrt(3) / 2, 0.0]])
        second = first @ np.array([[1.0, 0.0, 0.0], [0.0, 0.0, 1.0],
                                   [0.0, -1.0, 0.0]])
        metrics = EVALUATOR.geometry_metrics(first, second)
        self.assertAlmostEqual(metrics["principalPlaneAngleDegrees"], 90.0, places=6)
        self.assertAlmostEqual(metrics["radialProfileRmsdAngstrom"], 0.0, places=6)
        expanded = second * 2.0
        self.assertGreater(EVALUATOR.geometry_metrics(first, expanded)[
            "radialProfileRmsdAngstrom"], 0.9)

    def test_integrity_rejects_topology_and_clashes(self) -> None:
        step = {"productSmiles": "CCO", "productAtomNames": ["C1", "C2", "O1"]}
        template = Chem.MolFromSmiles(step["productSmiles"])
        atoms = [atom("C1", "C", [0.0, 0.0, 0.0]),
                 atom("C2", "C", [1.52, 0.0, 0.0]),
                 atom("O1", "O", [2.95, 0.0, 0.0])]
        bonds = [{"atomIds": ["atom:C1", "atom:C2"]},
                 {"atomIds": ["atom:C2", "atom:O1"]}]
        checkpoint = {"ligand": {"atoms": atoms, "bonds": bonds},
                      "pocket": {"atoms": [atom("CA", "C", [20.0, 0.0, 0.0], "ALA")]}}
        self.assertTrue(EVALUATOR.prediction_integrity(checkpoint, step, template)["valid"])

        missing_bond = json.loads(json.dumps(checkpoint))
        missing_bond["ligand"]["bonds"].pop()
        topology = EVALUATOR.prediction_integrity(missing_bond, step, template)
        self.assertFalse(topology["valid"])
        self.assertFalse(topology["heavyAtomTopologyMatchesRegisteredProduct"])

        clashing = json.loads(json.dumps(checkpoint))
        clashing["pocket"]["atoms"][0]["coordinatesAngstrom"] = [0.2, 0.0, 0.0]
        clash = EVALUATOR.prediction_integrity(clashing, step, template)
        self.assertFalse(clash["valid"])
        self.assertGreater(clash["proteinLigandSevereClashes"], 0)

    def continuity_fixture(self) -> tuple[dict, dict[str, np.ndarray]]:
        pose_map = self.final_step["posePropagationMap"]
        product_names = self.final_step["productAtomNames"]

        def point(index: int) -> np.ndarray:
            return np.array([index % 5.0, (index * index) % 7.0,
                             math.sin(index * 0.7)])

        after_points = {name: point(index)
                        for index, name in enumerate(product_names)}
        before_points = {}
        for mapping in pose_map["commonAtoms"]:
            before_points[mapping["referenceAtomName"]] = point(mapping["productAtomIndex"])
        feature = pose_map["spatialFeatureCorrespondences"][0]
        first_variant = feature["mappingVariants"][0]
        for name, index in zip(first_variant["referenceAtomNames"],
                               first_variant["productAtomIndices"]):
            before_points[name] = point(index)

        def checkpoint(points: dict[str, np.ndarray]) -> dict:
            return {"ligand": {"atoms": [atom(name, "C", coordinates.tolist())
                                           for name, coordinates in points.items()]}}

        checkpoints = {"open-phe890-pocket": checkpoint(before_points),
                       "finish-bay-293": checkpoint(after_points)}
        return checkpoints, after_points

    def test_aww_axh_continuity_accepts_route_registered_same_frame_fixture(self) -> None:
        checkpoints, after_points = self.continuity_fixture()
        product_names = self.final_step["productAtomNames"]
        continuity = EVALUATOR.aww_axh_continuity(self.campaign, checkpoints)
        self.assertTrue(continuity["accepted"])
        self.assertEqual(
            continuity["schema"],
            "molarium.design-prediction-continuity-evaluation/v2")
        self.assertLess(
            continuity["regions"]["distalFeatureAfterHardCoreRigidSuperposition"]
            ["rmsdAngstrom"], 1e-8)
        self.assertFalse(
            continuity["regions"]["hardInternalShapeAfterRigidSuperposition"]
            ["usedForAcceptance"])
        self.assertNotIn("hardRegionFitRmsdAngstrom", continuity["thresholds"])
        self.assertNotIn("hard-region-fit",
                         [check["id"] for check in continuity["checks"]])
        self.assertNotIn(
            "predictedRadiusOfGyrationAngstrom",
            continuity["regions"]["hardSameReceptorFrame"])

        displaced = dict(after_points)
        for index in EVALUATOR.route_regions(self.final_step)["distalFeature"]:
            displaced[product_names[index]] = displaced[product_names[index]] + np.array([3.0, 0.0, 0.0])
        checkpoints["finish-bay-293"]["ligand"]["atoms"] = [
            atom(name, "C", coordinates.tolist())
            for name, coordinates in displaced.items()]
        continuity = EVALUATOR.aww_axh_continuity(self.campaign, checkpoints)
        self.assertFalse(continuity["accepted"])
        self.assertIn("distal-feature-after-hard-core-rigid-superposition-rmsd",
                      continuity["failedChecks"])

    def test_aww_axh_continuity_rejects_rigid_translation_hidden_by_fit(self) -> None:
        checkpoints, after_points = self.continuity_fixture()
        translated = {name: point + np.array([2.0, -1.0, 0.5])
                      for name, point in after_points.items()}
        checkpoints["finish-bay-293"]["ligand"]["atoms"] = [
            atom(name, "C", point.tolist()) for name, point in translated.items()]

        continuity = EVALUATOR.aww_axh_continuity(self.campaign, checkpoints)

        self.assertFalse(continuity["accepted"])
        self.assertIn("hard-region-same-receptor-frame-rmsd",
                      continuity["failedChecks"])
        self.assertIn("hard-region-same-receptor-frame-centroid-displacement",
                      continuity["failedChecks"])
        self.assertLess(
            continuity["regions"]["hardInternalShapeAfterRigidSuperposition"]
            ["rmsdAfterRigidSuperpositionAngstrom"], 1e-8)

    def test_aww_axh_continuity_rejects_rigid_rotation_hidden_by_fit(self) -> None:
        checkpoints, after_points = self.continuity_fixture()
        angle = math.radians(35.0)
        rotation = np.array([[math.cos(angle), -math.sin(angle), 0.0],
                             [math.sin(angle), math.cos(angle), 0.0],
                             [0.0, 0.0, 1.0]])
        center = np.mean(np.array(list(after_points.values())), axis=0)
        rotated = {name: (point - center) @ rotation + center
                   for name, point in after_points.items()}
        checkpoints["finish-bay-293"]["ligand"]["atoms"] = [
            atom(name, "C", point.tolist()) for name, point in rotated.items()]

        continuity = EVALUATOR.aww_axh_continuity(self.campaign, checkpoints)

        self.assertFalse(continuity["accepted"])
        self.assertIn("hard-region-rigid-body-orientation-change",
                      continuity["failedChecks"])
        self.assertGreater(
            continuity["regions"]["hardRigidBodyMotionInSameReceptorFrame"]
            ["orientationChangeDegrees"], 30.0)
        self.assertLess(
            continuity["regions"]["hardInternalShapeAfterRigidSuperposition"]
            ["rmsdAfterRigidSuperpositionAngstrom"], 1e-8)


if __name__ == "__main__":
    unittest.main()
