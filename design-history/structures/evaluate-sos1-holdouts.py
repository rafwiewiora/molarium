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
    "hardRegionFitRmsdAngstrom": 0.60,
    "hardRegionMaximumDisplacementAngstrom": 1.00,
    "releasedRegionRmsdAngstrom": 2.50,
    "distalFeatureRmsdAngstrom": 1.50,
    "distalFeatureCentroidDisplacementAngstrom": 1.50,
    "distalFeaturePlaneAngleDegrees": 30.0,
    "distalFeatureRadialDistanceDeltaAngstrom": 1.00,
}

PHE890_SIDECHAIN_ATOMS = ["CB", "CG", "CD1", "CD2", "CE1", "CE2", "CZ"]
SEVERE_CLASH_RADIUS_FRACTION = 0.62


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> tuple[bytes, dict]:
    data = path.read_bytes()
    return data, json.loads(data)


def verify_run(run_dir: Path) -> tuple[bytes, dict, dict[str, dict], list[dict], dict]:
    manifest_bytes, manifest = read_json(run_dir / "prediction-manifest.json")
    if manifest.get("routeId") != "sos1-hit-only":
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
        if feature.get("treatment") != "seed-only" \
                and feature.get("transferMode") != "seed-only":
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
    """Evaluate the graph-registered AWW to AXH transition without a ligand fit."""
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
    rotation, translation, hard_fit_rmsd = kabsch(hard_before, hard_after)
    aligned_after_all = transform_points(np.array([
        after_by_name[name] for name in product_names]),
        {"rotation": rotation, "translation": translation})
    hard_after_aligned = aligned_after_all[regions["hard"]]
    hard_metrics = geometry_metrics(hard_before, hard_after_aligned)
    hard_metrics["fitRmsdAngstrom"] = hard_fit_rmsd

    released_metrics = None
    if regions["released"]:
        released_before = np.array([
            before_by_name[mappings[index]] for index in regions["released"]])
        released_metrics = geometry_metrics(
            released_before, aligned_after_all[regions["released"]],
            hard_before, hard_after_aligned)

    distal_metrics = None
    selected_variant = None
    features = [feature for feature in pose_map.get("spatialFeatureCorrespondences", [])
                if feature.get("treatment") == "seed-only"
                or feature.get("transferMode") == "seed-only"]
    if features:
        if len(features) != 1:
            raise RuntimeError("AWW to AXH continuity currently requires one seed-only feature")
        feature = features[0]
        variants = feature.get("mappingVariants") or [feature]
        candidates = []
        for variant_index, variant in enumerate(variants):
            before = np.array([before_by_name[name]
                               for name in variant["referenceAtomNames"]])
            after = aligned_after_all[variant["productAtomIndices"]]
            metrics = geometry_metrics(before, after, hard_before, hard_after_aligned)
            candidates.append((metrics["rmsdAngstrom"], variant_index, metrics))
        _, selected_variant, distal_metrics = min(candidates, key=lambda entry: entry[0])
        distal_metrics["mappingVariantsEvaluated"] = len(variants)
        distal_metrics["selectedMappingVariant"] = selected_variant

    checks = [
        limit_check("hard-region-fit", hard_metrics["fitRmsdAngstrom"],
                    CONTINUITY_THRESHOLDS["hardRegionFitRmsdAngstrom"]),
        limit_check("hard-region-maximum-displacement",
                    hard_metrics["maximumDisplacementAngstrom"],
                    CONTINUITY_THRESHOLDS["hardRegionMaximumDisplacementAngstrom"]),
    ]
    if released_metrics is not None:
        checks.append(limit_check("released-region-rmsd", released_metrics["rmsdAngstrom"],
                                  CONTINUITY_THRESHOLDS["releasedRegionRmsdAngstrom"]))
    if distal_metrics is not None:
        checks.extend([
            limit_check("distal-feature-rmsd", distal_metrics["rmsdAngstrom"],
                        CONTINUITY_THRESHOLDS["distalFeatureRmsdAngstrom"]),
            limit_check("distal-feature-centroid",
                        distal_metrics["centroidDisplacementAngstrom"],
                        CONTINUITY_THRESHOLDS["distalFeatureCentroidDisplacementAngstrom"]),
            limit_check("distal-feature-radial-distance",
                        distal_metrics["radialDistanceFromHardCoreDeltaAngstrom"],
                        CONTINUITY_THRESHOLDS["distalFeatureRadialDistanceDeltaAngstrom"]),
        ])
        if distal_metrics["principalPlaneAngleDegrees"] is not None:
            checks.append(limit_check("distal-feature-plane",
                                      distal_metrics["principalPlaneAngleDegrees"],
                                      CONTINUITY_THRESHOLDS["distalFeaturePlaneAngleDegrees"]))
    return {
        "schema": "molarium.design-prediction-continuity-evaluation/v1",
        "transition": {"fromStepId": "open-phe890-pocket", "fromStateId": "AWW",
                       "toStepId": "finish-bay-293", "toStateId": "AXH"},
        "alignment": "AXH aligned to AWW using only route-declared hard atoms",
        "regions": {"hard": hard_metrics, "released": released_metrics,
                    "distalFeature": distal_metrics},
        "accepted": all(check["passed"] for check in checks),
        "thresholds": CONTINUITY_THRESHOLDS,
        "checks": checks,
        "failedChecks": [check["id"] for check in checks if not check["passed"]],
    }


def evaluate_verified_run(run_dir: Path, holdout_dir: Path, manifest_bytes: bytes,
                          manifest: dict, checkpoints: dict[str, dict],
                          campaign: dict) -> dict:
    """Read holdouts and evaluate a run whose complete freeze boundary passed."""
    evaluations = [
        ("scaffold-rewrite", "5OVF", "AWT", 1101),
        ("fragment-merge", "5OVG", "AWZ", 1101),
        ("open-phe890-pocket", "5OVH", "AWW", 1101),
        ("finish-bay-293", "5OVI", "AXH", 2001),
    ]
    full_results = []
    for step_id, pdb_id, ligand_id, residue_number in evaluations:
        holdout_path = holdout_dir / f"{pdb_id}.pdb"
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
        predicted_by_name = coordinates_by_name(checkpoint)
        predicted = np.array([predicted_by_name[name] for name in step["productAtomNames"]])
        template = Chem.MolFromSmiles(step["productSmiles"])
        if template is None or template.GetNumAtoms() != len(step["productAtomNames"]):
            raise RuntimeError(f"{step_id}: registered product graph cannot be reconstructed")
        fragment, fragment_names = ligand_fragment(holdout_path, ligand_id, residue_number)
        mappings = symmetry_mappings(template, fragment)
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
        receptor = {"alignmentScope": "frozen predicted SOS1 pocket C-alpha atoms",
                    "alignmentAtoms": alignment["atoms"],
                    "alignmentRmsdAngstrom": alignment["rmsdAngstrom"]}
        ligand = {
            "scoringMethod": "receptor-aligned, graph-symmetry-minimized, no ligand fit",
            "symmetryMappings": len(mappings), "heavyAtoms": template.GetNumAtoms(),
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
    args = parser.parse_args()
    run_dir = args.run.resolve()

    # No holdout path is resolved or read until the complete prediction
    # manifest, every frozen checkpoint, and the public-action audit verify.
    manifest_bytes, manifest, checkpoints, _, campaign = verify_run(run_dir)
    report = evaluate_verified_run(run_dir, args.holdout_dir.resolve(), manifest_bytes,
                                   manifest, checkpoints, campaign)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
