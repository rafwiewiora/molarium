#!/usr/bin/env python3
"""Register the SOS1 holdout evaluator without opening any holdout coordinate file."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
EVALUATOR_PATH = HERE / "evaluate-sos1-holdouts.py"
ROUTE_PATH = HERE / "generated/sos1-prospective-campaign.json"
OUTPUT_PATH = HERE / "generated/sos1-holdout-evaluation-protocol.json"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def relative(path: Path) -> str:
    return path.resolve().relative_to(ROOT.resolve()).as_posix()


def main() -> None:
    spec = importlib.util.spec_from_file_location("sos1_holdout_evaluator", EVALUATOR_PATH)
    evaluator = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(evaluator)

    evaluator_bytes = EVALUATOR_PATH.read_bytes()
    route_bytes = ROUTE_PATH.read_bytes()
    route = json.loads(route_bytes)
    protocol = {
        "schema": "molarium.sos1-holdout-evaluation-protocol/v1",
        "routeId": "sos1-hit-only",
        "registeredBeforeHoldoutAccess": True,
        "evaluator": {
            "path": relative(EVALUATOR_PATH),
            "sha256": digest(evaluator_bytes),
        },
        "registeredRoute": {
            "path": relative(ROUTE_PATH),
            "schema": route["schema"],
            "sha256": digest(route_bytes),
        },
        "predictionInputs": {
            "runManifestSchema": "molarium.design-prediction-run/v1",
            "checkpointSchema": "molarium.design-prediction-checkpoint/v1",
            "requiredStepIds": [entry["stepId"] for entry in evaluator.EXPECTED_HOLDOUTS],
            "requireCompleteCoordinateInspections": True,
            "coordinateInspectionRule": (
                "Every persisted inspection containing coordinates must have "
                "truncated=false and totalAtomCount equal to the stored atom count."),
        },
        "thresholds": evaluator.THRESHOLDS,
        "continuityThresholds": evaluator.CONTINUITY_THRESHOLDS,
        "receptorAlignment": {
            "method": "Kabsch rigid superposition on the exact registered anchors",
            "anchors": evaluator.EXPECTED_ALIGNMENT_ANCHORS,
            "minimumAnchorCount": len(evaluator.EXPECTED_ALIGNMENT_ANCHORS),
            "excludedDesignedResidues": [
                {"chain": "A", "residueNumber": 890, "residueName": "PHE"},
            ],
            "selectionRule": (
                "Fixed route-wide C-alpha list spanning the inspected pocket; "
                "the explicitly designed Phe890 coordinate is excluded."),
            "fitAcceptanceThresholdAngstrom":
                evaluator.THRESHOLDS["receptorAlignmentRmsdAngstrom"],
        },
        "holdouts": evaluator.EXPECTED_HOLDOUTS,
        "holdoutCoordinateHashBinding": "post-open-evaluation-report-only",
        "holdoutCoordinatePolicy": (
            "Only expected PDB identities, filenames, ligand identities, and residue numbers "
            "are registered here. Coordinate bytes are neither opened nor hashed by this "
            "builder; each SHA-256 is first bound in the post-open evaluation report."),
    }
    OUTPUT_PATH.write_text(json.dumps(protocol, indent=2) + "\n")
    print(relative(OUTPUT_PATH))


if __name__ == "__main__":
    main()
