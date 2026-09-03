#!/usr/bin/env python3
"""Build deterministic, provenance-separated BCL-xL trajectory poses.

Compound 4 remains the deposited 3SPF pose. Compounds 6, 7, 16, and 21 are
reconstructed by embedding their exact literature graphs while constraining the
maximum common scaffold to the experimental 3SP7/03B coordinates. These files
are visualization reconstructions, not experimental structures or docking
predictions.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np
from rdkit import Chem, rdBase
from rdkit.Chem import AllChem, Descriptors, rdFMCS, rdMolAlign, rdMolDescriptors


HERE = Path(__file__).resolve().parent
OUTPUT = HERE / "generated"
SOURCE_PATH = HERE / "bclxl-trajectory.json"
REFERENCE_PDB = HERE / "3SPF.pdb"
TEMPLATE_PDB = HERE / "3SP7.pdb"
SEED = 20260831
CONFORMERS_BY_STATE = {"6": 24, "7": 8, "16": 12, "21": 4}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pdb_alpha_carbons(path: Path, chain: str = "A") -> dict[tuple[int, str, str], np.ndarray]:
    points: dict[tuple[int, str, str], np.ndarray] = {}
    for line in path.read_text().splitlines():
        if not line.startswith("ATOM") or line[21:22].strip() != chain or line[12:16].strip() != "CA":
            continue
        key = (int(line[22:26]), line[26:27].strip(), line[17:20].strip())
        points[key] = np.array([float(line[30:38]), float(line[38:46]), float(line[46:54])])
    return points


def kabsch_mobile_to_reference(reference: Path, mobile: Path) -> tuple[np.ndarray, np.ndarray, int, float]:
    ref = pdb_alpha_carbons(reference)
    mob = pdb_alpha_carbons(mobile)
    keys = sorted(ref.keys() & mob.keys())
    if len(keys) < 3:
        raise RuntimeError("Protein alignment requires at least three matching alpha carbons")
    p = np.stack([ref[key] for key in keys])
    q = np.stack([mob[key] for key in keys])
    p_center, q_center = p.mean(axis=0), q.mean(axis=0)
    covariance = (q - q_center).T @ (p - p_center)
    u, _, vt = np.linalg.svd(covariance)
    rotation = u @ vt
    if np.linalg.det(rotation) < 0:
        u[:, -1] *= -1
        rotation = u @ vt
    translation = p_center - q_center @ rotation
    fitted = q @ rotation + translation
    rmsd = float(np.sqrt(np.mean(np.sum((p - fitted) ** 2, axis=1))))
    return rotation, translation, len(keys), rmsd


def protein_heavy_coordinates(path: Path, rotation: np.ndarray, translation: np.ndarray) -> np.ndarray:
    points = []
    for line in path.read_text().splitlines():
        if not line.startswith("ATOM") or line[21:22].strip() != "A":
            continue
        element = (line[76:78].strip() or line[12:14].strip()).upper()
        if element == "H":
            continue
        point = np.array([float(line[30:38]), float(line[38:46]), float(line[46:54])])
        points.append(point @ rotation + translation)
    return np.stack(points)


def maximum_common_scaffold(template: Chem.Mol, target: Chem.Mol) -> tuple[tuple[int, ...], tuple[int, ...], str, bool]:
    result = rdFMCS.FindMCS(
        [template, target],
        atomCompare=rdFMCS.AtomCompare.CompareElements,
        bondCompare=rdFMCS.BondCompare.CompareOrderExact,
        ringMatchesRingOnly=True,
        completeRingsOnly=True,
        matchValences=True,
        timeout=60,
    )
    if result.numAtoms < 12:
        raise RuntimeError(f"Insufficient common scaffold ({result.numAtoms} atoms)")
    query = Chem.MolFromSmarts(result.smartsString)
    template_match = template.GetSubstructMatch(query)
    target_match = target.GetSubstructMatch(query)
    if len(template_match) != result.numAtoms or len(target_match) != result.numAtoms:
        raise RuntimeError("Unable to map the maximum common scaffold")
    return template_match, target_match, result.smartsString, bool(result.canceled)


def clamp_and_optimize_scaffold(molecule: Chem.Mol, conformer_id: int,
                                coordinate_map: dict[int, object]) -> tuple[int, float]:
    conformer = molecule.GetConformer(conformer_id)
    for target_index, position in coordinate_map.items():
        conformer.SetAtomPosition(target_index, position)
    if AllChem.MMFFHasAllMoleculeParams(molecule):
        properties = AllChem.MMFFGetMoleculeProperties(molecule, mmffVariant="MMFF94s")
        field = AllChem.MMFFGetMoleculeForceField(molecule, properties, confId=conformer_id)
    else:
        field = AllChem.UFFGetMoleculeForceField(molecule, confId=conformer_id)
    if field is None:
        return -1, math.inf
    for target_index in coordinate_map:
        field.AddFixedPoint(int(target_index))
    status = int(field.Minimize(maxIts=500))
    return status, float(field.CalcEnergy())


def clash_metrics(molecule: Chem.Mol, conformer_id: int, protein: np.ndarray) -> tuple[int, int, float]:
    conformer = molecule.GetConformer(conformer_id)
    ligand = np.array([
        [conformer.GetAtomPosition(atom.GetIdx()).x,
         conformer.GetAtomPosition(atom.GetIdx()).y,
         conformer.GetAtomPosition(atom.GetIdx()).z]
        for atom in molecule.GetAtoms() if atom.GetAtomicNum() > 1
    ])
    minimum = np.sqrt(np.min(np.sum((ligand[:, None, :] - protein[None, :, :]) ** 2, axis=2), axis=1))
    return int(np.sum(minimum < 1.55)), int(np.sum(minimum < 1.9)), float(minimum.min())


def apply_transform(molecule: Chem.Mol, conformer_id: int,
                    rotation: np.ndarray, translation: np.ndarray) -> None:
    conformer = molecule.GetConformer(conformer_id)
    for index in range(molecule.GetNumAtoms()):
        value = conformer.GetAtomPosition(index)
        transformed = np.array([value.x, value.y, value.z]) @ rotation + translation
        conformer.SetAtomPosition(index, transformed.tolist())


def coordinate_rmsd(molecule: Chem.Mol, conformer_id: int,
                    coordinate_map: dict[int, object]) -> float:
    conformer = molecule.GetConformer(conformer_id)
    squared = []
    for target_index, reference in coordinate_map.items():
        point = conformer.GetAtomPosition(target_index)
        squared.append((point.x - reference.x) ** 2 + (point.y - reference.y) ** 2
                       + (point.z - reference.z) ** 2)
    return float(math.sqrt(sum(squared) / len(squared)))


def build_pose(state: dict, template: Chem.Mol, protein: np.ndarray,
               template_label: str = "PDB 3SP7 ligand 03B aligned to PDB 3SPF",
               additional_templates: list[tuple[str, Chem.Mol]] | None = None) -> tuple[Chem.Mol, dict]:
    heavy = Chem.MolFromSmiles(state["smiles"])
    if heavy is None:
        raise RuntimeError(f"Unable to parse compound {state['id']}")
    if Chem.MolToInchi(heavy) != state["standardInchi"]:
        raise RuntimeError(f"Compound {state['id']} InChI differs from the curated OPSIN record")
    if Chem.InchiToInchiKey(state["standardInchi"]) != state["standardInchiKey"]:
        raise RuntimeError(f"Compound {state['id']} InChIKey differs from the curated OPSIN record")
    formula = rdMolDescriptors.CalcMolFormula(heavy)
    expected_mh = float(state["reported"]["esiMhPlus"])
    calculated_mh = Descriptors.ExactMolWt(heavy) + 1.007276
    if abs(calculated_mh - expected_mh) > 0.5:
        raise RuntimeError(f"Compound {state['id']} mass check failed: {calculated_mh:.3f} vs {expected_mh}")

    template_match, target_match, smarts, mcs_timed_out = maximum_common_scaffold(template, heavy)
    molecule = Chem.AddHs(heavy)
    primary_coordinates: dict[int, object] = {
        target_index: template.GetConformer().GetAtomPosition(template_index)
        for template_index, target_index in zip(template_match, target_match)
    }
    coordinates = dict(primary_coordinates)
    additional_metadata = []
    for label, additional in additional_templates or []:
        additional_match = heavy.GetSubstructMatch(additional)
        if not additional_match:
            raise RuntimeError(f"Compound {state['id']} does not contain coordinate template {label}")
        additional_coordinates = {
            target_index: additional.GetConformer().GetAtomPosition(template_index)
            for template_index, target_index in enumerate(additional_match)
        }
        coordinates.update(additional_coordinates)
        additional_metadata.append({"label": label, "atoms": len(additional_coordinates)})
    parameters = AllChem.ETKDGv3()
    parameters.randomSeed = SEED + int(state["id"])
    parameters.numThreads = 1
    # RDKit applies absolute coordinate maps during random-coordinate embedding.
    # Distance-geometry embedding without this mode can leave the unconstrained
    # portion near the origin before the scaffold is clamped into the pocket.
    parameters.useRandomCoords = True
    parameters.enforceChirality = True
    parameters.pruneRmsThresh = -1
    parameters.maxIterations = 500
    parameters.SetCoordMap(primary_coordinates)
    conformer_count = CONFORMERS_BY_STATE[state["id"]]
    conformer_ids = list(AllChem.EmbedMultipleConfs(molecule, numConfs=conformer_count, params=parameters))
    if not conformer_ids:
        raise RuntimeError(f"No conformer generated for compound {state['id']}")

    candidates = []
    for conformer_id in conformer_ids:
        preclamp_rmsd = coordinate_rmsd(molecule, conformer_id, coordinates)
        optimize_status, energy = clamp_and_optimize_scaffold(molecule, conformer_id, coordinates)
        severe, overlaps, minimum = clash_metrics(molecule, conformer_id, protein)
        candidates.append((severe, overlaps, preclamp_rmsd, energy, conformer_id, minimum,
                           optimize_status))
    candidates.sort()
    severe, overlaps, preclamp_rmsd, energy, chosen, minimum, optimize_status = candidates[0]

    selected = Chem.Mol(molecule)
    selected.RemoveAllConformers()
    selected.AddConformer(molecule.GetConformer(chosen), assignId=True)
    selected = Chem.RemoveHs(selected)
    selected.SetProp("_Name", f"BCL-xL compound {state['id']} reconstructed pose")
    return selected, {
        "formula": formula,
        "coordinateTemplate": template_label,
        "additionalCoordinateTemplates": additional_metadata,
        "monoisotopicMhPlus": round(calculated_mh, 6),
        "heavyAtoms": heavy.GetNumHeavyAtoms(),
        "templateMcsAtoms": len(template_match),
        "templateMcsFraction": round(len(template_match) / heavy.GetNumHeavyAtoms(), 6),
        "templateMcsSmarts": smarts,
        "templateMcsSearchTimedOut": mcs_timed_out,
        "fixedConstraintAtoms": len(coordinates),
        "generatedConformers": len(conformer_ids),
        "selectedConformer": int(chosen),
        "preclampScaffoldRmsdAngstrom": round(preclamp_rmsd, 6),
        "fixedScaffoldRmsdAngstrom": 0,
        "forceFieldOptimizeStatus": optimize_status,
        "proteinAtomsCloserThan1_55Angstrom": severe,
        "proteinAtomsCloserThan1_9Angstrom": overlaps,
        "minimumProteinDistanceAngstrom": round(minimum, 6),
        "forceFieldEnergy": round(energy, 6),
    }


def main() -> None:
    source = json.loads(SOURCE_PATH.read_text())
    template_path = HERE / source["coordinateTemplate"]["boundSdfFile"]
    if sha256(template_path) != source["coordinateTemplate"]["boundSdfSha256"]:
        raise RuntimeError("3SP7 bound-ligand SDF hash mismatch")
    template = Chem.MolFromMolFile(str(template_path), removeHs=True)
    if template is None or template.GetNumConformers() != 1:
        raise RuntimeError("Unable to load the 3SP7 bound ligand")

    starting_path = HERE / source["startingPose"]["boundSdfFile"]
    if sha256(starting_path) != source["startingPose"]["boundSdfSha256"]:
        raise RuntimeError("3SPF bound-ligand SDF hash mismatch")
    starting_template = Chem.MolFromMolFile(str(starting_path), removeHs=True)
    if starting_template is None or starting_template.GetNumConformers() != 1:
        raise RuntimeError("Unable to load the 3SPF bound ligand")

    rotation, translation, pairs, alignment_rmsd = kabsch_mobile_to_reference(REFERENCE_PDB, TEMPLATE_PDB)
    aligned_template = Chem.Mol(template)
    apply_transform(aligned_template, 0, rotation, translation)
    # Reconstructed states inherit the 3SP7/03B binding-site conformation, so
    # clash selection must use that same receptor after alignment onto 3SPF.
    protein = protein_heavy_coordinates(TEMPLATE_PDB, rotation, translation)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    state_by_id = {state["id"]: state for state in source["states"]}
    poses: dict[str, tuple[Chem.Mol, dict]] = {}
    for state_id in ["7", "6", "16", "21"]:
        state = state_by_id[state_id]
        if state_id == "6":
            pose, generation = build_pose(
                state, poses["7"][0], protein,
                "reconstructed compound 7 pose (itself constrained to PDB 3SP7 ligand 03B)")
        elif state_id == "16":
            pose, generation = build_pose(
                state, poses["7"][0], protein,
                "reconstructed compound 7 pose (itself constrained to PDB 3SP7 ligand 03B)")
        else:
            pose, generation = build_pose(state, aligned_template, protein)
        poses[state_id] = (pose, generation)

    entries = []
    for state in source["states"]:
        if state["coordinateClass"] == "experimental":
            entries.append({
                **state,
                "asset": "3spf-ligand.pdb",
                "assetSha256": sha256(OUTPUT / "3spf-ligand.pdb"),
                "generation": None,
            })
            continue
        pose, generation = poses[state["id"]]
        filename = f"bclxl-compound-{state['id']}-reconstructed.mol"
        path = OUTPUT / filename
        path.write_text(Chem.MolToMolBlock(pose, includeStereo=True) + "\n")
        entries.append({
            **state,
            "asset": filename,
            "assetSha256": sha256(path),
            "generation": generation,
        })
        print(
            f"compound {state['id']}: {generation['templateMcsAtoms']}/{generation['heavyAtoms']} "
            f"template atoms, pre-clamp RMSD {generation['preclampScaffoldRmsdAngstrom']:.3f} Å, "
            f"severe clashes {generation['proteinAtomsCloserThan1_55Angstrom']}"
        )

    manifest = {
        "schema": "molarium.bclxl-trajectory-assets/v1",
        "curatedAt": source["curatedAt"],
        "sourceManifest": SOURCE_PATH.name,
        "sourceManifestSha256": sha256(SOURCE_PATH),
        "generator": {
            "path": Path(__file__).name,
            "sha256": sha256(Path(__file__)),
            "rdkitVersion": rdBase.rdkitVersion,
            "numpyVersion": np.__version__,
            "algorithm": "ETKDGv3 with maximum-common-scaffold coordinate constraints to bound 3SP7/03B aligned onto 3SPF; compounds 6 and 16 are chained through the reconstructed compound 7 pose; deterministic single-thread conformer selection by protein clash count, coordinate RMSD, and force-field energy",
            "seed": SEED,
            "conformersPerState": CONFORMERS_BY_STATE,
        },
        "coordinateBoundary": {
            "experimentalState": "compound 4 from PDB 3SPF",
            "reconstructedStates": ["6", "7", "16", "21"],
            "template": "PDB 3SP7 ligand 03B (BM903), used only as a structural constraint",
            "claim": "Reconstructed coordinates are visualization hypotheses, not deposited poses, docking predictions, or experimental structures.",
        },
        "proteinAlignment": {
            "reference": "3SPF chain A",
            "mobile": "3SP7 chain A",
            "pairedAlphaCarbons": pairs,
            "rmsdAngstrom": round(alignment_rmsd, 6),
            "rotation": [[round(float(value), 12) for value in row] for row in rotation],
            "translation": [round(float(value), 12) for value in translation],
        },
        "states": entries,
    }
    manifest_path = OUTPUT / "bclxl-trajectory-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {manifest_path.relative_to(HERE.parent.parent)}")


if __name__ == "__main__":
    main()
