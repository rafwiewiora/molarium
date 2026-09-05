#!/usr/bin/env python3
"""Focused tests for the receptor-only AWW publication validation gate."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "validate_sos1_aww_receptor_only",
    HERE / "validate-sos1-aww-receptor-only.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class Evaluator:
    THRESHOLDS = {
        "phe890Chi1DifferenceDegrees": 25.0,
        "phe890Chi2DifferenceDegrees": 35.0,
        "phe890SidechainRmsdAngstrom": 1.5,
    }


class DesignerValidator:
    @staticmethod
    def assert_measurement_only_output(value):
        forbidden = {"coordinates", "coordinatesAngstrom", "positions", "pdbText"}

        def visit(item):
            if isinstance(item, list):
                for child in item:
                    visit(child)
            elif isinstance(item, dict):
                for key, child in item.items():
                    if key in forbidden:
                        raise RuntimeError("forbidden coordinate payload")
                    visit(child)
        visit(value)


def frozen():
    return {
        "manifestBytes": b"manifest\n", "campaignBytes": b"campaign\n",
        "evidenceBytes": b"evidence\n", "auditBytes": b"audit\n",
        "sourceBytes": b"source\n",
        "boundary": {"laterStructureAccess": False},
        "manifest": {"designerTorsion": {
            "beforeDegrees": 72.0, "requestedDegrees": -108.0,
            "afterDegrees": -108.0}},
        "evidence": {"selectedPhe890": {"candidate": {
            "rank": 1, "chiDegrees": [170.0, 80.0], "severeClashes": 0}}},
    }


def measurement(*, chi1=4.0, chi2=3.0, rmsd=0.6, torsion=8.0):
    return {
        "predictedReceptorVersusHoldout": {
            "residue": "PHE A890", "predictedChiDegrees": [170.0, 80.0],
            "holdoutChiDegrees": [174.0, 77.0],
            "chi1DifferenceDegrees": chi1, "chi2DifferenceDegrees": chi2,
            "sidechainRmsdAngstrom": rmsd,
        },
        "ligand": {
            "wholeHeavyAtomRmsdAngstrom": 1.2,
            "designerContact": {"holdoutHeavyAtomDistanceAngstrom": 2.86},
            "torsions": [{
                "id": "thiophene-arm-carbon-side", "predictedDegrees": -105.0,
                "holdoutDegrees": -113.0,
                "absoluteCircularDifferenceDegrees": torsion,
            }],
        },
    }


def contact(*, donor=2.9, hydrogen=1.9, angle=165.0):
    return {
        "donorAcceptorDistanceAngstrom": donor,
        "hydrogenAcceptorDistanceAngstrom": hydrogen,
        "donorHydrogenAcceptorAngleDegrees": angle,
    }


def report(measured=None, geometry=None):
    return MODULE.build_validation_report(
        frozen=frozen(), measurement=measured or measurement(),
        integrity={"valid": True}, contact=geometry or contact(),
        holdout_bytes=b"holdout\n", protocol_bytes=b"protocol\n",
        route_bytes=b"route\n", evaluator=Evaluator,
        designer_validator=DesignerValidator)


class ReceptorOnlyValidationTest(unittest.TestCase):
    def test_invalid_ligand_cannot_pass_on_contact_and_phe_alone(self):
        value = MODULE.build_validation_report(
            frozen=frozen(), measurement=measurement(), integrity={"valid": False},
            contact=contact(), holdout_bytes=b"holdout", protocol_bytes=b"protocol",
            route_bytes=b"route", evaluator=Evaluator, designer_validator=DesignerValidator)
        self.assertFalse(value["accepted"])
        self.assertEqual(value["failedChecks"], ["ligandIntegrity"])

    def test_reference_informed_report_does_not_claim_unopened_holdout(self):
        source = frozen()
        source["boundary"]["laterStructureAccess"] = True
        value = MODULE.build_validation_report(
            frozen=source, measurement=measurement(), integrity={"valid": True},
            contact=contact(), holdout_bytes=b"holdout", protocol_bytes=b"protocol",
            route_bytes=b"route", evaluator=Evaluator, designer_validator=DesignerValidator)
        self.assertTrue(value["designerIntentReferenceInformed"])
        self.assertFalse(value["predictionFrozenBeforeValidationAccess"])
        self.assertTrue(value["predictionFrozenBeforeNumericalComparison"])

    def test_accepted_report_matches_publication_adapter_contract(self):
        value = report()
        self.assertEqual(value["schema"], MODULE.VALIDATION_SCHEMA)
        self.assertTrue(value["accepted"])
        self.assertTrue(value["predictionFrozenBeforeValidationAccess"])
        self.assertTrue(value["measurementOnly"])
        self.assertFalse(value["holdoutCoordinatesIncluded"])
        self.assertTrue(value["checks"]["phe890"]["accepted"])
        self.assertTrue(value["checks"]["designerInteraction"]["accepted"])
        self.assertEqual(value["failedChecks"], [])
        self.assertEqual(value["predictionManifestSha256"],
                         MODULE.sha256(b"manifest\n"))

    def test_failure_report_preserves_all_measurements(self):
        value = report(
            measurement(chi1=115.7643, chi2=13.6722, rmsd=4.0604,
                        torsion=30.3412),
            contact(donor=7.3109, hydrogen=6.3504, angle=167.709))
        self.assertFalse(value["accepted"])
        self.assertEqual(value["failedChecks"],
                         ["phe890", "designerInteraction"])
        self.assertFalse(value["checks"]["phe890"]["accepted"])
        self.assertFalse(value["checks"]["designerInteraction"]["accepted"])
        self.assertEqual(value["checks"]["phe890"]["chi1DifferenceDegrees"],
                         115.7643)
        self.assertEqual(value["checks"]["designerInteraction"]
                         ["predictedGeometry"]["donorAcceptorDistanceAngstrom"],
                         7.3109)

    def test_torsion_is_part_of_designer_interaction_gate(self):
        value = report(measurement(torsion=36.0), contact())
        self.assertFalse(value["checks"]["designerInteraction"]["accepted"])
        self.assertEqual(value["failedChecks"], ["designerInteraction"])

    def test_measurement_only_guard_rejects_coordinate_payload(self):
        with self.assertRaisesRegex(RuntimeError, "forbidden coordinate payload"):
            DesignerValidator.assert_measurement_only_output({
                "holdout": {"coordinatesAngstrom": [[1.0, 2.0, 3.0]]}})


if __name__ == "__main__":
    unittest.main()
