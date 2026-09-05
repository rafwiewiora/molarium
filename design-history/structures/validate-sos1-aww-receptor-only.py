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
    "donorHydrogenAcceptorAngleDegrees": 150.0,
}
ENERGY_OPTIONS = {
    "implicitSolvent": "obc2",
    "nonbondedCutoffNm": 1.0,
    "constraintMode": "none",
}
PHE890_RESPONSE_ATOMS = [
    {"residueName": "PHE", "chain": "A", "residueIndex": 890,
     "insertionCode": "", "atomName": atom_name}
    for atom_name in ("CG", "CD1", "CD2", "CE1", "CE2", "CZ")
]
PROHIBITED_ACTIONS = {
    "geometry.setInternalCoordinate",
    "pose.refine", "pose.apply", "pose.updateReceptorReference",
    "optimization.run",
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
    boundary_bytes, boundary = read_json(run_dir / "boundary.json")
    evidence_bytes, evidence = read_json(run_dir / "coordinate-inspections.json")
    audit_bytes, audit = read_json(run_dir / "chemist-action-audit.json")
    if manifest.get("schema") != RUN_SCHEMA:
        raise RuntimeError("Unexpected receptor-only prediction schema")
    reference_informed = manifest.get("status") == "prediction-frozen-reference-informed-designer-intent"
    if not reference_informed and manifest.get("status") != "prediction-frozen-later-structures-unopened":
        raise RuntimeError("Prediction is not frozen before validation access")
    if boundary.get("schema") != RUN_SCHEMA \
            or boundary.get("status") != "declared-before-compute" \
            or boundary.get("laterStructureAccess") is not reference_informed:
        raise RuntimeError("Prospective boundary is missing or invalid")
    contract = manifest.get("scientificContract", {})
    required_contract = {
        "laterStructureAccess": reference_informed,
        "ligandIntentFrozenBeforeReceptorPrediction": True,
        "receptorOnly": True,
        "ligandCoordinateEquality": True,
        "poseRefinementUsed": False,
        "optimizationUsed": False,
    }
    for key, expected in required_contract.items():
        if contract.get(key) is not expected:
            raise RuntimeError(f"Prediction scientific contract lacks {key}={expected}")
    if reference_informed and (boundary.get("externalReferenceCoordinatesUsed") is not False
            or contract.get("externalReferenceCoordinatesUsed") is not False
            or boundary.get("designerIntentOrigin") != "reported-series-informed designer hypothesis"):
        raise RuntimeError("Reference-informed intent must explicitly exclude reference-coordinate inputs")
    if manifest.get("fixedLigand", {}).get("exactEquality") is not True \
            or evidence.get("fixedLigand", {}).get("exactEquality") is not True:
        raise RuntimeError("Frozen run does not prove exact ligand-coordinate equality")
    if manifest["fixedLigand"].get("before") != manifest["fixedLigand"].get("after") \
            or evidence["fixedLigand"].get("before") != evidence["fixedLigand"].get("after"):
        raise RuntimeError("Ligand state changed during receptor-only prediction")

    source = manifest.get("source", {})
    graph_resume = (source.get("stateId") == "AWW" and source.get("kind")
                    == "exact-frozen-graph-only-campaign")
    if not graph_resume and (source.get("stateId") != "AWZ" or source.get("kind")
            != "exact-frozen-full-system-campaign"):
        raise RuntimeError("Prediction source is not the exact frozen AWZ campaign")
    source_path = safe_source_path(root.resolve(), source.get("path", ""))
    source_bytes = source_path.read_bytes()
    if sha256(source_bytes) != source.get("sha256"):
        raise RuntimeError("Frozen AWZ source campaign hash changed")
    if graph_resume:
        if source.get("sha256") != "c0672efabc8da255de45a6d8b41f3f1a2bb0652ac2e683a70a9ed33b8692b3b1":
            raise RuntimeError("Graph resume must use the exact a010 checkpoint")
        saved_source = json.loads(source_bytes)
        graph_record = manifest.get("checkpoints", {}).get("graphOnly", {})
        if graph_record.get("sha256") != source["sha256"] \
                or graph_record.get("commitId") != saved_source["branches"]["main"]:
            raise RuntimeError("Resumed graph checkpoint is not bound to the source")

    for key in ("graphOnly", "ligandIntent", "receptorResponse"):
        descriptor = manifest.get("checkpoints", {}).get(key)
        if not descriptor:
            raise RuntimeError(f"Prediction manifest lacks {key} checkpoint")
        verify_file(run_dir / descriptor["filename"], descriptor, key)
    boundary_descriptor = manifest.get("evidence", {}).get("boundary", {})
    coordinate_descriptor = manifest.get("evidence", {}).get("coordinateInspections", {})
    audit_descriptor = manifest.get("evidence", {}).get("audit", {})
    verify_file(run_dir / boundary_descriptor.get("filename", ""),
                boundary_descriptor, "prospective boundary")
    verify_file(run_dir / coordinate_descriptor.get("filename", ""),
                coordinate_descriptor, "coordinate evidence")
    verify_file(run_dir / audit_descriptor.get("filename", ""),
                audit_descriptor, "action audit")
    if sha256(boundary_bytes) != boundary_descriptor.get("sha256") \
            or manifest.get("boundary") != boundary_descriptor:
        raise RuntimeError("Boundary bytes differ from their manifest binding")
    if sha256(evidence_bytes) != coordinate_descriptor.get("sha256") \
            or sha256(audit_bytes) != audit_descriptor.get("sha256"):
        raise RuntimeError("Loaded evidence bytes differ from their manifest bindings")

    current = manifest.get("currentRun", {})
    request_ids = audit.get("currentRunRequestIds")
    if not isinstance(request_ids, list) or len(set(request_ids)) != len(request_ids) \
            or request_ids != current.get("currentRunRequestIds"):
        raise RuntimeError("Current-run request IDs are not bound to the manifest")
    by_request_id = {record.get("requestId"): record
                     for record in audit.get("records", [])}
    if any(request_id not in by_request_id for request_id in request_ids):
        raise RuntimeError("Current-run audit is missing a bound request ID")
    records = [by_request_id[request_id] for request_id in request_ids]
    expected_sequences = list(range(current.get("firstSequence", 0),
                                    current.get("lastSequence", -1) + 1))
    if [record.get("sequence") for record in records] != expected_sequences \
            or [record.get("action") for record in records] != current.get("actions") \
            or len(records) != current.get("actionCount") \
            or any(record.get("status") != "completed" for record in records):
        raise RuntimeError("Current-run audit does not match the frozen manifest")
    if PROHIBITED_ACTIONS.intersection(current.get("actions", [])) \
            or current.get("prohibitedActionsObserved") != []:
        raise RuntimeError("Current run used a prohibited ligand-moving/coupled action")
    calculations = []
    for record in records:
        upper = " ".join(strings(record.get("args", {}))).upper()
        if any(identifier in upper for identifier in HOLDOUT_IDS):
            raise RuntimeError("Current-run action arguments name a later structure")
        if record.get("action") == "calculation.run":
            expected_args = {"job": "energy", "method": "openmm",
                             "options": ENERGY_OPTIONS}
            calculation = record.get("result", {}).get("calculation", {})
            if record.get("args") != expected_args \
                    or calculation.get("job") != "energy" \
                    or calculation.get("method") != "openmm" \
                    or calculation.get("movedHeavyAtomCount") != 0 \
                    or calculation.get("maximumDisplacementAngstrom") != 0:
                raise RuntimeError("Current run contains a non-single-point or moving calculation")
            calculations.append(record)
    for identifier in HOLDOUT_IDS:
        if (run_dir / f"{identifier}.pdb").exists():
            raise RuntimeError("Prediction run directory contains a holdout coordinate file")

    intent = boundary.get("designerIntent", {})
    exact_intent = (
        intent.get("action") == "geometry.alignBranchToContact"
        and intent.get("orderedAxisAtomNames") == ["C12", "C15"]
        and intent.get("designerPrimaryRotationDegrees") == 150
        and intent.get("coupledAxisAtomNames")
        == [["CX4", "CX5"], ["CX15", "CX16"]]
        and intent.get("solution") == "best-directional"
        and intent.get("currentSceneCoordinatesOnly") is True
        and intent.get("externalReferenceCoordinatesUsed") is False
        and intent.get("allowedResponseAtoms") == PHE890_RESPONSE_ATOMS
    )
    if not exact_intent:
        raise RuntimeError("Prospective boundary does not encode the exact +150/coupled-axis/Phe-only intent")
    if reference_informed and (intent.get("upstreamAxisAtomNames") != ["N7", "C12"]
            or intent.get("upstreamRotationRangeDegrees") != [0, 60]
            or boundary.get("waterPolicy") != "all source waters retained and fixed"):
        raise RuntimeError("Reference-informed intent lacks the declared upstream direction and water policy")
    prediction = boundary.get("receptorPrediction", {})
    if prediction.get("energy") != {
            "job": "energy", "method": "openmm", "options": ENERGY_OPTIONS,
            "coordinatePolicy": "fixed-coordinate single-point; no optimization or dynamics"} \
            or prediction.get("everyEnumeratedCandidateEvaluated") is not True \
            or prediction.get("ligandCoordinatesFixed") is not True:
        raise RuntimeError("Prospective boundary lacks the complete fixed-coordinate energy policy")

    graph = next((record for record in records
                  if record.get("action") == "designRoute.applyStep"), None)
    contacts = [record for record in records if record.get("action") == "pose.addContact"]
    alignment = next((record for record in records
                      if record.get("action") == "geometry.alignBranchToContact"), None)
    lock = next((record for record in records
                 if record.get("action") == "pose.setDesignerLigandPoseFixed"
                 and record.get("args", {}).get("fixed") is True), None)
    enumeration = next((record for record in records
                        if record.get("action") == "pose.enumerateSidechainRotamers"), None)
    application = next((record for record in reversed(records)
                        if record.get("action") == "pose.applySidechainRotamer"), None)
    if (not graph and not graph_resume) or len(contacts) != 2 or not alignment or not lock \
            or not enumeration or not application \
            or not all(contact.get("sequence", 0) < alignment.get("sequence", 0)
                       for contact in contacts) \
            or not alignment.get("sequence", 0) < lock.get("sequence", 0) \
            or not lock.get("sequence", 0) < enumeration.get("sequence", 0):
        raise RuntimeError("Current run lacks ordered contacts-before-geometry/lock/Phe prediction")
    if graph is not None and (graph.get("args", {}).get("stepId") != "open-phe890-pocket" \
            or graph.get("result", {}).get("designStep", {}).get("referenceStateId") != "AWZ" \
            or graph.get("result", {}).get("designStep", {}).get("stateId") != "AWW" \
            or graph.get("result", {}).get("designStep", {}).get("inputKind") \
            != "molecular-graph-only"):
        raise RuntimeError("Current run does not contain the registered AWZ-to-AWW graph transition")
    distal = next((record for record in contacts
                   if record.get("args", {}).get("ligandAtom", {}).get("atomName") == "OX3"), None)
    contact_id = distal.get("result", {}).get("contact", {}).get("contactId") if distal else None
    move = alignment.get("result", {}).get("designerBranchContact", {})
    staged_atoms = evidence.get("inspections", {}).get("stagedLigand", {}).get("atoms", [])
    atom_ids_by_name = {atom.get("atomName"): atom.get("atomId")
                        for atom in staged_atoms
                        if atom.get("residueName") == "AWW"
                        and int(atom.get("residueIndex", -1)) == 1104}
    expected_primary_axis = [atom_ids_by_name.get(name) for name in ["C12", "C15"]]
    expected_coupled_axes = [[atom_ids_by_name.get(name) for name in axis]
                             for axis in [["CX4", "CX5"], ["CX15", "CX16"]]]
    if not contact_id or alignment.get("args", {}).get("contactId") != contact_id \
            or move.get("contactId") != contact_id \
            or alignment.get("args", {}).get("designerPrimaryRotationDegrees") != 150 \
            or move.get("selected", {}).get("designerPrimaryRotationDegrees") != 150 \
            or move.get("orderedAxisAtomIds") != alignment.get("args", {}).get("axisAtomIds") \
            or move.get("coupledAxisAtomIds") != alignment.get("args", {}).get("coupledAxisAtomIds") \
            or alignment.get("args", {}).get("axisAtomIds") != expected_primary_axis \
            or alignment.get("args", {}).get("coupledAxisAtomIds") != expected_coupled_axes \
            or alignment.get("args", {}).get("allowedResponseAtoms") \
            != PHE890_RESPONSE_ATOMS \
            or move.get("allowedResponseAtoms") != PHE890_RESPONSE_ATOMS \
            or move.get("allowedResponseResidues") != [{
                "residueName": "PHE", "chain": "A", "residueIndex": 890,
                "insertionCode": ""}]:
        raise RuntimeError("Designer geometry is not bound to its contact/+150/coupled-axis/Phe-only contract")
    if reference_informed:
        upstream_ids = [atom_ids_by_name.get(name) for name in ["N7", "C12"]]
        if alignment.get("args", {}).get("upstreamAxisAtomIds") != upstream_ids \
                or move.get("upstreamAxisAtomIds") != upstream_ids \
                or alignment.get("args", {}).get("upstreamRotationRangeDegrees") != [0, 60] \
                or move.get("upstreamRotationRangeDegrees") != [0, 60] \
                or not 0 <= move.get("selected", {}).get("upstreamRotationDegrees", -1) <= 60 \
                or move.get("selected", {}).get("internalSevereContactCount") != 0:
            raise RuntimeError("Applied geometry violates the upstream/internal-clash declaration")
    selected_geometry = move.get("selected", {}).get("contactGeometry", {})
    if selected_geometry.get("dhaAngleDegrees", -math.inf) < 150:
        raise RuntimeError("Designer geometry fails the 150 degree directional H-bond gate")
    selected_contacts = move.get("selected", {}).get("contacts", {})
    if selected_contacts.get("outsideAllowedResponseContactCount") != 0 \
            or any(not item.get("responseAllowed") and item.get("contactCount") != 0
                   for item in selected_contacts.get("contactsByResidue", [])):
        raise RuntimeError("Designer geometry allows a receptor response outside Phe890")
    lock_id = lock.get("result", {}).get("designerFixedLigandPose", {}).get("lockId")
    if not lock_id or manifest.get("designerFixedLigandPose", {}).get("lockId") != lock_id \
            or evidence.get("designerFixedLigandPose", {}).get("lockId") != lock_id \
            or manifest.get("scientificContract", {}).get("designerFixedLigandPoseLockId") != lock_id \
            or enumeration.get("result", {}).get("sidechainRotamers", {}).get(
                "designerFixedLigandPose", {}).get("lockId") != lock_id \
            or application.get("result", {}).get("sidechainRotamer", {}).get(
                "designerFixedLigandPose", {}).get("lockId") != lock_id:
        raise RuntimeError("Designer ligand lock does not remain continuous through receptor prediction")

    selection = manifest.get("phe890Selection", {})
    candidate_descriptors = selection.get("candidateFiles")
    generated = selection.get("generatedCandidateCount")
    if not isinstance(candidate_descriptors, list) or not candidate_descriptors \
            or generated != selection.get("evaluatedCandidateCount") \
            or generated != len(candidate_descriptors) \
            or selection.get("everyGeneratedCandidateEvaluated") is not True \
            or len(calculations) != generated:
        raise RuntimeError("Phe890 enumeration/evaluation is incomplete")
    if manifest.get("evidence", {}).get("phe890Candidates") != candidate_descriptors:
        raise RuntimeError("Candidate files are not bound through manifest evidence")
    inspection_candidates = evidence.get("phe890CandidateFiles")
    if not isinstance(inspection_candidates, list) \
            or [item.get("file") for item in inspection_candidates] != candidate_descriptors:
        raise RuntimeError("Coordinate evidence does not bind every candidate file")
    enumerated_candidates = enumeration.get("result", {}).get(
        "sidechainRotamers", {}).get("candidates", [])
    enumerated_hashes = [candidate.get("coordinateSha256")
                         for candidate in enumerated_candidates]
    if len(enumerated_hashes) != generated or len(set(enumerated_hashes)) != generated:
        raise RuntimeError("Phe890 enumeration is incomplete or duplicated")
    saved_candidates = []
    for index, descriptor in enumerate(candidate_descriptors, 1):
        data = verify_file(run_dir / descriptor.get("filename", ""), descriptor,
                           f"Phe890 candidate {index}")
        candidate = json.loads(data)
        calculation = candidate.get("energy", {}).get("result", {})
        if candidate.get("ordinal") != index \
                or inspection_candidates[index - 1].get("ordinal") != index \
                or inspection_candidates[index - 1].get("coordinateSha256") \
                != candidate.get("coordinateSha256") \
                or candidate.get("coordinateSha256") not in enumerated_hashes \
                or candidate.get("coordinatesSaved") is not True \
                or not candidate.get("ligand", {}).get("atoms") \
                or not candidate.get("pocket", {}).get("atoms") \
                or candidate.get("energy", {}).get("job") != "energy" \
                or candidate.get("energy", {}).get("method") != "openmm" \
                or candidate.get("energy", {}).get("options") != ENERGY_OPTIONS \
                or candidate.get("energy", {}).get("assertedZeroCoordinateMotion") is not True \
                or calculation.get("movedHeavyAtomCount") != 0 \
                or calculation.get("maximumDisplacementAngstrom") != 0:
            raise RuntimeError("Saved Phe890 candidate evidence is incomplete or inconsistent")
        saved_candidates.append(candidate)
    if {candidate["coordinateSha256"] for candidate in saved_candidates} \
            != set(enumerated_hashes):
        raise RuntimeError("Saved Phe890 candidates do not cover the full enumeration")
    eligible = [candidate for candidate in saved_candidates
                if candidate.get("severeClashes") == 0
                and isinstance(candidate.get("fullSystemEnergy"), (int, float))
                and math.isfinite(candidate["fullSystemEnergy"])]
    if not eligible:
        raise RuntimeError("No finite clash-free Phe890 energy candidate was saved")
    selected = min(eligible, key=lambda candidate: (
        candidate["fullSystemEnergy"], json.dumps(candidate.get("chiDegrees")),
        candidate["coordinateSha256"]))
    if selection.get("selectedCoordinateSha256") != selected["coordinateSha256"] \
            or selection.get("selectedFullSystemEnergy") != selected["fullSystemEnergy"] \
            or application.get("result", {}).get("sidechainRotamer", {}).get(
                "selectedCoordinateSha256") != selected["coordinateSha256"]:
        raise RuntimeError("Frozen Phe890 response is not the energy-selected candidate")
    calculation_summary = [{
        "requestId": record.get("requestId"),
        "job": record.get("args", {}).get("job"),
        "method": record.get("args", {}).get("method"),
        "options": record.get("args", {}).get("options"),
        "movedHeavyAtomCount": record.get("result", {}).get(
            "calculation", {}).get("movedHeavyAtomCount"),
        "maximumDisplacementAngstrom": record.get("result", {}).get(
            "calculation", {}).get("maximumDisplacementAngstrom"),
        "assertedZeroCoordinateMotion": True,
    } for record in calculations]
    if current.get("energyCalculations") != calculation_summary:
        raise RuntimeError("Manifest energy-calculation evidence does not match the action audit")

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
        "boundaryBytes": boundary_bytes, "boundary": boundary,
        "evidenceBytes": evidence_bytes, "evidence": evidence,
        "auditBytes": audit_bytes, "campaignBytes": campaign_bytes,
        "sourceBytes": source_bytes, "checkpoint": checkpoint,
        "candidateEvidence": saved_candidates,
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
    if integrity.get("valid") is not True:
        failed.append("ligandIntegrity")
    if not phe_accepted:
        failed.append("phe890")
    if not designer_accepted:
        failed.append("designerInteraction")
    report = {
        "schema": VALIDATION_SCHEMA,
        "predictionManifestSha256": sha256(frozen["manifestBytes"]),
        "accepted": not failed,
        "designerIntentReferenceInformed": frozen["boundary"].get("laterStructureAccess") is True,
        "externalReferenceCoordinatesUsed": False,
        "predictionFrozenBeforeValidationAccess": frozen["boundary"].get("laterStructureAccess") is not True,
        "predictionFrozenBeforeNumericalComparison": True,
        "measurementOnly": True,
        "holdoutCoordinatesIncluded": False,
        "failedChecks": failed,
        "checks": {
            "ligandIntegrity": {"accepted": integrity.get("valid") is True, **integrity},
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
            "holdoutRole": "post-freeze-structural-comparison; designer brief was reference-informed"
            if frozen["boundary"].get("laterStructureAccess") else "post-freeze-evaluation-only",
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
    from rdkit import Chem

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
