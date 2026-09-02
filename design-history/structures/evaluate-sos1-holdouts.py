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
from rdkit.Chem import rdFMCS


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> tuple[bytes, dict]:
    data = path.read_bytes()
    return data, json.loads(data)


def verify_run(run_dir: Path) -> tuple[bytes, dict, dict[str, dict], list[dict], dict]:
    manifest_bytes, manifest = read_json(run_dir / "prediction-manifest.json")
    if manifest.get("campaignId") != "sos1-hit-only":
        raise RuntimeError("Not a SOS1 hit-only prediction run")
    if manifest.get("status") != "predictions-frozen-holdouts-unopened":
        raise RuntimeError("Predictions were not frozen before evaluation")
    if manifest.get("protocol", {}).get("initialCoordinateInput") != "PDB 5OVE/AXE only":
        raise RuntimeError("The run did not start from 5OVE/AXE only")
    expected_steps = ["scaffold-rewrite", "fragment-merge",
                      "open-phe890-pocket", "finish-bay-293"]
    if [entry["stepId"] for entry in manifest.get("checkpoints", [])] != expected_steps:
        raise RuntimeError("The complete four-step SOS1 sequence is not frozen")
    checkpoints = {}
    for frozen in manifest["checkpoints"]:
        data, checkpoint = read_json(run_dir / frozen["filename"])
        if digest(data) != frozen["sha256"]:
            raise RuntimeError(f"{frozen['stepId']}: frozen checkpoint hash changed")
        if not checkpoint.get("frozenBeforeHoldoutAccess"):
            raise RuntimeError(f"{frozen['stepId']}: freeze boundary is absent")
        checkpoints[frozen["stepId"]] = checkpoint
    audit_bytes, audit_wrapper = read_json(run_dir / "chemist-action-audit.json")
    if digest(audit_bytes) != manifest["agentApi"]["auditSha256"]:
        raise RuntimeError("Chemist Actions audit hash changed")
    audit = audit_wrapper["records"]
    if len(audit) != manifest["agentApi"]["auditRecords"]:
        raise RuntimeError("Chemist Actions audit length changed")
    required = {"designCampaign.load", "designCampaign.applyStep", "pose.refine",
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


def receptor_alignment(reference_rows: list[dict], mobile_rows: list[dict]) -> dict:
    def key(row: dict) -> str:
        return f"{row['residueNumber']}:{row['insertionCode']}:{row['residueName']}"
    reference = {key(row): row["point"] for row in reference_rows
                 if row["record"] == "ATOM" and row["chain"] == "A"
                 and row["atomName"] == "CA"}
    mobile = {key(row): row["point"] for row in mobile_rows
              if row["record"] == "ATOM" and row["chain"] == "A"
              and row["atomName"] == "CA"}
    keys = sorted(set(reference) & set(mobile))
    if len(keys) < 20:
        raise RuntimeError("Insufficient SOS1 backbone atoms for holdout alignment")
    rotation, translation, rmsd = kabsch(
        np.array([reference[key] for key in keys]),
        np.array([mobile[key] for key in keys]))
    return {"rotation": rotation, "translation": translation,
            "atoms": len(keys), "rmsdAngstrom": rmsd}


def transform_points(points: np.ndarray, alignment: dict) -> np.ndarray:
    return points @ alignment["rotation"] + alignment["translation"]


def ligand_fragment(path: Path, residue_name: str, residue_number: int) -> tuple[Chem.Mol, list[str]]:
    full = Chem.MolFromPDBFile(str(path), removeHs=True, sanitize=False)
    if full is None:
        raise RuntimeError(f"Unable to parse {path.name}")
    selected = []
    names = []
    for atom in full.GetAtoms():
        info = atom.GetPDBResidueInfo()
        if (info and info.GetResidueName().strip() == residue_name
                and info.GetChainId().strip() == "A"
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


def symmetry_mappings(template: Chem.Mol, fragment: Chem.Mol) -> list[list[int]]:
    result = rdFMCS.FindMCS(
        [template, fragment], timeout=30,
        atomCompare=rdFMCS.AtomCompare.CompareElements,
        bondCompare=rdFMCS.BondCompare.CompareAny,
        ringMatchesRingOnly=False, completeRingsOnly=False,
    )
    if result.canceled or result.numAtoms != template.GetNumAtoms() \
            or result.numAtoms != fragment.GetNumAtoms():
        raise RuntimeError("Holdout ligand graph does not match the registered product graph")
    query = Chem.MolFromSmarts(result.smartsString)
    template_matches = template.GetSubstructMatches(query, uniquify=False, maxMatches=4096)
    fragment_matches = fragment.GetSubstructMatches(query, uniquify=False, maxMatches=4096)
    mappings = set()
    for template_match in template_matches:
        for fragment_match in fragment_matches:
            mapping = [None] * template.GetNumAtoms()
            for template_index, fragment_index in zip(template_match, fragment_match):
                mapping[template_index] = fragment_index
            if all(index is not None for index in mapping):
                mappings.add(tuple(mapping))
    if not mappings:
        raise RuntimeError("No complete ligand symmetry map was found")
    return [list(mapping) for mapping in sorted(mappings)]


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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", type=Path,
                        default=ROOT / "outputs/design-history/sos1-hit-only-prospective")
    parser.add_argument("--holdout-dir", type=Path,
                        default=ROOT / "outputs/design-history/sos1-preapproval/source")
    args = parser.parse_args()
    run_dir = args.run.resolve()

    # Nothing below this call can run until all prediction and action hashes pass.
    manifest_bytes, manifest, checkpoints, _, campaign = verify_run(run_dir)

    evaluations = [
        ("scaffold-rewrite", "5OVF", "AWT", 1101),
        ("fragment-merge", "5OVG", "AWZ", 1101),
        ("open-phe890-pocket", "5OVH", "AWW", 1101),
        ("finish-bay-293", "5OVI", "AXH", 2001),
    ]
    results = []
    for step_id, pdb_id, ligand_id, residue_number in evaluations:
        # Evaluation-only coordinate access begins here.
        holdout_path = args.holdout_dir.resolve() / f"{pdb_id}.pdb"
        holdout_bytes = holdout_path.read_bytes()
        holdout_rows = pdb_rows(holdout_bytes.decode())
        step = next(step for step in campaign["steps"] if step["id"] == step_id)
        checkpoint = checkpoints[step_id]
        # Protein preparation centers the complex.  Align the holdout directly
        # into the frozen prediction's receptor frame using the inspected
        # pocket C-alpha atoms, not the raw 5OVE file frame.
        reference_rows = [{
            "record": "ATOM", "atomName": atom["atomName"],
            "residueName": atom["residueName"], "chain": atom["chain"],
            "residueNumber": atom["residueIndex"], "insertionCode": "",
            "point": np.array(atom["coordinatesAngstrom"]),
        } for atom in checkpoint["pocket"]["atoms"]
            if atom["residueName"] and atom["atomName"] == "CA"]
        alignment = receptor_alignment(reference_rows, holdout_rows)
        predicted_by_name = {atom["atomName"]: np.array(atom["coordinatesAngstrom"])
                             for atom in checkpoint["ligand"]["atoms"]
                             if atom["element"] != "H"}
        predicted = np.array([predicted_by_name[name] for name in step["productAtomNames"]])
        template = Chem.MolFromSmiles(step["productSmiles"])
        fragment, fragment_names = ligand_fragment(holdout_path, ligand_id, residue_number)
        mappings = symmetry_mappings(template, fragment)
        conformer = fragment.GetConformer()
        fragment_points = np.array([[conformer.GetAtomPosition(index).x,
                                     conformer.GetAtomPosition(index).y,
                                     conformer.GetAtomPosition(index).z]
                                    for index in range(fragment.GetNumAtoms())])
        fragment_points = transform_points(fragment_points, alignment)
        common = {entry["productAtomIndex"] for entry in step["posePropagationMap"]["commonAtoms"]}
        inherited = sorted(common)
        edited = [index for index in range(template.GetNumAtoms()) if index not in common]
        scored = []
        for mapping in mappings:
            holdout = fragment_points[mapping]
            scored.append((rmsd(predicted, holdout), mapping, holdout))
        best_rmsd, best_mapping, best_holdout = min(scored, key=lambda item: item[0])
        predicted_phe_rows = [{
            "record": "ATOM", "atomName": atom["atomName"],
            "residueName": atom["residueName"], "chain": atom["chain"],
            "residueNumber": atom["residueIndex"],
            "point": np.array(atom["coordinatesAngstrom"]),
        } for atom in checkpoint["pocket"]["atoms"]]
        refinement = checkpoint.get("refinement", {})
        seeding = refinement.get("featureGuidedSeeding") or {}
        result = {
            "schema": "molarium.design-prediction-holdout-evaluation/v1",
            "campaignId": "sos1-hit-only", "stepId": step_id,
            "predictedStateId": checkpoint["predictedStateId"],
            "boundary": {
                "predictionManifestSha256": digest(manifest_bytes),
                "frozenPredictionSha256": next(entry["sha256"] for entry in manifest["checkpoints"]
                                                   if entry["stepId"] == step_id),
                "holdoutOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified": True,
            },
            "holdout": {"role": "evaluation-only", "pdbId": pdb_id,
                        "ligandComponentId": ligand_id,
                        "coordinateSha256": digest(holdout_bytes)},
            "receptor": {"alignmentScope": "frozen predicted SOS1 pocket C-alpha atoms",
                         "alignmentAtoms": alignment["atoms"],
                         "alignmentRmsdAngstrom": alignment["rmsdAngstrom"]},
            "poseGeneration": {
                "featureSeedingMethod": seeding.get("method"),
                "uniqueSeedCount": seeding.get("uniqueSeedCount"),
                "untargetedRotorCount": seeding.get("untargetedRotorCount"),
                "editRegionAnglesDegrees": seeding.get("editRegionAnglesDegrees"),
                "selectedSeedAudit": seeding.get("selectedSeedAudit"),
            },
            "ligand": {
                "scoringMethod": "receptor-aligned, graph-symmetry-minimized, no ligand fit",
                "symmetryMappings": len(mappings), "heavyAtoms": template.GetNumAtoms(),
                "rmsdAngstrom": best_rmsd,
                "inheritedRegionRmsdAngstrom": rmsd(predicted, best_holdout, inherited),
                "editedRegionRmsdAngstrom": rmsd(predicted, best_holdout, edited),
                "selectedHoldoutAtomNames": [fragment_names[index] for index in best_mapping],
            },
            "phe890": {"predictedChiDegrees": phe_chi(predicted_phe_rows),
                       "holdoutChiDegrees": phe_chi(holdout_rows, True, alignment)},
        }
        output_path = run_dir / f"{step_id}-holdout-evaluation.json"
        output_path.write_text(json.dumps(result, indent=2) + "\n")
        results.append({"stepId": step_id, "predictedStateId": checkpoint["predictedStateId"],
                        "holdoutPdbId": pdb_id,
                        "receptorCaRmsdAngstrom": alignment["rmsdAngstrom"],
                        "ligandRmsdAngstrom": best_rmsd,
                        "editedRegionRmsdAngstrom": result["ligand"]["editedRegionRmsdAngstrom"],
                        "selectedSeedAudit": result["poseGeneration"]["selectedSeedAudit"],
                        "predictedPhe890ChiDegrees": result["phe890"]["predictedChiDegrees"],
                        "holdoutPhe890ChiDegrees": result["phe890"]["holdoutChiDegrees"]})
    report = {
        "schema": "molarium.design-prediction-holdout-evaluation-summary/v1",
        "campaignId": "sos1-hit-only",
        "predictionManifestSha256": digest(manifest_bytes),
        "holdoutsOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified": True,
        "results": results,
    }
    (run_dir / "holdout-evaluation-summary.json").write_text(
        json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
