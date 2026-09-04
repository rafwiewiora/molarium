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

    def test_registered_pre_holdout_protocol_pins_current_evaluator(self) -> None:
        protocol_bytes, protocol = EVALUATOR.verify_evaluation_protocol(
            EVALUATOR.DEFAULT_PROTOCOL_PATH)
        self.assertTrue(protocol_bytes)
        self.assertTrue(protocol["registeredBeforeHoldoutAccess"])
        self.assertEqual(protocol["holdoutCoordinateHashBinding"],
                         "post-open-evaluation-report-only")
        self.assertEqual(protocol["receptorAlignment"]["anchors"],
                         EVALUATOR.EXPECTED_ALIGNMENT_ANCHORS)

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

    def test_exact_registered_graph_rejects_same_size_wrong_edges(self) -> None:
        template = Chem.MolFromSmiles("C1CCC1")
        exact_coordinates = Chem.MolFromSmiles("C1CCC1")
        exact, mappings, validation = EVALUATOR.exact_registered_graph_mappings(
            template, exact_coordinates)
        self.assertTrue(mappings)
        self.assertTrue(validation["exactBondOrderAndAromaticity"])
        self.assertEqual(EVALUATOR.bond_chemistry_signature(exact),
                         EVALUATOR.bond_chemistry_signature(template))

        wrong_edges = Chem.MolFromSmiles("CC1CC1")
        self.assertEqual(wrong_edges.GetNumAtoms(), template.GetNumAtoms())
        self.assertEqual(wrong_edges.GetNumBonds(), template.GetNumBonds())
        with self.assertRaisesRegex(RuntimeError, "exactly isomorphic"):
            EVALUATOR.exact_registered_graph_mappings(template, wrong_edges)

    def test_registered_graph_restores_and_checks_aromatic_chemistry(self) -> None:
        template = Chem.MolFromSmiles("c1ccncc1")
        coordinate_graph = Chem.RWMol()
        for atom_record in template.GetAtoms():
            coordinate_graph.AddAtom(Chem.Atom(atom_record.GetAtomicNum()))
        for bond in template.GetBonds():
            coordinate_graph.AddBond(bond.GetBeginAtomIdx(), bond.GetEndAtomIdx(),
                                     Chem.BondType.SINGLE)
        registered, mappings, validation = EVALUATOR.exact_registered_graph_mappings(
            template, coordinate_graph.GetMol())
        self.assertTrue(mappings)
        self.assertTrue(all(atom_record.GetIsAromatic()
                            for atom_record in registered.GetAtoms()))
        self.assertTrue(all(bond.GetIsAromatic() for bond in registered.GetBonds()))
        self.assertEqual(validation["bondOrderAndAromaticitySource"],
                         "hash-pinned registered route productSmiles")

    def test_coordinate_inspections_must_be_complete(self) -> None:
        complete = {
            "ligand": {"atoms": [atom("C1", "C", [0.0, 0.0, 0.0])],
                       "totalAtomCount": 1, "truncated": False},
            "pocket": {"atoms": [atom("CA", "C", [1.0, 0.0, 0.0], "ALA")],
                       "totalAtomCount": 1, "truncated": False},
        }
        EVALUATOR.verify_complete_coordinate_inspections(complete, "fixture")

        truncated = json.loads(json.dumps(complete))
        truncated["nestedEvidence"] = {
            "atoms": [atom("C2", "C", [2.0, 0.0, 0.0])],
            "totalAtomCount": 2,
            "truncated": True,
        }
        with self.assertRaisesRegex(RuntimeError, "truncated"):
            EVALUATOR.verify_complete_coordinate_inspections(truncated, "fixture")

        incomplete_count = json.loads(json.dumps(complete))
        incomplete_count["ligand"]["totalAtomCount"] = 2
        with self.assertRaisesRegex(RuntimeError, "incomplete atom coverage"):
            EVALUATOR.verify_complete_coordinate_inspections(
                incomplete_count, "fixture")

    def test_diagnostic_branch_is_rejected_before_holdout_evaluation(self) -> None:
        manifest = {"publicationEligible": True, "protocol": {"phe890Branching": {
            "diagnosticOnly": False, "diagnosticExactCoordinateSha256": None}}}
        checkpoints = {"open-phe890-pocket": {"rotamerDecision": {
            "publicationEligible": True, "diagnosticOnly": False,
            "deterministicFinalReplayVerified": True}}}
        EVALUATOR.verify_publication_eligibility(manifest, checkpoints)
        with self.assertRaisesRegex(RuntimeError, "non-promotable"):
            EVALUATOR.verify_publication_eligibility(
                {"publicationEligible": False}, checkpoints)
        diagnostic_manifest = json.loads(json.dumps(manifest))
        diagnostic_manifest["protocol"]["phe890Branching"] = {
            "diagnosticOnly": True, "diagnosticExactCoordinateSha256": "d" * 64}
        with self.assertRaisesRegex(RuntimeError, "diagnostic Phe890 selector"):
            EVALUATOR.verify_publication_eligibility(diagnostic_manifest, checkpoints)
        checkpoints["open-phe890-pocket"]["rotamerDecision"]["diagnosticOnly"] = True
        with self.assertRaisesRegex(RuntimeError, "diagnostic"):
            EVALUATOR.verify_publication_eligibility(manifest, checkpoints)

    def test_required_relaxation_and_retention_fail_closed(self) -> None:
        product_graph = {"atomCount": 2, "bondCount": 1,
            "atoms": [
                {"atomName": "C1", "element": "C", "formalCharge": 0,
                 "aromatic": False},
                {"atomName": "N1", "element": "N", "formalCharge": 0,
                 "aromatic": False}],
            "bonds": [{"atomNames": ["C1", "N1"], "order": 1,
                       "aromatic": False}]}
        valence = {"schema": "molarium.ligand-valence-safeguard/v1",
            "accepted": True, "complete": True, "checkedHeavyBonds": 1,
            "expectedHeavyBonds": 1,
            "bondMeasurements": [{"accepted": True}], "violations": []}
        ligand = {"atoms": [
            {"atomId": "a1", "atomName": "C1", "element": "C",
             "formalCharge": 0, "aromatic": False},
            {"atomId": "a2", "atomName": "N1", "element": "N",
             "formalCharge": 0, "aromatic": False}],
            "bonds": [{"atomIds": ["a1", "a2"], "order": 1,
                       "aromatic": False}]}
        retention_phase = {
            "active": True, "accepted": True,
            "fixedAtomIds": ["hard-1", "p-1", "p-2", "p-3"],
            "hardAnchor": {"rmsdAngstrom": 0.0,
                           "maxDisplacementAngstrom": 0.0},
            "features": [{
                "id": "terminal", "registeredIntentId": "retain-terminal",
                "accepted": True, "productAtomIds": ["p-1", "p-2", "p-3"],
                "symmetryVariantCount": 2,
                "rmsdAngstrom": 0.2, "centroidDisplacementAngstrom": 0.1,
                "planeNormalAngleDegrees": 2.0, "toleranceAngstrom": 1.5,
            }],
        }
        checkpoint = {"stepId": "finish-bay-293", "ligand": ligand,
            "relaxation": {"accepted": True, "valenceSafeguard": valence,
            "registeredPoseRetention": {"accepted": True,
                "fixedAtomMotion": {"accepted": True,
                    "atomIds": ["hard-1", "p-1", "p-2", "p-3"],
                    "atomCount": 4, "rmsdAngstrom": 2e-7,
                    "maximumDisplacementAngstrom": 4e-7},
                "before": json.loads(json.dumps(retention_phase)),
                "after": json.loads(json.dumps(retention_phase))}},
            "sidechainContinuity": {"residue": "PHE A890", "accepted": True,
                                      "finalChiDegrees": [-170.0, 95.0]},
            "staging": {"productHeavyGraph": product_graph,
                        "poseTransferPlan": {"featureCorrespondences": [{
                "id": "terminal", "registeredIntentId": "retain-terminal",
                "required": True, "restraint": {"toleranceAngstrom": 1.5},
                "mappingVariants": [
                    {"referenceAtomNames": ["R1", "R2", "R3"]},
                    {"referenceAtomNames": ["R1", "R2", "R3"]},
                ],
            }]}}}
        EVALUATOR.verify_accepted_checkpoint_relaxation(
            checkpoint, "finish-bay-293")
        no_valence = json.loads(json.dumps(checkpoint))
        del no_valence["relaxation"]["valenceSafeguard"]
        with self.assertRaisesRegex(RuntimeError, "safeguard evidence is incomplete"):
            EVALUATOR.verify_accepted_checkpoint_relaxation(
                no_valence, "finish-bay-293")
        wrong_graph = json.loads(json.dumps(checkpoint))
        wrong_graph["ligand"]["bonds"][0]["order"] = 2
        with self.assertRaisesRegex(RuntimeError, "ligand graph differs"):
            EVALUATOR.verify_accepted_checkpoint_relaxation(
                wrong_graph, "finish-bay-293")
        rejected = json.loads(json.dumps(checkpoint))
        rejected["relaxation"]["accepted"] = False
        with self.assertRaisesRegex(RuntimeError, "was not accepted"):
            EVALUATOR.verify_accepted_checkpoint_relaxation(
                rejected, "finish-bay-293")
        inactive = json.loads(json.dumps(checkpoint))
        inactive["relaxation"]["registeredPoseRetention"]["after"]["active"] = False
        with self.assertRaisesRegex(RuntimeError, "retention was not accepted"):
            EVALUATOR.verify_accepted_checkpoint_relaxation(
                inactive, "finish-bay-293")
        ambiguous = json.loads(json.dumps(checkpoint))
        ambiguous["relaxation"]["registeredPoseRetention"]["after"]["features"] *= 2
        with self.assertRaisesRegex(RuntimeError, "feature count is not exact"):
            EVALUATOR.verify_accepted_checkpoint_relaxation(
                ambiguous, "finish-bay-293")
        no_before = json.loads(json.dumps(checkpoint))
        del no_before["relaxation"]["registeredPoseRetention"]["before"]
        with self.assertRaisesRegex(RuntimeError, "retention was not accepted"):
            EVALUATOR.verify_accepted_checkpoint_relaxation(
                no_before, "finish-bay-293")
        changed_atoms = json.loads(json.dumps(checkpoint))
        changed_atoms["relaxation"]["registeredPoseRetention"]["after"] \
            ["features"][0]["productAtomIds"][2] = "p-4"
        with self.assertRaisesRegex(RuntimeError, "atom identities changed"):
            EVALUATOR.verify_accepted_checkpoint_relaxation(
                changed_atoms, "finish-bay-293")
        moved_fixed = json.loads(json.dumps(checkpoint))
        moved_fixed["relaxation"]["registeredPoseRetention"] \
            ["fixedAtomMotion"]["accepted"] = False
        moved_fixed["relaxation"]["registeredPoseRetention"] \
            ["fixedAtomMotion"]["maximumDisplacementAngstrom"] = 0.001
        with self.assertRaisesRegex(RuntimeError, "fixed atoms moved"):
            EVALUATOR.verify_accepted_checkpoint_relaxation(
                moved_fixed, "finish-bay-293")

    def test_receptor_alignment_uses_only_registered_non_phe_anchors(self) -> None:
        anchors = EVALUATOR.EXPECTED_ALIGNMENT_ANCHORS
        protocol = {"receptorAlignment": {
            "anchors": anchors,
            "minimumAnchorCount": len(anchors),
            "excludedDesignedResidues": [
                {"chain": "A", "residueNumber": 890, "residueName": "PHE"}],
        }}

        def row(entry: dict, point: np.ndarray) -> dict:
            return {"record": "ATOM", "chain": entry["chain"],
                    "residueNumber": entry["residueNumber"],
                    "insertionCode": entry["insertionCode"],
                    "residueName": entry["residueName"],
                    "atomName": entry["atomName"], "point": point}

        reference = []
        mobile = []
        shift = np.array([4.0, -2.0, 1.0])
        for index, entry in enumerate(anchors):
            point = np.array([index % 3.0, (index * index) % 5.0,
                              math.sin(index)])
            reference.append(row(entry, point))
            mobile.append(row(entry, point + shift))
        phe = {"chain": "A", "residueNumber": 890, "insertionCode": "",
               "residueName": "PHE", "atomName": "CA"}
        reference.append(row(phe, np.array([0.0, 0.0, 0.0])))
        mobile.append(row(phe, np.array([100.0, 100.0, 100.0])))

        alignment = EVALUATOR.receptor_alignment(reference, mobile, protocol)
        self.assertLess(alignment["rmsdAngstrom"], 1e-8)
        self.assertEqual(alignment["atoms"], len(anchors))
        self.assertEqual(alignment["excludedDesignedResidues"],
                         protocol["receptorAlignment"]["excludedDesignedResidues"])

        with self.assertRaisesRegex(RuntimeError, "anchors are incomplete"):
            EVALUATOR.receptor_alignment(reference[:-2], mobile[:-2], protocol)

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
