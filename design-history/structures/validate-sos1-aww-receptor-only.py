#!/usr/bin/env python3
"""Validate a frozen receptor-only SOS1 AWW run against post-freeze 5OVH.

The prediction boundary, manifest bindings, action audit, and saved coordinates
are verified before the holdout path is resolved or read.  The root output is a
small scalar-only publication gate; it never contains holdout coordinates.
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
DESIGNER_VALIDATOR_PATH = HERE / "build-sos1-designer-validation.py"
DEFAULT_PROTOCOL = HERE / "generated/sos1-holdout-evaluation-protocol.json"
DEFAULT_ROUTE = HERE / "generated/sos1-prospective-campaign.json"
RUN_SCHEMA = "molarium.sos1-aww-receptor-only-prospective/v1"
VALIDATION_SCHEMA = "molarium.sos1-aww-receptor-only-validation/v1"
HOLDOUT_ID = "5OVH"
HOLDOUT_IDS = ("5OVF", "5OVG", "5OVH", "5OVI")
DESIGNER_THRESHOLDS = {
    "torsionCircularDifferenceDegrees": 35.0,
    "donorAcceptorDistanceAngstrom": 3.5,
    "hydrogenAcceptorDistanceAngstrom": 2.6,
    "donorHydrogenAcceptorAngleDegrees": 130.0,
}
PROHIBITED_ACTIONS = {
    "pose.refine", "pose.apply", "pose.updateReceptorReference",
    "optimization.run", "calculation.run",
}


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> tuple[bytes, dict]:
    data = path.read_bytes()
    return data, json.loads(data)


def verify_file(path: Path, descriptor: dict, label: str) -> bytes:
    data = path.read_bytes()
    if len(data) != descriptor.get("bytes") or sha256(data) != descriptor.get("sha256"):
        raise RuntimeError(f"{label} no longer matches the frozen manifest")
    return data


def safe_source_path(root: Path, relative_path: str) -> Path:
    path = (root / relative_path).resolve()
    if path == root or root not in path.parents:
        raise RuntimeError("Source campaign path escapes the repository")
    return path


def strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from strings(child)


def verify_prediction_boundary(run_dir: Path, root: Path = ROOT) -> dict:
    """Verify and load a frozen run without resolving or reading the holdout."""
    manifest_bytes, manifest = read_json(run_dir / "prediction-manifest.json")
    evidence_bytes, evidence = read_json(run_dir / "coordinate-inspections.json")
    audit_bytes, audit = read_json(run_dir / "chemist-action-audit.json")
    if manifest.get("schema") != RUN_SCHEMA:
        raise RuntimeError("Unexpected receptor-only prediction schema")
    if manifest.get("status") != "prediction-frozen-later-structures-unopened":
        raise RuntimeError("Prediction is not frozen before validation access")
    contract = manifest.get("scientificContract", {})
    required_contract = {
        "laterStructureAccess": False,
        "ligandIntentFrozenBeforeReceptorPrediction": True,
        "receptorOnly": True,
        "ligandCoordinateEquality": True,
        "poseRefinementUsed": False,
        "optimizationUsed": False,
    }
    for key, expected in required_contract.items():
        if contract.get(key) is not expected:
            raise RuntimeError(f"Prediction scientific contract lacks {key}={expected}")
    if manifest.get("fixedLigand", {}).get("exactEquality") is not True \
            or evidence.get("fixedLigand", {}).get("exactEquality") is not True:
        raise RuntimeError("Frozen run does not prove exact ligand-coordinate equality")
    if manifest["fixedLigand"].get("before") != manifest["fixedLigand"].get("after") \
            or evidence["fixedLigand"].get("before") != evidence["fixedLigand"].get("after"):
        raise RuntimeError("Ligand state changed during receptor-only prediction")

    source = manifest.get("source", {})
    if source.get("stateId") != "AWZ" or source.get("kind") \
            != "exact-frozen-full-system-campaign":
        raise RuntimeError("Prediction source is not the exact frozen AWZ campaign")
    source_path = safe_source_path(root.resolve(), source.get("path", ""))
    source_bytes = source_path.read_bytes()
    if sha256(source_bytes) != source.get("sha256"):
        raise RuntimeError("Frozen AWZ source campaign hash changed")

    for key in ("graphOnly", "ligandIntent", "receptorResponse"):
        descriptor = manifest.get("checkpoints", {}).get(key)
        if not descriptor:
            raise RuntimeError(f"Prediction manifest lacks {key} checkpoint")
        verify_file(run_dir / descriptor["filename"], descriptor, key)
    coordinate_descriptor = manifest.get("evidence", {}).get("coordinateInspections", {})
    audit_descriptor = manifest.get("evidence", {}).get("audit", {})
    verify_file(run_dir / coordinate_descriptor.get("filename", ""),
                coordinate_descriptor, "coordinate evidence")
    verify_file(run_dir / audit_descriptor.get("filename", ""),
                audit_descriptor, "action audit")
    if sha256(evidence_bytes) != coordinate_descriptor.get("sha256") \
            or sha256(audit_bytes) != audit_descriptor.get("sha256"):
        raise RuntimeError("Loaded evidence bytes differ from their manifest bindings")

    current = manifest.get("currentRun", {})
    records = [record for record in audit.get("records", [])
               if current.get("firstSequence", 0) <= record.get("sequence", -1)
               <= current.get("lastSequence", -1)]
    expected_sequences = list(range(current.get("firstSequence", 0),
                                    current.get("lastSequence", -1) + 1))
    if [record.get("sequence") for record in records] != expected_sequences \
            or [record.get("action") for record in records] != current.get("actions") \
            or len(records) != current.get("actionCount"):
        raise RuntimeError("Current-run audit does not match the frozen manifest")
    if PROHIBITED_ACTIONS.intersection(current.get("actions", [])) \
            or current.get("prohibitedActionsObserved") != []:
        raise RuntimeError("Current run used a prohibited ligand-moving/coupled action")
    for record in records:
        upper = " ".join(strings(record.get("args", {}))).upper()
        if any(identifier in upper for identifier in HOLDOUT_IDS):
            raise RuntimeError("Current-run action arguments name a later structure")
    for identifier in HOLDOUT_IDS:
        if (run_dir / f"{identifier}.pdb").exists():
            raise RuntimeError("Prediction run directory contains a holdout coordinate file")

    response = manifest["checkpoints"]["receptorResponse"]
    campaign_bytes, campaign = read_json(run_dir / response["filename"])
    commit = campaign.get("objects", {}).get("commits", {}).get(response["commitId"])
    if not commit or commit.get("snapshotId") != response["snapshotId"]:
        raise RuntimeError("Frozen receptor-response commit/snapshot binding changed")
    snapshot = campaign.get("objects", {}).get("snapshots", {}).get(response["snapshotId"])
    if not snapshot:
        raise RuntimeError("Frozen receptor-response snapshot is missing")
    atoms = snapshot.get("graph", {}).get("atoms", [])
    coordinates = snapshot.get("coordinates", {})
    if coordinates.get("unit") != "angstrom" \
            or len(atoms) != len(coordinates.get("atomIds", [])) \
            or len(atoms) != len(coordinates.get("positions", [])):
        raise RuntimeError("Frozen full-system snapshot is incomplete")
    reference_rows = []
    for atom, atom_id, xyz in zip(atoms, coordinates["atomIds"],
                                  coordinates["positions"]):
        if atom.get("atomId") != atom_id:
            raise RuntimeError("Full-system atom/coordinate ordering changed")
        if atom.get("record") == "ATOM":
            reference_rows.append({
                "record": "ATOM", "atomName": atom.get("atomName"),
                "residueName": atom.get("residueName"), "chain": atom.get("chain"),
                "residueNumber": atom.get("residueIndex"),
                "insertionCode": atom.get("insertionCode") or "",
                "point": np.array(xyz, dtype=float),
            })
    inspections = evidence.get("inspections", {})
    checkpoint = {
        "predictedStateId": "AWW",
        "ligand": inspections.get("ligandAfterPhe"),
        "pocket": inspections.get("pocketAfterPhe"),
    }
    if not checkpoint["ligand"] or not checkpoint["pocket"]:
        raise RuntimeError("Frozen AWW ligand/pocket inspection is missing")
    return {
        "manifestBytes": manifest_bytes, "manifest": manifest,
        "evidenceBytes": evidence_bytes, "evidence": evidence,
        "auditBytes": audit_bytes, "campaignBytes": campaign_bytes,
        "sourceBytes": source_bytes, "checkpoint": checkpoint,
        "referenceRows": reference_rows,
    }


def atom_by_name(inspection: dict, atom_name: str, *, residue_name: str | None = None,
                 residue_number: int | None = None) -> dict:
    matches = [atom for atom in inspection["atoms"]
               if atom.get("atomName") == atom_name
               and (residue_name is None or atom.get("residueName") == residue_name)
               and (residue_number is None
                    or int(atom.get("residueIndex")) == residue_number)]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one {residue_name or '*'} {atom_name}; "
                           f"found {len(matches)}")
    return matches[0]


def donor_geometry(ligand: dict, pocket: dict) -> dict:
    donor = atom_by_name(ligand, "OX3", residue_name="AWW", residue_number=1104)
    acceptor = atom_by_name(pocket, "O", residue_name="TYR", residue_number=884)
    atoms_by_id = {atom["atomId"]: atom for atom in ligand["atoms"]}
    hydrogens = []
    for bond in ligand["bonds"]:
        if donor["atomId"] not in bond["atomIds"]:
            continue
        other_id = next(atom_id for atom_id in bond["atomIds"]
                        if atom_id != donor["atomId"])
        other = atoms_by_id.get(other_id)
        if other and other.get("element") == "H":
            hydrogens.append(other)
    if len(hydrogens) != 1:
        raise RuntimeError(f"Expected one OX3 donor hydrogen, found {len(hydrogens)}")
    hydrogen = hydrogens[0]
    point = lambda atom: np.array(atom["coordinatesAngstrom"], dtype=float)
    donor_point, hydrogen_point, acceptor_point = map(point, (donor, hydrogen, acceptor))
    first, second = donor_point - hydrogen_point, acceptor_point - hydrogen_point
    cosine = float(np.dot(first, second) / (np.linalg.norm(first) * np.linalg.norm(second)))
    return {
        "donorAcceptorDistanceAngstrom": float(np.linalg.norm(
            donor_point - acceptor_point)),
        "hydrogenAcceptorDistanceAngstrom": float(np.linalg.norm(
            hydrogen_point - acceptor_point)),
        "donorHydrogenAcceptorAngleDegrees": float(math.degrees(math.acos(
            max(-1.0, min(1.0, cosine))))),
    }


def build_validation_report(*, frozen: dict, measurement: dict, integrity: dict,
                            contact: dict, holdout_bytes: bytes,
                            protocol_bytes: bytes, route_bytes: bytes,
                            evaluator, designer_validator) -> dict:
    phe = measurement["predictedReceptorVersusHoldout"]
    phe_thresholds = {
        "chi1DifferenceDegrees": evaluator.THRESHOLDS[
            "phe890Chi1DifferenceDegrees"],
        "chi2DifferenceDegrees": evaluator.THRESHOLDS[
            "phe890Chi2DifferenceDegrees"],
        "sidechainRmsdAngstrom": evaluator.THRESHOLDS[
            "phe890SidechainRmsdAngstrom"],
    }
    phe_accepted = all(phe[key] <= limit for key, limit in phe_thresholds.items())
    torsion = next(item for item in measurement["ligand"]["torsions"]
                   if item["id"] == "thiophene-arm-carbon-side")
    designer_accepted = (
        torsion["absoluteCircularDifferenceDegrees"]
        <= DESIGNER_THRESHOLDS["torsionCircularDifferenceDegrees"]
        and contact["donorAcceptorDistanceAngstrom"]
        <= DESIGNER_THRESHOLDS["donorAcceptorDistanceAngstrom"]
        and contact["hydrogenAcceptorDistanceAngstrom"]
        <= DESIGNER_THRESHOLDS["hydrogenAcceptorDistanceAngstrom"]
        and contact["donorHydrogenAcceptorAngleDegrees"]
        >= DESIGNER_THRESHOLDS["donorHydrogenAcceptorAngleDegrees"])
    failed = []
    if not phe_accepted:
        failed.append("phe890")
    if not designer_accepted:
        failed.append("designerInteraction")
    report = {
        "schema": VALIDATION_SCHEMA,
        "predictionManifestSha256": sha256(frozen["manifestBytes"]),
        "accepted": not failed,
        "predictionFrozenBeforeValidationAccess": True,
        "measurementOnly": True,
        "holdoutCoordinatesIncluded": False,
        "failedChecks": failed,
        "checks": {
            "phe890": {
                "accepted": phe_accepted,
                **phe,
                "thresholds": phe_thresholds,
            },
            "designerInteraction": {
                "accepted": designer_accepted,
                "interaction": "AWW OX3 donor to TYR A884 backbone O",
                "predictedGeometry": contact,
                "holdoutHeavyAtomDistanceAngstrom": measurement["ligand"][
                    "designerContact"]["holdoutHeavyAtomDistanceAngstrom"],
                "torsion": {
                    "id": torsion["id"],
                    "predictedDegrees": torsion["predictedDegrees"],
                    "holdoutDegrees": torsion["holdoutDegrees"],
                    "absoluteCircularDifferenceDegrees": torsion[
                        "absoluteCircularDifferenceDegrees"],
                },
                "thresholds": DESIGNER_THRESHOLDS,
            },
        },
        "contextMeasurements": {
            "designerTorsionIntent": frozen["manifest"].get("designerTorsion"),
            "selectedPhe890Prospective": frozen["evidence"].get(
                "selectedPhe890", {}).get("candidate"),
            "ligandWholeHeavyAtomRmsdAngstrom": measurement["ligand"][
                "wholeHeavyAtomRmsdAngstrom"],
            "ligandIntegrity": integrity,
            "comparison": "receptor-aligned; exact graph mapping; no ligand fit",
        },
        "provenance": {
            "predictionCampaignSha256": sha256(frozen["campaignBytes"]),
            "coordinateEvidenceSha256": sha256(frozen["evidenceBytes"]),
            "actionAuditSha256": sha256(frozen["auditBytes"]),
            "sourceAwzCampaignSha256": sha256(frozen["sourceBytes"]),
            "holdoutRole": "post-freeze-evaluation-only",
            "holdoutId": HOLDOUT_ID,
            "holdoutCoordinateSha256": sha256(holdout_bytes),
            "evaluationProtocolSha256": sha256(protocol_bytes),
            "registeredRouteSha256": sha256(route_bytes),
            "evaluatorSha256": sha256(EVALUATOR_PATH.read_bytes()),
            "designerValidatorSha256": sha256(DESIGNER_VALIDATOR_PATH.read_bytes()),
        },
    }
    designer_validator.assert_measurement_only_output(report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", required=True, type=Path)
    parser.add_argument("--holdout", required=True, type=Path,
                        help="Path to the post-freeze 5OVH PDB")
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--protocol", type=Path, default=DEFAULT_PROTOCOL)
    parser.add_argument("--route", type=Path, default=DEFAULT_ROUTE)
    args = parser.parse_args()
    run_dir = args.run.resolve()
    output = run_dir / "post-freeze-validation.json"
    if output.exists():
        raise RuntimeError(f"Refusing to overwrite existing validation: {output}")

    evaluator = load_module(EVALUATOR_PATH, "sos1_aww_receptor_only_evaluator")
    designer = load_module(DESIGNER_VALIDATOR_PATH,
                           "sos1_aww_receptor_only_designer_validator")
    protocol_bytes, protocol = evaluator.verify_evaluation_protocol(
        args.protocol.resolve())
    route_bytes, route = read_json(args.route.resolve())

    # This verification finishes before the holdout path is resolved or read.
    frozen = verify_prediction_boundary(run_dir, args.root.resolve())
    checkpoint = frozen["checkpoint"]
    evaluator.verify_complete_coordinate_inspections(checkpoint,
                                                       "open-phe890-pocket")
    step = next(item for item in route["steps"]
                if item["id"] == "open-phe890-pocket")
    integrity = evaluator.prediction_integrity(
        checkpoint, step, Chem.MolFromSmiles(step["productSmiles"]))

    holdout_path = args.holdout.resolve()
    if holdout_path.parent == run_dir or run_dir in holdout_path.parents:
        raise RuntimeError("Holdout must remain outside the frozen prediction run")
    holdout_bytes = holdout_path.read_bytes()
    holdout_text = holdout_bytes.decode()
    if evaluator.pdb_identifier(holdout_text) != HOLDOUT_ID:
        raise RuntimeError(f"Evaluation input is not registered {HOLDOUT_ID}")
    spec = next(item for item in designer.VALIDATION_SPECS
                if item["stepId"] == "open-phe890-pocket")
    measurement = designer.measure_state(
        spec, checkpoint, frozen["referenceRows"], holdout_text,
        route, protocol, evaluator)
    report = build_validation_report(
        frozen=frozen, measurement=measurement, integrity=integrity,
        contact=donor_geometry(checkpoint["ligand"], checkpoint["pocket"]),
        holdout_bytes=holdout_bytes, protocol_bytes=protocol_bytes,
        route_bytes=route_bytes, evaluator=evaluator, designer_validator=designer)
    with output.open("x") as handle:
        handle.write(json.dumps(report, indent=2) + "\n")
    print(output)


if __name__ == "__main__":
    main()
