#!/usr/bin/env python3
"""Measure frozen SOS1 designer geometry against post-freeze 5OVH/5OVI.

This is deliberately an evaluation-only program.  It verifies the complete
prediction boundary before resolving a holdout path and emits scalar
measurements and atom-name mappings, never holdout Cartesian coordinates.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from rdkit import Chem


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
EVALUATOR_PATH = HERE / "evaluate-sos1-holdouts.py"
HOLDOUT_IDS = ("5OVF", "5OVG", "5OVH", "5OVI")
VALIDATION_SPECS = (
    {
        "stepId": "open-phe890-pocket", "stateId": "AWW", "pdbId": "5OVH",
        "ligandComponentId": "AWW", "ligandChain": "A", "ligandResidueNumber": 1101,
        "torsions": (
            ("thiophene-arm-carbon-side", ("N7", "C12", "C15", "CX2")),
            ("thiophene-arm-sulfur-side", ("N7", "C12", "C15", "SX1")),
            ("terminal-biaryl", ("CX3", "CX4", "CX5", "CX11")),
        ),
        "designerContact": {
            "ligandAtomName": "OX3", "receptorResidueName": "TYR",
            "receptorChain": "A", "receptorResidueNumber": 884,
            "receptorAtomName": "O",
        },
    },
    {
        "stepId": "finish-bay-293", "stateId": "AXH", "pdbId": "5OVI",
        "ligandComponentId": "AXH", "ligandChain": "A", "ligandResidueNumber": 2001,
        "torsions": (
            ("thiophene-arm-carbon-side", ("N7", "C12", "C15", "CX2")),
            ("thiophene-arm-sulfur-side", ("N7", "C12", "C15", "SX1")),
        ),
        "designerContact": None,
    },
)


def load_evaluator():
    spec = importlib.util.spec_from_file_location("sos1_holdout_evaluator", EVALUATOR_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def circular_difference(first: float, second: float) -> float:
    return abs(((first - second + 180.0) % 360.0) - 180.0)


def dihedral(points: list[np.ndarray]) -> float:
    if len(points) != 4:
        raise RuntimeError("A torsion requires four points")
    p0, p1, p2, p3 = points
    b0, b1, b2 = p0 - p1, p2 - p1, p3 - p2
    axis = b1 / np.linalg.norm(b1)
    first = b0 - axis * np.dot(b0, axis)
    second = b2 - axis * np.dot(b2, axis)
    return float(math.degrees(math.atan2(
        np.dot(np.cross(axis, first), second), np.dot(first, second))))


def strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from strings(child)


def assert_replay_holdout_boundary(manifest: dict, checkpoints: dict[str, dict],
                                   audit: list[dict], campaign: dict,
                                   run_dir: Path | None = None) -> dict:
    """Fail closed if a later structure can be an input to the replay.

    Holdout names are allowed in the route's explicit exclusion policy, but
    never in action arguments, the initial coordinate declaration, or a
    coordinate-source field in a frozen checkpoint.
    """
    if manifest.get("protocol", {}).get("initialCoordinateInput") != "PDB 5OVE/AXE only":
        raise RuntimeError("Replay does not declare 5OVE/AXE as its sole initial coordinates")
    boundary = campaign.get("protocolBoundary", {})
    if boundary.get("coordinateInputs") != [
            "PDB 5OVE SOS1 protein", "PDB 5OVE ligand AXE"]:
        raise RuntimeError("Registered route coordinate inputs are not exactly 5OVE/AXE")
    excluded = " ".join(boundary.get("forbiddenBeforeFreeze", [])).upper()
    if "5OVF--5OVI" not in excluded:
        raise RuntimeError("Registered route does not exclude later coordinates before freeze")
    forbidden = tuple(identifier.upper() for identifier in HOLDOUT_IDS)
    for index, record in enumerate(audit):
        for value in strings(record.get("args", {})):
            upper = value.upper()
            if any(identifier in upper for identifier in forbidden):
                raise RuntimeError(
                    f"Chemist Action {index + 1} contains holdout input {value!r}")
    for step_id, checkpoint in checkpoints.items():
        for key in ("coordinateInputClass", "coordinateSourcePdbId", "sourcePdbId"):
            value = checkpoint.get(key)
            if isinstance(value, str) and any(item in value.upper() for item in forbidden):
                raise RuntimeError(f"{step_id}: frozen prediction names a holdout coordinate source")
        if checkpoint.get("frozenBeforeHoldoutAccess") is not True:
            raise RuntimeError(f"{step_id}: checkpoint was not frozen before holdout access")
    if run_dir is not None:
        for filename in (f"{identifier}.pdb" for identifier in HOLDOUT_IDS):
            if (run_dir / filename).exists():
                raise RuntimeError(f"Prediction run directory contains holdout file {filename}")
    return {
        "passed": True,
        "initialCoordinateInput": "PDB 5OVE/AXE only",
        "laterCoordinateInputs": 0,
        "chemistActionArgumentsChecked": len(audit),
        "allCheckpointsFrozenBeforeHoldoutAccess": True,
    }


def assert_measurement_only_output(value: Any, path: str = "report") -> None:
    """Ensure the validation report cannot be repurposed as a pose asset."""
    if isinstance(value, list):
        for index, child in enumerate(value):
            assert_measurement_only_output(child, f"{path}[{index}]")
        return
    if not isinstance(value, dict):
        return
    forbidden = {"coordinates", "coordinatesAngstrom", "positions", "pdbText", "molBlock"}
    for key, child in value.items():
        if key in forbidden:
            raise RuntimeError(f"{path}.{key} contains a forbidden coordinate payload")
        assert_measurement_only_output(child, f"{path}.{key}")


def named_rows(rows: list[dict], *, residue_name: str, chain: str,
               residue_number: int) -> dict[str, np.ndarray]:
    return {row["atomName"]: row["point"] for row in rows
            if row["residueName"] == residue_name and row["chain"] == chain
            and row["residueNumber"] == residue_number}


def contact_distance(ligand: dict[str, np.ndarray], receptor_rows: list[dict],
                     descriptor: dict, evaluator, alignment: dict | None = None) -> float:
    matches = [row["point"] for row in receptor_rows
               if row["record"] == "ATOM"
               and row["residueName"] == descriptor["receptorResidueName"]
               and row["chain"] == descriptor["receptorChain"]
               and row["residueNumber"] == descriptor["receptorResidueNumber"]
               and row["atomName"] == descriptor["receptorAtomName"]]
    if len(matches) != 1 or descriptor["ligandAtomName"] not in ligand:
        raise RuntimeError("Designer contact participants are missing or ambiguous")
    receptor = matches[0]
    if alignment is not None:
        receptor = evaluator.transform_points(np.array([receptor]), alignment)[0]
    return float(np.linalg.norm(ligand[descriptor["ligandAtomName"]] - receptor))


def measure_state(spec: dict, checkpoint: dict, reference_rows: list[dict],
                  holdout_text: str, campaign: dict, protocol: dict, evaluator) -> dict:
    step = next(item for item in campaign["steps"] if item["id"] == spec["stepId"])
    predicted = evaluator.coordinates_by_name(checkpoint)
    holdout_rows = evaluator.pdb_rows(holdout_text)
    alignment = evaluator.receptor_alignment(reference_rows, holdout_rows, protocol)
    template = Chem.MolFromSmiles(step["productSmiles"])
    fragment, source_names = evaluator.ligand_fragment(
        holdout_text, spec["ligandComponentId"], spec["ligandResidueNumber"],
        spec["ligandChain"])
    fragment, mappings, graph_validation = evaluator.exact_registered_graph_mappings(
        template, fragment)
    conformer = fragment.GetConformer()
    raw_points = np.array([[conformer.GetAtomPosition(index).x,
                            conformer.GetAtomPosition(index).y,
                            conformer.GetAtomPosition(index).z]
                           for index in range(fragment.GetNumAtoms())])
    aligned_points = evaluator.transform_points(raw_points, alignment)
    product_names = step["productAtomNames"]
    predicted_points = np.array([predicted[name] for name in product_names])
    scored = [(evaluator.rmsd(predicted_points, aligned_points[mapping]), mapping)
              for mapping in mappings]
    ligand_rmsd, mapping = min(scored, key=lambda item: item[0])
    observed = {name: aligned_points[mapping[index]]
                for index, name in enumerate(product_names)}
    torsions = []
    for identifier, names in spec["torsions"]:
        predicted_degrees = dihedral([predicted[name] for name in names])
        holdout_degrees = dihedral([observed[name] for name in names])
        torsions.append({
            "id": identifier, "productAtomNames": list(names),
            "predictedDegrees": predicted_degrees,
            "holdoutDegrees": holdout_degrees,
            "absoluteCircularDifferenceDegrees": circular_difference(
                predicted_degrees, holdout_degrees),
        })
    predicted_phe_rows = [{
        "record": "ATOM", "atomName": atom["atomName"],
        "residueName": atom["residueName"], "chain": atom["chain"],
        "residueNumber": atom["residueIndex"],
        "point": np.array(atom["coordinatesAngstrom"]),
    } for atom in checkpoint["pocket"]["atoms"]]
    phe = evaluator.phe890_metrics(predicted_phe_rows, holdout_rows, alignment)
    contact = None
    if spec["designerContact"] is not None:
        contact = {
            "descriptor": spec["designerContact"],
            "predictedHeavyAtomDistanceAngstrom": contact_distance(
                predicted, predicted_phe_rows, spec["designerContact"], evaluator),
            "holdoutHeavyAtomDistanceAngstrom": contact_distance(
                observed, holdout_rows, spec["designerContact"], evaluator, alignment),
        }
    release_records = [{
        "id": record.get("id"),
        "axisAtomNames": record.get("referenceBondAtomNames"),
        "proximalAtomName": record.get("proximalReferenceAtomName"),
        "distalAtomName": record.get("distalReferenceAtomName"),
        "releasedAtomNames": record.get("releasedReferenceAtomNames"),
        "coordinateInputs": record.get("coordinateInputs", []),
    } for record in step.get("posePropagationMap", {}).get("mappedRotorReleases", [])]
    if any(record["coordinateInputs"] for record in release_records):
        raise RuntimeError(f"{spec['stepId']}: registered rotor release uses coordinate input")
    return {
        "stepId": spec["stepId"], "predictedStateId": spec["stateId"],
        "holdout": {"role": "evaluation-only", "pdbId": spec["pdbId"],
                    "ligandComponentId": spec["ligandComponentId"]},
        "alignment": {"method": "registered Phe890-excluding receptor anchors",
                      "atomCount": alignment["atoms"],
                      "rmsdAngstrom": alignment["rmsdAngstrom"]},
        "ligand": {
            "wholeHeavyAtomRmsdAngstrom": ligand_rmsd,
            "mappingMethod": "exact registered graph; symmetry-minimized; no ligand fit",
            "symmetryMappingsEvaluated": len(mappings),
            "registeredGraphValidation": graph_validation,
            "productToHoldoutAtomNames": [source_names[mapping[index]]
                                           for index in range(len(product_names))],
            "torsions": torsions,
            "designerContact": contact,
        },
        "savedDesignerDirection": {
            "selectedSeedAudit": checkpoint.get("refinement", {}).get(
                "featureGuidedSeeding", {}).get("selectedSeedAudit"),
            "registeredMappedRotorReleases": release_records,
            "interpretation": ("Frozen prospective geometry measured as saved; "
                               "holdout geometry was not used to choose it."),
        },
        "predictedReceptorVersusHoldout": {
            "residue": "PHE A890", "predictedChiDegrees": phe["predictedChiDegrees"],
            "holdoutChiDegrees": phe["holdoutChiDegrees"],
            "chi1DifferenceDegrees": phe["chi1DifferenceDegrees"],
            "chi2DifferenceDegrees": phe["chi2DifferenceDegrees"],
            "sidechainRmsdAngstrom": phe["sidechainRmsdAngstrom"],
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", required=True, type=Path)
    parser.add_argument("--holdout-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--protocol", type=Path,
                        default=HERE / "generated/sos1-holdout-evaluation-protocol.json")
    args = parser.parse_args()
    evaluator = load_evaluator()
    run_dir = args.run.resolve()

    # This entire block completes before a holdout directory is resolved or read.
    protocol_bytes, protocol = evaluator.verify_evaluation_protocol(args.protocol.resolve())
    (manifest_bytes, manifest, checkpoints, reference_rows, audit,
     campaign) = evaluator.verify_run(run_dir, protocol)
    boundary = assert_replay_holdout_boundary(
        manifest, checkpoints, audit, campaign, run_dir)

    results = []
    holdout_hashes = {}
    holdout_dir = args.holdout_dir.resolve()
    if holdout_dir == run_dir or run_dir in holdout_dir.parents:
        raise RuntimeError("Holdout directory must be outside the frozen prediction run")
    for spec in VALIDATION_SPECS:
        path = (holdout_dir / f"{spec['pdbId']}.pdb").resolve()
        if path.parent != holdout_dir:
            raise RuntimeError("Holdout path escapes the declared directory")
        data = path.read_bytes()
        text = data.decode()
        if evaluator.pdb_identifier(text) != spec["pdbId"]:
            raise RuntimeError(f"Opened holdout is not registered PDB {spec['pdbId']}")
        holdout_hashes[spec["pdbId"]] = sha256(data)
        result = measure_state(spec, checkpoints[spec["stepId"]],
                               reference_rows[spec["stepId"]], text,
                               campaign, protocol, evaluator)
        result["holdout"]["coordinateSha256"] = holdout_hashes[spec["pdbId"]]
        result["frozenPredictionSha256"] = next(
            entry["sha256"] for entry in manifest["checkpoints"]
            if entry["stepId"] == spec["stepId"])
        results.append(result)
    report = {
        "schema": "molarium.sos1-designer-geometry-validation/v1",
        "routeId": "sos1-hit-only", "status": "post-freeze-validation-only",
        "purpose": ("Compare saved designer-directed ligand geometry and predicted Phe890 "
                    "with later structures; never provide replay coordinates."),
        "boundary": {
            **boundary,
            "predictionManifestSha256": sha256(manifest_bytes),
            "evaluationProtocolSha256": sha256(protocol_bytes),
            "holdoutsResolvedOnlyAfterPredictionVerification": True,
            "outputContainsHoldoutCoordinates": False,
            "holdoutResultsMayNotSelectOrModifyReplay": True,
        },
        "results": results,
    }
    assert_measurement_only_output(report)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(args.output)


if __name__ == "__main__":
    main()
