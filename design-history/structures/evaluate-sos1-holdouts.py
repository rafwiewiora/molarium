#!/usr/bin/env python3
"""Evaluate frozen SOS1 predictions against 5OVF--5OVI.

The script verifies every freeze hash and the Chemist Actions audit before it
resolves or reads a later coordinate file.  Ligand RMSD is receptor-aligned
and symmetry-aware, but never ligand-fitted.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from rdkit import Chem
from rdkit.Chem import AllChem


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DEFAULT_PROTOCOL_PATH = (
    HERE / "generated/sos1-holdout-evaluation-protocol.json")

EXPECTED_HOLDOUTS = [
    {"stepId": "scaffold-rewrite", "pdbId": "5OVF", "filename": "5OVF.pdb",
     "ligandComponentId": "AWT", "ligandChain": "A", "ligandResidueNumber": 1101},
    {"stepId": "fragment-merge", "pdbId": "5OVG", "filename": "5OVG.pdb",
     "ligandComponentId": "AWZ", "ligandChain": "A", "ligandResidueNumber": 1101},
    {"stepId": "open-phe890-pocket", "pdbId": "5OVH", "filename": "5OVH.pdb",
     "ligandComponentId": "AWW", "ligandChain": "A", "ligandResidueNumber": 1101},
    {"stepId": "finish-bay-293", "pdbId": "5OVI", "filename": "5OVI.pdb",
     "ligandComponentId": "AXH", "ligandChain": "A", "ligandResidueNumber": 2001},
]

EXPECTED_ALIGNMENT_ANCHORS = [
    {"chain": "A", "residueNumber": 874, "insertionCode": "",
     "residueName": "VAL", "atomName": "CA"},
    {"chain": "A", "residueNumber": 876, "insertionCode": "",
     "residueName": "SER", "atomName": "CA"},
    {"chain": "A", "residueNumber": 880, "insertionCode": "",
     "residueName": "SER", "atomName": "CA"},
    {"chain": "A", "residueNumber": 885, "insertionCode": "",
     "residueName": "ARG", "atomName": "CA"},
    {"chain": "A", "residueNumber": 893, "insertionCode": "",
     "residueName": "ILE", "atomName": "CA"},
    {"chain": "A", "residueNumber": 899, "insertionCode": "",
     "residueName": "LYS", "atomName": "CA"},
    {"chain": "A", "residueNumber": 904, "insertionCode": "",
     "residueName": "ALA", "atomName": "CA"},
    {"chain": "A", "residueNumber": 906, "insertionCode": "",
     "residueName": "GLU", "atomName": "CA"},
]


# These are prospective evaluation criteria, not fitting parameters.  Every
# comparison is made in the receptor frame and every limit is emitted with the
# result so a pass cannot be inferred from an undocumented convention.
THRESHOLDS = {
    "receptorAlignmentRmsdAngstrom": 1.25,
    "ligandRmsdAngstrom": 2.00,
    "ligandCentroidDisplacementAngstrom": 1.50,
    "ligandPrincipalPlaneAngleDegrees": 35.0,
    "ligandRadialProfileRmsdAngstrom": 1.00,
    "hardRegionRmsdAngstrom": 1.25,
    "hardRegionMaximumDisplacementAngstrom": 2.25,
    "releasedRegionRmsdAngstrom": 2.50,
    "distalFeatureRmsdAngstrom": 2.00,
    "distalFeatureCentroidDisplacementAngstrom": 2.00,
    "distalFeaturePlaneAngleDegrees": 30.0,
    "distalFeatureRadialDistanceDeltaAngstrom": 1.00,
    "phe890Chi1DifferenceDegrees": 25.0,
    "phe890Chi2DifferenceDegrees": 35.0,
    "phe890SidechainRmsdAngstrom": 1.50,
    "phe890SidechainMaximumDisplacementAngstrom": 2.50,
    "minimumBondLengthToCovalentRadiiRatio": 0.65,
    "maximumBondLengthToCovalentRadiiRatio": 1.45,
    "maximumLigandInternalSevereClashes": 0,
    "maximumProteinLigandSevereClashes": 0,
}

CONTINUITY_THRESHOLDS = {
    "hardRegionSameReceptorFrameRmsdAngstrom": 0.60,
    "hardRegionSameReceptorFrameMaximumDisplacementAngstrom": 1.00,
    "hardRegionSameReceptorFrameCentroidDisplacementAngstrom": 0.50,
    "hardRegionRigidBodyOrientationChangeDegrees": 15.0,
    "releasedRegionAfterHardCoreRigidSuperpositionRmsdAngstrom": 2.50,
    "distalFeatureAfterHardCoreRigidSuperpositionRmsdAngstrom": 1.50,
    "distalFeatureAfterHardCoreRigidSuperpositionCentroidDisplacementAngstrom": 1.50,
    "distalFeatureAfterHardCoreRigidSuperpositionPlaneAngleDegrees": 30.0,
    "distalFeatureAfterHardCoreRigidSuperpositionRadialDistanceDeltaAngstrom": 1.00,
}

PHE890_SIDECHAIN_ATOMS = ["CB", "CG", "CD1", "CD2", "CE1", "CE2", "CZ"]
SEVERE_CLASH_RADIUS_FRACTION = 0.62


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> tuple[bytes, dict]:
    data = path.read_bytes()
    return data, json.loads(data)


def verify_evaluation_protocol(path: Path) -> tuple[bytes, dict]:
    """Verify the protocol registration without resolving any holdout file."""
    protocol_bytes, protocol = read_json(path)
    if protocol.get("schema") != "molarium.sos1-holdout-evaluation-protocol/v1":
        raise RuntimeError("Unexpected SOS1 holdout evaluation protocol schema")
    if protocol.get("routeId") != "sos1-hit-only" \
            or protocol.get("registeredBeforeHoldoutAccess") is not True:
        raise RuntimeError("SOS1 evaluation protocol is not registered pre-holdout")
    if protocol.get("holdoutCoordinateHashBinding") != "post-open-evaluation-report-only":
        raise RuntimeError("Holdout coordinate hashes must be bound only after opening")

    evaluator = protocol.get("evaluator", {})
    evaluator_path = (ROOT / evaluator.get("path", "")).resolve()
    if evaluator_path != Path(__file__).resolve():
        raise RuntimeError("Evaluation protocol names a different evaluator source")
    if digest(evaluator_path.read_bytes()) != evaluator.get("sha256"):
        raise RuntimeError("Evaluation protocol evaluator source hash changed")
    if protocol.get("thresholds") != THRESHOLDS \
            or protocol.get("continuityThresholds") != CONTINUITY_THRESHOLDS:
        raise RuntimeError("Evaluation protocol thresholds changed")

    route = protocol.get("registeredRoute", {})
    route_path = (ROOT / route.get("path", "")).resolve()
    expected_route_path = (
        HERE / "generated/sos1-prospective-campaign.json").resolve()
    if route_path != expected_route_path:
        raise RuntimeError("Evaluation protocol names a different registered route")
    route_bytes, route_record = read_json(route_path)
    if digest(route_bytes) != route.get("sha256") \
            or route_record.get("schema") != route.get("schema") \
            or route_record.get("id") != "sos1-hit-only":
        raise RuntimeError("Registered SOS1 route identity or hash changed")

    if protocol.get("holdouts") != EXPECTED_HOLDOUTS:
        raise RuntimeError("Evaluation protocol holdout identities changed")
    prediction_inputs = protocol.get("predictionInputs", {})
    if prediction_inputs.get("runManifestSchema") != "molarium.design-prediction-run/v1" \
            or prediction_inputs.get("checkpointSchema") \
            != "molarium.design-prediction-checkpoint/v1" \
            or prediction_inputs.get("requiredStepIds") \
            != [entry["stepId"] for entry in EXPECTED_HOLDOUTS] \
            or prediction_inputs.get("requireCompleteCoordinateInspections") is not True:
        raise RuntimeError("Evaluation protocol prediction input rules changed")
    alignment = protocol.get("receptorAlignment", {})
    if alignment.get("anchors") != EXPECTED_ALIGNMENT_ANCHORS:
        raise RuntimeError("Evaluation protocol receptor anchors changed")
    if alignment.get("excludedDesignedResidues") != [
            {"chain": "A", "residueNumber": 890, "residueName": "PHE"}]:
        raise RuntimeError("Evaluation protocol does not exclude designed Phe890")
    if alignment.get("minimumAnchorCount") != len(EXPECTED_ALIGNMENT_ANCHORS):
        raise RuntimeError("Evaluation protocol anchor count changed")
    if alignment.get("fitAcceptanceThresholdAngstrom") \
            != THRESHOLDS["receptorAlignmentRmsdAngstrom"]:
        raise RuntimeError("Evaluation protocol receptor fit threshold changed")
    return protocol_bytes, protocol


def coordinate_inspections(value: object, path: str = "checkpoint") -> list[tuple[str, dict]]:
    """Collect persisted session inspections that contain Cartesian coordinates."""
    found: list[tuple[str, dict]] = []
    if isinstance(value, dict):
        atoms = value.get("atoms")
        if isinstance(atoms, list) and (
                "truncated" in value or "totalAtomCount" in value
                or any("coordinatesAngstrom" in atom for atom in atoms
                       if isinstance(atom, dict))):
            found.append((path, value))
        for key, child in value.items():
            found.extend(coordinate_inspections(child, f"{path}.{key}"))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(coordinate_inspections(child, f"{path}[{index}]"))
    return found


def verify_complete_coordinate_inspections(checkpoint: dict, step_id: str) -> None:
    """Reject capped coordinate evidence before it reaches any evaluator metric."""
    for required in ["ligand", "pocket"]:
        inspection = checkpoint.get(required)
        if not isinstance(inspection, dict) or not inspection.get("atoms"):
            raise RuntimeError(f"{step_id}: frozen {required} inspection is absent")
        if inspection.get("truncated") is not False:
            raise RuntimeError(f"{step_id}: frozen {required} inspection is truncated")
    inspections = coordinate_inspections(checkpoint)
    if len(inspections) < 2:
        raise RuntimeError(f"{step_id}: frozen coordinate evidence is incomplete")
    for location, inspection in inspections:
        if inspection.get("truncated") is not False:
            raise RuntimeError(f"{step_id}: coordinate inspection {location} is truncated")
        total = inspection.get("totalAtomCount")
        if not isinstance(total, int) or total != len(inspection["atoms"]):
            raise RuntimeError(
                f"{step_id}: coordinate inspection {location} has incomplete atom coverage")
        for atom in inspection["atoms"]:
            point = atom.get("coordinatesAngstrom")
            if not isinstance(point, list) or len(point) != 3 \
                    or not all(isinstance(value, (int, float)) and math.isfinite(value)
                               for value in point):
                raise RuntimeError(
                    f"{step_id}: coordinate inspection {location} has invalid coordinates")


def verify_publication_eligibility(manifest: dict, checkpoints: dict[str, dict]) -> None:
    """Reject diagnostic/proxy runs before any holdout coordinate file is opened."""
    if manifest.get("publicationEligible") is not True:
        raise RuntimeError("Prediction run is explicitly non-promotable")
    branching = manifest.get("protocol", {}).get("phe890Branching", {})
    if branching.get("diagnosticOnly") is not False \
            or branching.get("diagnosticExactCoordinateSha256") is not None:
        raise RuntimeError("Prediction run uses a diagnostic Phe890 selector")
    decision = checkpoints.get("open-phe890-pocket", {}).get("rotamerDecision", {})
    if decision.get("publicationEligible") is not True \
            or decision.get("diagnosticOnly") is not False \
            or decision.get("deterministicFinalReplayVerified") is not True:
        raise RuntimeError("Phe890 decision is diagnostic or lacks deterministic replay")


def verify_accepted_checkpoint_relaxation(checkpoint: dict, step_id: str) -> None:
    relaxation = checkpoint.get("relaxation", {})
    if relaxation.get("accepted") is not True:
        raise RuntimeError(f"{step_id}: required checkpoint relaxation was not accepted")
    if step_id == "finish-bay-293":
        continuity = checkpoint.get("sidechainContinuity", {})
        if continuity.get("residue") != "PHE A890" \
                or continuity.get("accepted") is not True \
                or not continuity.get("finalChiDegrees") \
                or not all(isinstance(value, (int, float)) and math.isfinite(value)
                           for value in continuity["finalChiDegrees"]):
            raise RuntimeError(
                f"{step_id}: final Phe890 state was not retained and remeasured")
    required = [feature for feature in checkpoint.get("staging", {})
                .get("poseTransferPlan", {}).get("featureCorrespondences", [])
                if feature.get("required") is True]
    if not required:
        return
    retention = relaxation.get("registeredPoseRetention", {})
    after = retention.get("after", {})
    if retention.get("accepted") is not True or after.get("accepted") is not True \
            or after.get("active") is not True:
        raise RuntimeError(f"{step_id}: registered pose retention was not accepted")
    hard = after.get("hardAnchor", {})
    if not all(isinstance(hard.get(key), (int, float)) and math.isfinite(hard[key])
               and hard[key] <= 1e-6
               for key in ("rmsdAngstrom", "maxDisplacementAngstrom")):
        raise RuntimeError(f"{step_id}: hard anchor moved during coupled relaxation")
    measured = after.get("features", [])
    if len(measured) != len(required):
        raise RuntimeError(
            f"{step_id}: post-relax registered feature count is not exact")
    for required_feature in required:
        matches = [feature for feature in measured
                   if feature.get("id") == required_feature.get("id")
                   and feature.get("registeredIntentId")
                   == required_feature.get("registeredIntentId")]
        if len(matches) != 1:
            raise RuntimeError(
                f"{step_id}: required post-relax feature is missing or ambiguous")
        feature = matches[0]
        for key in ("rmsdAngstrom", "centroidDisplacementAngstrom",
                    "planeNormalAngleDegrees"):
            if not isinstance(feature.get(key), (int, float)) \
                    or not math.isfinite(feature[key]):
                raise RuntimeError(f"{step_id}: post-relax feature lacks {key}")
        tolerance = required_feature.get("restraint", {}).get("toleranceAngstrom")
        if feature.get("toleranceAngstrom") != tolerance \
                or feature["rmsdAngstrom"] > tolerance:
            raise RuntimeError(
                f"{step_id}: post-relax feature moved outside registered tolerance")


def verify_run(run_dir: Path, protocol: dict) \
        -> tuple[bytes, dict, dict[str, dict], list[dict], dict]:
    manifest_bytes, manifest = read_json(run_dir / "prediction-manifest.json")
    if manifest.get("schema") != protocol["predictionInputs"]["runManifestSchema"]:
        raise RuntimeError("Unexpected SOS1 prediction run manifest schema")
    if manifest.get("routeId") != "sos1-hit-only":
        raise RuntimeError("Not a SOS1 hit-only prediction run")
    if manifest.get("status") != "predictions-frozen-holdouts-unopened":
        raise RuntimeError("Predictions were not frozen before evaluation")
    if manifest.get("protocol", {}).get("initialCoordinateInput") != "PDB 5OVE/AXE only":
        raise RuntimeError("The run did not start from 5OVE/AXE only")
    expected_steps = [entry["stepId"] for entry in protocol["holdouts"]]
    if [entry["stepId"] for entry in manifest.get("checkpoints", [])] != expected_steps:
        raise RuntimeError("The complete four-step SOS1 sequence is not frozen")
    checkpoints = {}
    for frozen in manifest["checkpoints"]:
        data, checkpoint = read_json(run_dir / frozen["filename"])
        if digest(data) != frozen["sha256"]:
            raise RuntimeError(f"{frozen['stepId']}: frozen checkpoint hash changed")
        if not checkpoint.get("frozenBeforeHoldoutAccess"):
            raise RuntimeError(f"{frozen['stepId']}: freeze boundary is absent")
        verify_accepted_checkpoint_relaxation(checkpoint, frozen["stepId"])
        if checkpoint.get("schema") != protocol["predictionInputs"]["checkpointSchema"] \
                or checkpoint.get("routeId", checkpoint.get("campaignId")) != "sos1-hit-only" \
                or checkpoint.get("stepId") != frozen["stepId"] \
                or checkpoint.get("predictedStateId") != frozen["predictedStateId"]:
            raise RuntimeError(f"{frozen['stepId']}: checkpoint identity changed")
        verify_complete_coordinate_inspections(checkpoint, frozen["stepId"])
        checkpoints[frozen["stepId"]] = checkpoint
    verify_publication_eligibility(manifest, checkpoints)
    audit_bytes, audit_wrapper = read_json(run_dir / "chemist-action-audit.json")
    if digest(audit_bytes) != manifest["agentApi"]["auditSha256"]:
        raise RuntimeError("Chemist Actions audit hash changed")
    audit = audit_wrapper["records"]
    if len(audit) != manifest["agentApi"]["auditRecords"]:
        raise RuntimeError("Chemist Actions audit length changed")
    required = {"designRoute.load", "designRoute.applyStep", "pose.refine",
                "pose.apply", "pose.enumerateSidechainRotamers",
                "pose.applySidechainRotamer", "optimization.run", "session.inspect"}
    completed = {entry["action"] for entry in audit if entry.get("status") == "completed"}
    if not required <= completed:
        raise RuntimeError(f"Missing completed actions: {sorted(required - completed)}")
    rotamer = checkpoints["open-phe890-pocket"].get("rotamerDecision")
    if not rotamer or rotamer.get("coordinateInputClass") != "registered-hit-only":
        raise RuntimeError("Compound 21 lacks a registered hit-only Phe890 decision")
    campaign_path = ROOT / manifest["inputs"]["campaign"]["path"]
    campaign_bytes, campaign = read_json(campaign_path)
    if digest(campaign_bytes) != manifest["inputs"]["campaign"]["sha256"]:
        raise RuntimeError("Pre-freeze campaign hash changed")
    registered_route = protocol["registeredRoute"]
    if digest(campaign_bytes) != registered_route["sha256"] \
            or campaign.get("schema") != registered_route["schema"]:
        raise RuntimeError("Prediction manifest and evaluation protocol route differ")
    for previous, following in zip(expected_steps, expected_steps[1:]):
        freeze_sequence = next(entry["freezeActionSequence"] for entry in manifest["checkpoints"]
                               if entry["stepId"] == previous)
        recapture = next((entry for entry in audit
                          if entry.get("requestId") == f"{previous}-capture-predicted-reference"), None)
        staged = next((entry for entry in audit
                       if entry.get("requestId") == f"{following}-stage"), None)
        if not recapture or not staged or not (freeze_sequence < recapture["sequence"] < staged["sequence"]):
            raise RuntimeError(f"{following}: preceding frozen prediction was not recaptured")
    return manifest_bytes, manifest, checkpoints, audit, campaign


def pdb_rows(text: str) -> list[dict]:
    rows = []
    model = 1
    for line in text.splitlines():
        if line.startswith("MODEL "):
            model = int(line[10:14].strip() or model)
            continue
        if model != 1 or not (line.startswith("ATOM  ") or line.startswith("HETATM")):
            continue
        alt = line[16:17].strip()
        if alt and alt != "A":
            continue
        rows.append({
            "record": line[:6].strip(), "atomName": line[12:16].strip(),
            "residueName": line[17:20].strip(), "chain": line[21:22].strip(),
            "residueNumber": int(line[22:26]), "insertionCode": line[26:27].strip(),
            "point": np.array([float(line[30:38]), float(line[38:46]),
                               float(line[46:54])], dtype=float),
        })
    return rows


def pdb_identifier(text: str) -> str | None:
    header = next((line for line in text.splitlines() if line.startswith("HEADER")), None)
    if header is None:
        return None
    fixed = header[62:66].strip().upper()
    if len(fixed) == 4 and fixed[0].isdigit():
        return fixed
    words = header.split()
    trailing = words[-1].upper() if words else ""
    return trailing if len(trailing) == 4 and trailing[0].isdigit() else None


def kabsch(reference: np.ndarray, mobile: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    reference_center = reference.mean(axis=0)
    mobile_center = mobile.mean(axis=0)
    covariance = (mobile - mobile_center).T @ (reference - reference_center)
    left, _, right = np.linalg.svd(covariance)
    rotation = left @ right
    if np.linalg.det(rotation) < 0:
        left[:, -1] *= -1
        rotation = left @ right
    translation = reference_center - mobile_center @ rotation
    aligned = mobile @ rotation + translation
    rmsd = float(np.sqrt(np.mean(np.sum((reference - aligned) ** 2, axis=1))))
    return rotation, translation, rmsd


def rotation_angle_degrees(rotation: np.ndarray) -> float:
    """Return the proper-rotation angle represented by a 3x3 rotation matrix."""
    cosine = float((np.trace(rotation) - 1.0) / 2.0)
    return float(math.degrees(math.acos(min(1.0, max(-1.0, cosine)))))


def receptor_alignment(reference_rows: list[dict], mobile_rows: list[dict],
                       protocol: dict) -> dict:
    """Align on the pre-registered, Phe890-excluding receptor anchors only."""
    def key(row: dict) -> tuple[str, int, str, str, str]:
        return (row["chain"], row["residueNumber"], row["insertionCode"],
                row["residueName"], row["atomName"])

    reference = {key(row): row["point"] for row in reference_rows
                 if row["record"] == "ATOM"}
    mobile = {key(row): row["point"] for row in mobile_rows
              if row["record"] == "ATOM"}
    anchor_records = protocol["receptorAlignment"]["anchors"]
    keys = [(entry["chain"], entry["residueNumber"], entry["insertionCode"],
             entry["residueName"], entry["atomName"])
            for entry in anchor_records]
    missing_reference = [entry for entry, anchor in zip(anchor_records, keys)
                         if anchor not in reference]
    missing_mobile = [entry for entry, anchor in zip(anchor_records, keys)
                      if anchor not in mobile]
    if missing_reference or missing_mobile \
            or len(keys) < protocol["receptorAlignment"]["minimumAnchorCount"]:
        raise RuntimeError(
            "Registered SOS1 receptor alignment anchors are incomplete: "
            f"prediction={missing_reference}, holdout={missing_mobile}")
    rotation, translation, rmsd = kabsch(
        np.array([reference[key] for key in keys]),
        np.array([mobile[key] for key in keys]))
    return {"rotation": rotation, "translation": translation,
            "atoms": len(keys), "rmsdAngstrom": rmsd,
            "anchorRecords": anchor_records,
            "excludedDesignedResidues":
                protocol["receptorAlignment"]["excludedDesignedResidues"]}


def transform_points(points: np.ndarray, alignment: dict) -> np.ndarray:
    return points @ alignment["rotation"] + alignment["translation"]


def ligand_fragment(pdb_text: str, residue_name: str, residue_number: int,
                    chain: str = "A") -> tuple[Chem.Mol, list[str]]:
    full = Chem.MolFromPDBBlock(pdb_text, removeHs=True, sanitize=False)
    if full is None:
        raise RuntimeError("Unable to parse opened holdout PDB bytes")
    selected = []
    names = []
    for atom in full.GetAtoms():
        info = atom.GetPDBResidueInfo()
        if (info and info.GetResidueName().strip() == residue_name
                and info.GetChainId().strip() == chain
                and info.GetResidueNumber() == residue_number):
            selected.append(atom.GetIdx())
            names.append(info.GetName().strip())
    fragment = Chem.RWMol()
    old_to_new = {}
    conformer = Chem.Conformer(len(selected))
    source_conformer = full.GetConformer()
    for new_index, old_index in enumerate(selected):
        atom = full.GetAtomWithIdx(old_index)
        old_to_new[old_index] = fragment.AddAtom(Chem.Atom(atom.GetAtomicNum()))
        point = source_conformer.GetAtomPosition(old_index)
        conformer.SetAtomPosition(new_index, point)
    for bond in full.GetBonds():
        first, second = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
        if first in old_to_new and second in old_to_new:
            fragment.AddBond(old_to_new[first], old_to_new[second], Chem.BondType.SINGLE)
    molecule = fragment.GetMol()
    molecule.AddConformer(conformer)
    return molecule, names


def bond_chemistry_signature(molecule: Chem.Mol, mapping: list[int] | None = None) \
        -> list[tuple[int, int, float, bool]]:
    mapping = mapping or list(range(molecule.GetNumAtoms()))
    signature = []
    for bond in molecule.GetBonds():
        first = mapping[bond.GetBeginAtomIdx()]
        second = mapping[bond.GetEndAtomIdx()]
        signature.append((min(first, second), max(first, second),
                          float(bond.GetBondTypeAsDouble()), bond.GetIsAromatic()))
    return sorted(signature)


def exact_registered_graph_mappings(template: Chem.Mol, coordinate_fragment: Chem.Mol) \
        -> tuple[Chem.Mol, list[list[int]], dict]:
    """Return only exact registered-chemistry graph isomorphisms.

    PDB coordinates do not authoritatively encode small-molecule bond order.
    Therefore elemental connectivity must first be exactly isomorphic, after
    which bond orders, formal charges, and aromaticity are assigned from the
    pre-registered product graph.  The resulting graph is then checked with
    exact edges, bond orders, and aromatic flags.  No partial MCS is accepted.
    """
    if template.GetNumAtoms() != coordinate_fragment.GetNumAtoms() \
            or template.GetNumBonds() != coordinate_fragment.GetNumBonds():
        raise RuntimeError(
            "Holdout ligand atom or edge count does not match the registered product graph")
    try:
        registered_fragment = AllChem.AssignBondOrdersFromTemplate(
            template, coordinate_fragment)
    except (ValueError, RuntimeError) as error:
        raise RuntimeError(
            "Holdout ligand elemental connectivity is not exactly isomorphic "
            "to the registered product graph") from error
    matches = registered_fragment.GetSubstructMatches(
        template, uniquify=False, useChirality=False, maxMatches=4096)
    expected_signature = bond_chemistry_signature(template)
    mappings = []
    for mapping in matches:
        if len(mapping) != template.GetNumAtoms():
            continue
        atom_chemistry_matches = all(
            template.GetAtomWithIdx(template_index).GetAtomicNum()
            == registered_fragment.GetAtomWithIdx(fragment_index).GetAtomicNum()
            and template.GetAtomWithIdx(template_index).GetFormalCharge()
            == registered_fragment.GetAtomWithIdx(fragment_index).GetFormalCharge()
            and template.GetAtomWithIdx(template_index).GetIsAromatic()
            == registered_fragment.GetAtomWithIdx(fragment_index).GetIsAromatic()
            for template_index, fragment_index in enumerate(mapping))
        inverse = [None] * len(mapping)
        for template_index, fragment_index in enumerate(mapping):
            inverse[fragment_index] = template_index
        chemistry_matches = (
            atom_chemistry_matches
            and bond_chemistry_signature(registered_fragment, inverse)
            == expected_signature)
        if chemistry_matches:
            mappings.append(tuple(mapping))
    mappings = sorted(set(mappings))
    if not mappings:
        raise RuntimeError(
            "Holdout ligand lacks an exact edge/bond-order/aromaticity mapping "
            "to the registered product graph")
    validation = {
        "method": "exact registered graph isomorphism",
        "coordinateConnectivity": "PDB elemental edges; no partial MCS",
        "bondOrderAndAromaticitySource": "hash-pinned registered route productSmiles",
        "atomCount": template.GetNumAtoms(),
        "edgeCount": template.GetNumBonds(),
        "exactBondOrderAndAromaticity": True,
    }
    return registered_fragment, [list(mapping) for mapping in mappings], validation


def rmsd(first: np.ndarray, second: np.ndarray, indices: list[int] | None = None) -> float:
    if indices is not None:
        first, second = first[indices], second[indices]
    return float(np.sqrt(np.mean(np.sum((first - second) ** 2, axis=1))))


def dihedral(first: np.ndarray, second: np.ndarray,
             third: np.ndarray, fourth: np.ndarray) -> float:
    b0 = -(second - first)
    b1 = third - second
    b2 = fourth - third
    b1 /= np.linalg.norm(b1)
    v = b0 - np.dot(b0, b1) * b1
    w = b2 - np.dot(b2, b1) * b1
    return float(math.degrees(math.atan2(np.dot(np.cross(b1, v), w), np.dot(v, w))))


def phe_chi(rows: list[dict], transformed: bool = False,
            alignment: dict | None = None) -> list[float]:
    atoms = {row["atomName"]: row["point"] for row in rows
             if row["record"] == "ATOM" and row["chain"] == "A"
             and row["residueName"] == "PHE" and row["residueNumber"] == 890}
    needed = ["N", "CA", "CB", "CG", "CD1"]
    if not all(name in atoms for name in needed):
        raise RuntimeError("Phe890 chi atoms are incomplete")
    if transformed:
        points = transform_points(np.array([atoms[name] for name in needed]), alignment)
        atoms = dict(zip(needed, points))
    return [dihedral(atoms["N"], atoms["CA"], atoms["CB"], atoms["CG"]),
            dihedral(atoms["CA"], atoms["CB"], atoms["CG"], atoms["CD1"])]


def angular_difference(first: float, second: float, period: float = 360.0) -> float:
    """Smallest unsigned angular difference for a periodic coordinate."""
    return abs((first - second + period / 2.0) % period - period / 2.0)


def principal_plane(points: np.ndarray) -> tuple[np.ndarray, float] | None:
    if len(points) < 3:
        return None
    centered = points - points.mean(axis=0)
    _, singular_values, right = np.linalg.svd(centered, full_matrices=False)
    if len(singular_values) < 2 or singular_values[1] < 1e-8:
        return None
    normal = right[-1]
    residual = float(np.sqrt(np.mean((centered @ normal) ** 2)))
    return normal, residual


def plane_angle(first: np.ndarray, second: np.ndarray) -> float | None:
    first_plane, second_plane = principal_plane(first), principal_plane(second)
    if first_plane is None or second_plane is None:
        return None
    cosine = min(1.0, max(0.0, abs(float(np.dot(first_plane[0], second_plane[0])))))
    return float(math.degrees(math.acos(cosine)))


def radial_profile_rmsd(first: np.ndarray, second: np.ndarray) -> float:
    first_radii = np.linalg.norm(first - first.mean(axis=0), axis=1)
    second_radii = np.linalg.norm(second - second.mean(axis=0), axis=1)
    return float(np.sqrt(np.mean((first_radii - second_radii) ** 2)))


def geometry_metrics(first: np.ndarray, second: np.ndarray,
                     hard_first: np.ndarray | None = None,
                     hard_second: np.ndarray | None = None) -> dict:
    first_centroid, second_centroid = first.mean(axis=0), second.mean(axis=0)
    result = {
        "atomCount": len(first),
        "rmsdAngstrom": rmsd(first, second),
        "maximumDisplacementAngstrom": float(
            np.max(np.linalg.norm(first - second, axis=1))),
        "centroidDisplacementAngstrom": float(np.linalg.norm(
            first_centroid - second_centroid)),
        "principalPlaneAngleDegrees": plane_angle(first, second),
        "radialProfileRmsdAngstrom": radial_profile_rmsd(first, second),
        "predictedRadiusOfGyrationAngstrom": float(np.sqrt(np.mean(np.sum(
            (first - first_centroid) ** 2, axis=1)))),
        "holdoutRadiusOfGyrationAngstrom": float(np.sqrt(np.mean(np.sum(
            (second - second_centroid) ** 2, axis=1)))),
    }
    result["radiusOfGyrationDeltaAngstrom"] = abs(
        result["predictedRadiusOfGyrationAngstrom"]
        - result["holdoutRadiusOfGyrationAngstrom"])
    if hard_first is not None and hard_second is not None:
        first_radius = float(np.linalg.norm(first_centroid - hard_first.mean(axis=0)))
        second_radius = float(np.linalg.norm(second_centroid - hard_second.mean(axis=0)))
        result.update({
            "predictedRadialDistanceFromHardCoreAngstrom": first_radius,
            "holdoutRadialDistanceFromHardCoreAngstrom": second_radius,
            "radialDistanceFromHardCoreDeltaAngstrom": abs(first_radius - second_radius),
        })
    return result


def transition_geometry_metrics(before: np.ndarray, after: np.ndarray,
                                hard_before: np.ndarray | None = None,
                                hard_after: np.ndarray | None = None) -> dict:
    """Name generic geometry fields for a before/after checkpoint transition."""
    result = geometry_metrics(before, after, hard_before, hard_after)
    result["fromStateRadiusOfGyrationAngstrom"] = result.pop(
        "predictedRadiusOfGyrationAngstrom")
    result["toStateRadiusOfGyrationAngstrom"] = result.pop(
        "holdoutRadiusOfGyrationAngstrom")
    if "predictedRadialDistanceFromHardCoreAngstrom" in result:
        result["fromStateRadialDistanceFromHardCoreAngstrom"] = result.pop(
            "predictedRadialDistanceFromHardCoreAngstrom")
        result["toStateRadialDistanceFromHardCoreAngstrom"] = result.pop(
            "holdoutRadialDistanceFromHardCoreAngstrom")
    return result


def route_regions(step: dict) -> dict[str, list[int]]:
    """Derive disjoint evaluation regions from the registered route metadata."""
    atom_count = len(step["productAtomNames"])
    pose_map = step["posePropagationMap"]
    common = pose_map.get("commonAtoms", [])
    released = pose_map.get("releasedMappedAtoms", [])
    released_indices = {entry["productAtomIndex"] for entry in released}
    released_names = {entry["referenceAtomName"] for entry in released}

    protected = pose_map.get("protectedReferenceAnchor")
    if protected:
        protected_names = set(protected["referenceAtomNames"])
        hard_indices = {entry["productAtomIndex"] for entry in common
                        if entry["referenceAtomName"] in protected_names}
        if len(hard_indices) != len(protected_names):
            raise RuntimeError(f"{step['id']}: protected route atoms do not map one-to-one")
    else:
        hard_indices = {entry["productAtomIndex"] for entry in common
                        if entry["referenceAtomName"] not in released_names}

    feature_indices: set[int] = set()
    for feature in pose_map.get("spatialFeatureCorrespondences", []):
        retained = (feature.get("treatment") == "seed-only"
                    or feature.get("transferMode") == "seed-only"
                    or (feature.get("treatment") == "soft-restraint"
                        and feature.get("required") is True
                        and feature.get("source") == "registered-designer-intent"
                        and feature.get("registeredIntentId")))
        if not retained:
            continue
        variants = feature.get("mappingVariants") or [feature]
        variant_sets = {tuple(sorted(variant["productAtomIndices"])) for variant in variants}
        if len(variant_sets) != 1:
            raise RuntimeError(f"{step['id']}: seed-only variants address different atoms")
        feature_indices.update(variant_sets.pop())

    regions = {
        "hard": sorted(hard_indices),
        "released": sorted(released_indices),
        "distalFeature": sorted(feature_indices),
    }
    occupied: set[int] = set()
    for label, indices in regions.items():
        if occupied.intersection(indices):
            raise RuntimeError(f"{step['id']}: {label} overlaps another evaluation region")
        occupied.update(indices)
    if any(index < 0 or index >= atom_count for index in occupied):
        raise RuntimeError(f"{step['id']}: evaluation region index is outside the product")
    regions["edited"] = sorted(set(range(atom_count)) - occupied)
    regions["mapped"] = sorted(hard_indices | released_indices)

    expected_hard = pose_map.get("hardCoordinateHeavyAtoms", len(hard_indices))
    expected_released = pose_map.get("releasedMappedHeavyAtoms", len(released_indices))
    if len(hard_indices) != expected_hard or len(released_indices) != expected_released:
        raise RuntimeError(f"{step['id']}: route region counts are internally inconsistent")
    return regions


def coordinates_by_name(checkpoint: dict) -> dict[str, np.ndarray]:
    result = {}
    for atom in checkpoint["ligand"]["atoms"]:
        if atom["element"] == "H":
            continue
        name = atom["atomName"]
        if name in result:
            raise RuntimeError(f"Duplicate predicted ligand atom name {name}")
        point = np.array(atom["coordinatesAngstrom"], dtype=float)
        if point.shape != (3,) or not np.all(np.isfinite(point)):
            raise RuntimeError(f"Non-finite predicted coordinate for {name}")
        result[name] = point
    return result


def phe890_metrics(predicted_rows: list[dict], holdout_rows: list[dict],
                   alignment: dict) -> dict:
    predicted_chi = phe_chi(predicted_rows)
    holdout_chi = phe_chi(holdout_rows, True, alignment)
    predicted_atoms = {row["atomName"]: row["point"] for row in predicted_rows
                       if row["record"] == "ATOM" and row["chain"] == "A"
                       and row["residueName"] == "PHE" and row["residueNumber"] == 890}
    raw_holdout_atoms = {row["atomName"]: row["point"] for row in holdout_rows
                         if row["record"] == "ATOM" and row["chain"] == "A"
                         and row["residueName"] == "PHE" and row["residueNumber"] == 890}
    if not all(name in predicted_atoms and name in raw_holdout_atoms
               for name in PHE890_SIDECHAIN_ATOMS):
        raise RuntimeError("Phe890 side-chain atoms are incomplete")
    aligned_holdout = transform_points(np.array([
        raw_holdout_atoms[name] for name in PHE890_SIDECHAIN_ATOMS]), alignment)
    predicted = np.array([predicted_atoms[name] for name in PHE890_SIDECHAIN_ATOMS])
    # Phenyl CD1/CD2 and CE1/CE2 labels can be exchanged without changing the
    # chemical state.  Score both graph-equivalent labelings.
    swapped_order = ["CB", "CG", "CD2", "CD1", "CE2", "CE1", "CZ"]
    aligned_swapped = transform_points(np.array([
        raw_holdout_atoms[name] for name in swapped_order]), alignment)
    candidates = [("deposited", aligned_holdout), ("phenyl-symmetry-swapped", aligned_swapped)]
    label_mapping, selected = min(candidates, key=lambda entry: rmsd(predicted, entry[1]))
    distances = np.linalg.norm(predicted - selected, axis=1)
    return {
        "predictedChiDegrees": predicted_chi,
        "holdoutChiDegrees": holdout_chi,
        "chi1DifferenceDegrees": angular_difference(predicted_chi[0], holdout_chi[0]),
        "chi2DifferenceDegrees": angular_difference(predicted_chi[1], holdout_chi[1], 180.0),
        "sidechainAtomNames": PHE890_SIDECHAIN_ATOMS,
        "sidechainLabelMapping": label_mapping,
        "sidechainRmsdAngstrom": rmsd(predicted, selected),
        "sidechainMaximumDisplacementAngstrom": float(np.max(distances)),
    }


def expected_heavy_topology(step: dict, molecule: Chem.Mol) -> set[tuple[str, str]]:
    names = step["productAtomNames"]
    return {tuple(sorted((names[bond.GetBeginAtomIdx()], names[bond.GetEndAtomIdx()])))
            for bond in molecule.GetBonds()}


def graph_distances(atom_count: int, edges: set[tuple[int, int]]) -> np.ndarray:
    distances = np.full((atom_count, atom_count), atom_count + 1, dtype=int)
    np.fill_diagonal(distances, 0)
    for first, second in edges:
        distances[first, second] = distances[second, first] = 1
    for middle in range(atom_count):
        distances = np.minimum(distances,
                               distances[:, middle, None] + distances[None, middle, :])
    return distances


def severe_clash_count(first_atoms: list[tuple[str, np.ndarray]],
                       second_atoms: list[tuple[str, np.ndarray]]) -> int:
    periodic = Chem.GetPeriodicTable()
    count = 0
    for first_element, first in first_atoms:
        first_radius = periodic.GetRvdw(first_element)
        for second_element, second in second_atoms:
            threshold = SEVERE_CLASH_RADIUS_FRACTION * (
                first_radius + periodic.GetRvdw(second_element))
            if float(np.linalg.norm(first - second)) < threshold:
                count += 1
    return count


def prediction_integrity(checkpoint: dict, step: dict, template: Chem.Mol) -> dict:
    expected_names = step["productAtomNames"]
    atoms = checkpoint["ligand"]["atoms"]
    heavy_atoms = [atom for atom in atoms if atom["element"] != "H"]
    heavy_by_name = {atom["atomName"]: atom for atom in heavy_atoms}
    names_unique = len(heavy_by_name) == len(heavy_atoms)
    names_match = names_unique and set(heavy_by_name) == set(expected_names)
    elements_match = names_match and all(
        heavy_by_name[name]["element"] == template.GetAtomWithIdx(index).GetSymbol()
        for index, name in enumerate(expected_names))
    finite = all(len(atom.get("coordinatesAngstrom", [])) == 3
                 and all(math.isfinite(value) for value in atom["coordinatesAngstrom"])
                 for atom in atoms)

    atom_id_to_name = {atom["atomId"]: atom["atomName"] for atom in heavy_atoms}
    observed_topology = {tuple(sorted((atom_id_to_name[first], atom_id_to_name[second])))
                         for bond in checkpoint["ligand"]["bonds"]
                         for first, second in [bond["atomIds"]]
                         if first in atom_id_to_name and second in atom_id_to_name}
    expected_topology = expected_heavy_topology(step, template)
    topology_matches = observed_topology == expected_topology

    periodic = Chem.GetPeriodicTable()
    ratios = []
    indexed_edges: set[tuple[int, int]] = set()
    index_by_name = {name: index for index, name in enumerate(expected_names)}
    if names_match:
        for first_name, second_name in expected_topology:
            first, second = heavy_by_name[first_name], heavy_by_name[second_name]
            length = float(np.linalg.norm(np.array(first["coordinatesAngstrom"])
                                          - np.array(second["coordinatesAngstrom"])))
            radii = (periodic.GetRcovalent(first["element"])
                     + periodic.GetRcovalent(second["element"]))
            ratios.append(length / radii)
            indexed_edges.add(tuple(sorted((index_by_name[first_name], index_by_name[second_name]))))
    minimum_ratio = min(ratios) if ratios else None
    maximum_ratio = max(ratios) if ratios else None

    internal_clashes = 0
    protein_ligand_clashes = 0
    if names_match:
        points = [np.array(heavy_by_name[name]["coordinatesAngstrom"], dtype=float)
                  for name in expected_names]
        distances = graph_distances(len(points), indexed_edges)
        periodic = Chem.GetPeriodicTable()
        for first in range(len(points)):
            for second in range(first + 1, len(points)):
                if distances[first, second] <= 2:
                    continue
                threshold = SEVERE_CLASH_RADIUS_FRACTION * (
                    periodic.GetRvdw(heavy_by_name[expected_names[first]]["element"])
                    + periodic.GetRvdw(heavy_by_name[expected_names[second]]["element"]))
                if float(np.linalg.norm(points[first] - points[second])) < threshold:
                    internal_clashes += 1
        ligand_atom_ids = {atom["atomId"] for atom in atoms}
        protein_atoms = [
            (atom["element"], np.array(atom["coordinatesAngstrom"], dtype=float))
            for atom in checkpoint["pocket"]["atoms"]
            if atom["element"] != "H" and atom["atomId"] not in ligand_atom_ids
            and atom["residueName"] != heavy_atoms[0]["residueName"]]
        ligand_points = [(heavy_by_name[name]["element"], points[index])
                         for index, name in enumerate(expected_names)]
        protein_ligand_clashes = severe_clash_count(ligand_points, protein_atoms)

    valid = (names_match and elements_match and finite and topology_matches
             and minimum_ratio is not None and maximum_ratio is not None
             and minimum_ratio >= THRESHOLDS["minimumBondLengthToCovalentRadiiRatio"]
             and maximum_ratio <= THRESHOLDS["maximumBondLengthToCovalentRadiiRatio"]
             and internal_clashes <= THRESHOLDS["maximumLigandInternalSevereClashes"]
             and protein_ligand_clashes <= THRESHOLDS["maximumProteinLigandSevereClashes"])
    return {
        "valid": valid,
        "heavyAtomCount": len(heavy_atoms),
        "heavyAtomNamesUnique": names_unique,
        "heavyAtomNamesMatchRegisteredProduct": names_match,
        "elementsMatchRegisteredProduct": elements_match,
        "allCoordinatesFinite": finite,
        "heavyAtomTopologyMatchesRegisteredProduct": topology_matches,
        "minimumBondLengthToCovalentRadiiRatio": minimum_ratio,
        "maximumBondLengthToCovalentRadiiRatio": maximum_ratio,
        "ligandInternalSevereClashes": internal_clashes,
        "proteinLigandSevereClashes": protein_ligand_clashes,
        "severeClashRadiusFraction": SEVERE_CLASH_RADIUS_FRACTION,
    }


def limit_check(identifier: str, observed: float, threshold: float,
                operator: str = "<=") -> dict:
    passed = observed <= threshold if operator == "<=" else observed >= threshold
    return {"id": identifier, "observed": observed, "operator": operator,
            "threshold": threshold, "passed": bool(passed)}


def boolean_check(identifier: str, observed: bool) -> dict:
    return {"id": identifier, "observed": bool(observed), "operator": "is",
            "threshold": True, "passed": bool(observed)}


def holdout_acceptance(receptor: dict, ligand: dict, regions: dict,
                       phe890: dict, integrity: dict) -> dict:
    checks = [
        limit_check("receptor-alignment", receptor["alignmentRmsdAngstrom"],
                    THRESHOLDS["receptorAlignmentRmsdAngstrom"]),
        limit_check("whole-ligand-rmsd", ligand["rmsdAngstrom"],
                    THRESHOLDS["ligandRmsdAngstrom"]),
        limit_check("whole-ligand-centroid", ligand["geometry"]["centroidDisplacementAngstrom"],
                    THRESHOLDS["ligandCentroidDisplacementAngstrom"]),
        limit_check("whole-ligand-radial-profile",
                    ligand["geometry"]["radialProfileRmsdAngstrom"],
                    THRESHOLDS["ligandRadialProfileRmsdAngstrom"]),
        limit_check("hard-region-rmsd", regions["hard"]["rmsdAngstrom"],
                    THRESHOLDS["hardRegionRmsdAngstrom"]),
        limit_check("hard-region-maximum-displacement",
                    regions["hard"]["maximumDisplacementAngstrom"],
                    THRESHOLDS["hardRegionMaximumDisplacementAngstrom"]),
        limit_check("phe890-chi1", phe890["chi1DifferenceDegrees"],
                    THRESHOLDS["phe890Chi1DifferenceDegrees"]),
        limit_check("phe890-chi2", phe890["chi2DifferenceDegrees"],
                    THRESHOLDS["phe890Chi2DifferenceDegrees"]),
        limit_check("phe890-sidechain-rmsd", phe890["sidechainRmsdAngstrom"],
                    THRESHOLDS["phe890SidechainRmsdAngstrom"]),
        limit_check("phe890-sidechain-maximum-displacement",
                    phe890["sidechainMaximumDisplacementAngstrom"],
                    THRESHOLDS["phe890SidechainMaximumDisplacementAngstrom"]),
        boolean_check("registered-chemistry-and-coordinate-integrity", integrity["valid"]),
    ]
    plane = ligand["geometry"]["principalPlaneAngleDegrees"]
    if plane is not None:
        checks.append(limit_check("whole-ligand-principal-plane", plane,
                                  THRESHOLDS["ligandPrincipalPlaneAngleDegrees"]))
    if regions["released"] is not None:
        checks.append(limit_check("released-region-rmsd", regions["released"]["rmsdAngstrom"],
                                  THRESHOLDS["releasedRegionRmsdAngstrom"]))
    distal = regions["distalFeature"]
    if distal is not None:
        checks.extend([
            limit_check("distal-feature-rmsd", distal["rmsdAngstrom"],
                        THRESHOLDS["distalFeatureRmsdAngstrom"]),
            limit_check("distal-feature-centroid", distal["centroidDisplacementAngstrom"],
                        THRESHOLDS["distalFeatureCentroidDisplacementAngstrom"]),
            limit_check("distal-feature-radial-distance",
                        distal["radialDistanceFromHardCoreDeltaAngstrom"],
                        THRESHOLDS["distalFeatureRadialDistanceDeltaAngstrom"]),
        ])
        if distal["principalPlaneAngleDegrees"] is not None:
            checks.append(limit_check("distal-feature-plane",
                                      distal["principalPlaneAngleDegrees"],
                                      THRESHOLDS["distalFeaturePlaneAngleDegrees"]))
    return {"accepted": all(check["passed"] for check in checks),
            "thresholds": THRESHOLDS, "checks": checks,
            "failedChecks": [check["id"] for check in checks if not check["passed"]]}


def aww_axh_continuity(campaign: dict, checkpoints: dict[str, dict]) -> dict:
    """Evaluate AWW-to-AXH continuity in their shared frozen receptor frame.

    Hard-region acceptance uses the coordinates exactly as recorded.  A
    hard-region rigid superposition is computed only to separate internal
    deformation from rigid-body motion and to provide a local frame for the
    deliberately released and seed-only regions; it never replaces the raw
    same-frame acceptance measurements.
    """
    final_step = next(step for step in campaign["steps"] if step["id"] == "finish-bay-293")
    regions = route_regions(final_step)
    pose_map = final_step["posePropagationMap"]
    before_by_name = coordinates_by_name(checkpoints["open-phe890-pocket"])
    after_by_name = coordinates_by_name(checkpoints["finish-bay-293"])
    product_names = final_step["productAtomNames"]

    mappings = {entry["productAtomIndex"]: entry["referenceAtomName"]
                for entry in pose_map["commonAtoms"]}
    hard_before = np.array([before_by_name[mappings[index]] for index in regions["hard"]])
    hard_after = np.array([after_by_name[product_names[index]] for index in regions["hard"]])
    hard_same_frame_metrics = transition_geometry_metrics(hard_before, hard_after)
    rotation, translation, hard_fit_rmsd = kabsch(hard_before, hard_after)
    aligned_after_all = transform_points(np.array([
        after_by_name[name] for name in product_names]),
        {"rotation": rotation, "translation": translation})
    hard_after_aligned = aligned_after_all[regions["hard"]]
    hard_internal_shape_geometry = transition_geometry_metrics(
        hard_before, hard_after_aligned)
    hard_internal_shape_metrics = {
        "atomCount": hard_internal_shape_geometry["atomCount"],
        "rmsdAfterRigidSuperpositionAngstrom": hard_fit_rmsd,
        "maximumResidualDisplacementAfterRigidSuperpositionAngstrom":
            hard_internal_shape_geometry["maximumDisplacementAngstrom"],
        "radialProfileRmsdAfterRigidSuperpositionAngstrom":
            hard_internal_shape_geometry["radialProfileRmsdAngstrom"],
        "diagnosticOnly": True,
        "usedForAcceptance": False,
    }
    hard_rigid_body_motion = {
        "centroidDisplacementAngstrom":
            hard_same_frame_metrics["centroidDisplacementAngstrom"],
        "orientationChangeDegrees": rotation_angle_degrees(rotation),
        "estimatedBy": "best rigid transform from AXH hard atoms to AWW hard atoms",
        "usedForAcceptance": True,
    }

    released_metrics = None
    if regions["released"]:
        released_before = np.array([
            before_by_name[mappings[index]] for index in regions["released"]])
        released_metrics = transition_geometry_metrics(
            released_before, aligned_after_all[regions["released"]],
            hard_before, hard_after_aligned)

    distal_metrics = None
    selected_variant = None
    registered_intents = final_step.get("retainedFeatureIntents", [])
    if len(registered_intents) != 1:
        raise RuntimeError("AWW to AXH continuity requires one registered retained-feature intent")
    features = [feature for feature in pose_map.get("spatialFeatureCorrespondences", [])
                if feature.get("treatment") == "seed-only"
                or feature.get("transferMode") == "seed-only"
                or (feature.get("treatment") == "soft-restraint"
                    and feature.get("required") is True
                    and feature.get("source") == "registered-designer-intent"
                    and feature.get("registeredIntentId"))]
    if len(features) != 1:
        raise RuntimeError("AWW to AXH continuity requires exactly one registered retained feature")
    if features:
        feature = features[0]
        if feature.get("registeredIntentId") != registered_intents[0].get("id"):
            raise RuntimeError("AWW to AXH retained feature is not linked to registered intent")
        variants = feature.get("mappingVariants") or [feature]
        candidates = []
        for variant_index, variant in enumerate(variants):
            before = np.array([before_by_name[name]
                               for name in variant["referenceAtomNames"]])
            after = aligned_after_all[variant["productAtomIndices"]]
            metrics = transition_geometry_metrics(
                before, after, hard_before, hard_after_aligned)
            candidates.append((metrics["rmsdAngstrom"], variant_index, metrics))
        _, selected_variant, distal_metrics = min(candidates, key=lambda entry: entry[0])
        distal_metrics["mappingVariantsEvaluated"] = len(variants)
        distal_metrics["selectedMappingVariant"] = selected_variant

    checks = [
        limit_check("hard-region-same-receptor-frame-rmsd",
                    hard_same_frame_metrics["rmsdAngstrom"],
                    CONTINUITY_THRESHOLDS[
                        "hardRegionSameReceptorFrameRmsdAngstrom"]),
        limit_check("hard-region-same-receptor-frame-maximum-displacement",
                    hard_same_frame_metrics["maximumDisplacementAngstrom"],
                    CONTINUITY_THRESHOLDS[
                        "hardRegionSameReceptorFrameMaximumDisplacementAngstrom"]),
        limit_check("hard-region-same-receptor-frame-centroid-displacement",
                    hard_rigid_body_motion["centroidDisplacementAngstrom"],
                    CONTINUITY_THRESHOLDS[
                        "hardRegionSameReceptorFrameCentroidDisplacementAngstrom"]),
        limit_check("hard-region-rigid-body-orientation-change",
                    hard_rigid_body_motion["orientationChangeDegrees"],
                    CONTINUITY_THRESHOLDS[
                        "hardRegionRigidBodyOrientationChangeDegrees"]),
    ]
    if released_metrics is not None:
        checks.append(limit_check(
            "released-region-after-hard-core-rigid-superposition-rmsd",
            released_metrics["rmsdAngstrom"],
            CONTINUITY_THRESHOLDS[
                "releasedRegionAfterHardCoreRigidSuperpositionRmsdAngstrom"]))
    if distal_metrics is not None:
        checks.extend([
            limit_check("distal-feature-after-hard-core-rigid-superposition-rmsd",
                        distal_metrics["rmsdAngstrom"],
                        CONTINUITY_THRESHOLDS[
                            "distalFeatureAfterHardCoreRigidSuperpositionRmsdAngstrom"]),
            limit_check("distal-feature-after-hard-core-rigid-superposition-centroid",
                        distal_metrics["centroidDisplacementAngstrom"],
                        CONTINUITY_THRESHOLDS[
                            "distalFeatureAfterHardCoreRigidSuperposition"
                            "CentroidDisplacementAngstrom"]),
            limit_check("distal-feature-after-hard-core-rigid-superposition-radial-distance",
                        distal_metrics["radialDistanceFromHardCoreDeltaAngstrom"],
                        CONTINUITY_THRESHOLDS[
                            "distalFeatureAfterHardCoreRigidSuperposition"
                            "RadialDistanceDeltaAngstrom"]),
        ])
        if distal_metrics["principalPlaneAngleDegrees"] is not None:
            checks.append(limit_check(
                "distal-feature-after-hard-core-rigid-superposition-plane",
                distal_metrics["principalPlaneAngleDegrees"],
                CONTINUITY_THRESHOLDS[
                    "distalFeatureAfterHardCoreRigidSuperpositionPlaneAngleDegrees"]))
    return {
        "schema": "molarium.design-prediction-continuity-evaluation/v2",
        "transition": {"fromStepId": "open-phe890-pocket", "fromStateId": "AWW",
                       "toStepId": "finish-bay-293", "toStateId": "AXH"},
        "acceptanceCoordinateFrame": (
            "raw AWW and AXH coordinates in the same frozen receptor frame; "
            "no ligand or hard-region fit"),
        "diagnosticRigidFit": (
            "AXH hard atoms rigidly superposed on AWW hard atoms only for "
            "internal-shape diagnostics and released/seed-only relative geometry"),
        "regions": {
            "hardSameReceptorFrame": hard_same_frame_metrics,
            "hardRigidBodyMotionInSameReceptorFrame": hard_rigid_body_motion,
            "hardInternalShapeAfterRigidSuperposition": hard_internal_shape_metrics,
            "releasedAfterHardCoreRigidSuperposition": released_metrics,
            "distalFeatureAfterHardCoreRigidSuperposition": distal_metrics,
        },
        "accepted": all(check["passed"] for check in checks),
        "thresholds": CONTINUITY_THRESHOLDS,
        "checks": checks,
        "failedChecks": [check["id"] for check in checks if not check["passed"]],
    }


def evaluate_verified_run(run_dir: Path, holdout_dir: Path, manifest_bytes: bytes,
                          manifest: dict, checkpoints: dict[str, dict],
                          campaign: dict, protocol_bytes: bytes,
                          protocol: dict) -> dict:
    """Read holdouts and evaluate a run whose complete freeze boundary passed."""
    full_results = []
    holdout_dir = holdout_dir.resolve()
    for evaluation in protocol["holdouts"]:
        step_id = evaluation["stepId"]
        pdb_id = evaluation["pdbId"]
        ligand_id = evaluation["ligandComponentId"]
        residue_number = evaluation["ligandResidueNumber"]
        holdout_path = (holdout_dir / evaluation["filename"]).resolve()
        if holdout_path.parent != holdout_dir:
            raise RuntimeError(f"{step_id}: holdout filename escapes the registered directory")
        holdout_bytes = holdout_path.read_bytes()
        holdout_text = holdout_bytes.decode()
        if pdb_identifier(holdout_text) != pdb_id:
            raise RuntimeError(f"{step_id}: opened holdout is not registered PDB {pdb_id}")
        holdout_rows = pdb_rows(holdout_text)
        step = next(step for step in campaign["steps"] if step["id"] == step_id)
        checkpoint = checkpoints[step_id]
        # Protein preparation centers the complex. Align the holdout directly
        # into the frozen prediction's receptor frame using the pre-registered
        # Phe890-excluding anchor list, never a data-dependent pocket intersection.
        reference_rows = [{
            "record": "ATOM", "atomName": atom["atomName"],
            "residueName": atom["residueName"], "chain": atom["chain"],
            "residueNumber": atom["residueIndex"], "insertionCode": "",
            "point": np.array(atom["coordinatesAngstrom"]),
        } for atom in checkpoint["pocket"]["atoms"]
            if atom["residueName"] and atom["atomName"] == "CA"]
        alignment = receptor_alignment(reference_rows, holdout_rows, protocol)
        predicted_by_name = coordinates_by_name(checkpoint)
        predicted = np.array([predicted_by_name[name] for name in step["productAtomNames"]])
        template = Chem.MolFromSmiles(step["productSmiles"])
        if template is None or template.GetNumAtoms() != len(step["productAtomNames"]):
            raise RuntimeError(f"{step_id}: registered product graph cannot be reconstructed")
        coordinate_fragment, fragment_names = ligand_fragment(
            holdout_text, ligand_id, residue_number, evaluation["ligandChain"])
        fragment, mappings, graph_validation = exact_registered_graph_mappings(
            template, coordinate_fragment)
        conformer = fragment.GetConformer()
        fragment_points = np.array([[conformer.GetAtomPosition(index).x,
                                     conformer.GetAtomPosition(index).y,
                                     conformer.GetAtomPosition(index).z]
                                    for index in range(fragment.GetNumAtoms())])
        fragment_points = transform_points(fragment_points, alignment)
        scored = []
        for mapping in mappings:
            holdout = fragment_points[mapping]
            scored.append((rmsd(predicted, holdout), mapping, holdout))
        best_rmsd, best_mapping, best_holdout = min(scored, key=lambda item: item[0])
        region_indices = route_regions(step)
        hard_predicted, hard_holdout = (predicted[region_indices["hard"]],
                                            best_holdout[region_indices["hard"]])
        region_metrics = {}
        for label in ["hard", "released", "distalFeature", "edited", "mapped"]:
            indices = region_indices[label]
            region_metrics[label] = (geometry_metrics(
                predicted[indices], best_holdout[indices], hard_predicted, hard_holdout)
                if indices else None)
            if region_metrics[label] is not None:
                region_metrics[label]["productAtomIndices"] = indices
                region_metrics[label]["productAtomNames"] = [
                    step["productAtomNames"][index] for index in indices]
        predicted_phe_rows = [{
            "record": "ATOM", "atomName": atom["atomName"],
            "residueName": atom["residueName"], "chain": atom["chain"],
            "residueNumber": atom["residueIndex"],
            "point": np.array(atom["coordinatesAngstrom"]),
        } for atom in checkpoint["pocket"]["atoms"]]
        refinement = checkpoint.get("refinement", {})
        seeding = refinement.get("featureGuidedSeeding") or {}
        whole_geometry = geometry_metrics(predicted, best_holdout)
        phe890 = phe890_metrics(predicted_phe_rows, holdout_rows, alignment)
        integrity = prediction_integrity(checkpoint, step, template)
        receptor = {"alignmentScope": (
                        "pre-registered stable SOS1 C-alpha anchors; designed Phe890 excluded"),
                    "alignmentAtoms": alignment["atoms"],
                    "alignmentRmsdAngstrom": alignment["rmsdAngstrom"],
                    "anchorRecords": alignment["anchorRecords"],
                    "excludedDesignedResidues": alignment["excludedDesignedResidues"]}
        ligand = {
            "scoringMethod": "receptor-aligned, graph-symmetry-minimized, no ligand fit",
            "symmetryMappings": len(mappings), "heavyAtoms": template.GetNumAtoms(),
            "registeredGraphValidation": graph_validation,
            "rmsdAngstrom": best_rmsd,
            # Compatibility field now means only route-declared hard coordinates.
            "inheritedRegionRmsdAngstrom": region_metrics["hard"]["rmsdAngstrom"],
            "hardRegionRmsdAngstrom": region_metrics["hard"]["rmsdAngstrom"],
            "releasedRegionRmsdAngstrom": (region_metrics["released"] or {}).get(
                "rmsdAngstrom"),
            "distalFeatureRmsdAngstrom": (region_metrics["distalFeature"] or {}).get(
                "rmsdAngstrom"),
            "mappedRegionRmsdAngstrom": region_metrics["mapped"]["rmsdAngstrom"],
            "editedRegionRmsdAngstrom": (region_metrics["edited"] or {}).get(
                "rmsdAngstrom"),
            "geometry": whole_geometry,
            "regions": region_metrics,
            "selectedHoldoutAtomNames": [fragment_names[index] for index in best_mapping],
        }
        acceptance = holdout_acceptance(receptor, ligand, region_metrics, phe890, integrity)
        result = {
            "schema": "molarium.design-prediction-holdout-evaluation/v2",
            "routeId": "sos1-hit-only", "stepId": step_id,
            "predictedStateId": checkpoint["predictedStateId"],
            "boundary": {
                "predictionManifestSha256": digest(manifest_bytes),
                "evaluationProtocolSha256": digest(protocol_bytes),
                "frozenPredictionSha256": next(entry["sha256"] for entry in manifest["checkpoints"]
                                                   if entry["stepId"] == step_id),
                "holdoutOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified": True,
            },
            "holdout": {"role": "evaluation-only", "pdbId": pdb_id,
                        "ligandComponentId": ligand_id,
                        "coordinateSha256": digest(holdout_bytes)},
            "receptor": receptor,
            "poseGeneration": {
                "featureSeedingMethod": seeding.get("method"),
                "uniqueSeedCount": seeding.get("uniqueSeedCount"),
                "untargetedRotorCount": seeding.get("untargetedRotorCount"),
                "editRegionAnglesDegrees": seeding.get("editRegionAnglesDegrees"),
                "selectedSeedAudit": seeding.get("selectedSeedAudit"),
            },
            "ligand": ligand,
            "phe890": phe890,
            "integrity": integrity,
            "acceptance": acceptance,
            "accepted": acceptance["accepted"],
        }
        full_results.append(result)

    continuity = aww_axh_continuity(campaign, checkpoints)
    final_result = next(result for result in full_results
                        if result["stepId"] == "finish-bay-293")
    final_result["predecessorContinuity"] = continuity
    if not continuity["accepted"]:
        final_result["accepted"] = False
        final_result["acceptance"]["accepted"] = False
        final_result["acceptance"]["failedChecks"].append("aww-to-axh-continuity")
        final_result["acceptance"]["checks"].append(
            boolean_check("aww-to-axh-continuity", False))
    else:
        final_result["acceptance"]["checks"].append(
            boolean_check("aww-to-axh-continuity", True))

    results = []
    for result in full_results:
        (run_dir / f"{result['stepId']}-holdout-evaluation.json").write_text(
            json.dumps(result, indent=2) + "\n")
        regions = result["ligand"]["regions"]
        results.append({
            "stepId": result["stepId"],
            "predictedStateId": result["predictedStateId"],
            "holdoutPdbId": result["holdout"]["pdbId"],
            "accepted": result["accepted"],
            "failedChecks": result["acceptance"]["failedChecks"],
            "receptorCaRmsdAngstrom": result["receptor"]["alignmentRmsdAngstrom"],
            "ligandRmsdAngstrom": result["ligand"]["rmsdAngstrom"],
            "hardRegionRmsdAngstrom": regions["hard"]["rmsdAngstrom"],
            "releasedRegionRmsdAngstrom": (regions["released"] or {}).get("rmsdAngstrom"),
            "distalFeatureRmsdAngstrom": (regions["distalFeature"] or {}).get("rmsdAngstrom"),
            "editedRegionRmsdAngstrom": (regions["edited"] or {}).get("rmsdAngstrom"),
            "selectedSeedAudit": result["poseGeneration"]["selectedSeedAudit"],
            "predictedPhe890ChiDegrees": result["phe890"]["predictedChiDegrees"],
            "holdoutPhe890ChiDegrees": result["phe890"]["holdoutChiDegrees"],
            "phe890SidechainRmsdAngstrom": result["phe890"]["sidechainRmsdAngstrom"],
            "proteinLigandSevereClashes": result["integrity"][
                "proteinLigandSevereClashes"],
        })
    report = {
        "schema": "molarium.design-prediction-holdout-evaluation-summary/v2",
        "routeId": "sos1-hit-only",
        "predictionManifestSha256": digest(manifest_bytes),
        "evaluationProtocolSha256": digest(protocol_bytes),
        "evaluationProtocol": {
            "schema": protocol["schema"],
            "evaluatorSha256": protocol["evaluator"]["sha256"],
            "registeredRouteSha256": protocol["registeredRoute"]["sha256"],
            "holdoutCoordinateHashBinding": protocol["holdoutCoordinateHashBinding"],
        },
        "holdoutsOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified": True,
        "accepted": all(result["accepted"] for result in full_results),
        "continuity": continuity,
        "results": results,
    }
    (run_dir / "holdout-evaluation-summary.json").write_text(
        json.dumps(report, indent=2) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", type=Path,
                        default=ROOT / "outputs/design-history/sos1-hit-only-prospective")
    parser.add_argument("--holdout-dir", type=Path,
                        default=ROOT / "outputs/design-history/sos1-preapproval/source")
    parser.add_argument("--protocol", type=Path, default=DEFAULT_PROTOCOL_PATH)
    args = parser.parse_args()
    run_dir = args.run.resolve()

    # No holdout path is resolved or read until the registered evaluation
    # protocol, complete prediction manifest, every frozen checkpoint, and
    # public-action audit verify.
    protocol_bytes, protocol = verify_evaluation_protocol(args.protocol.resolve())
    manifest_bytes, manifest, checkpoints, _, campaign = verify_run(
        run_dir, protocol)
    report = evaluate_verified_run(run_dir, args.holdout_dir.resolve(), manifest_bytes,
                                   manifest, checkpoints, campaign,
                                   protocol_bytes, protocol)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
