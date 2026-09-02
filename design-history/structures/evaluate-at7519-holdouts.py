#!/usr/bin/env python3
"""Open and evaluate AT7519 crystal holdouts after prediction freeze.

This script verifies every frozen checkpoint and the Agent API audit before it
opens any later-structure file.  Crystal atom labels are reconciled only after
that gate, using element-labelled graph isomorphism and the lowest RMSD across
true graph symmetries.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

from rdkit import Chem


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
GENERATED = HERE / "generated"
RUN = ROOT / "outputs" / "design-history" / "at7519-hit-only-prospective"
REVIEW = ROOT / "outputs" / "design-history" / "at7519-preapproval" / "review" / "data.json"
SOURCE = ROOT / "outputs" / "design-history" / "at7519-preapproval" / "source"
CAMPAIGN = GENERATED / "at7519-prospective-campaign.json"
OUTPUT = GENERATED / "at7519-holdout-evaluation.json"
ASSET_OUTPUT = GENERATED
ASSET_PREFIX = "at7519"

HOLDOUTS = [
    ("scaffold-hop", "2VTL", "LZ5", "compound-15"),
    ("grow-acetamide", "2VTN", "LZ7", "compound-18"),
    ("grow-benzamide", "2VTO", "LZ8", "compound-22"),
    ("lock-difluoro-torsion", "2VTP", "LZ9", "compound-23"),
    ("finish-at7519", "2VU3", "LZE", "compound-33"),
]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def verify_freeze() -> tuple[dict, dict, list[dict]]:
    """Complete this gate before resolving or reading any holdout asset."""
    campaign_bytes = CAMPAIGN.read_bytes()
    campaign = json.loads(campaign_bytes)
    manifest_path = RUN / "prediction-manifest.json"
    manifest = load_json(manifest_path)
    if manifest.get("status") != "predictions-frozen-holdouts-unopened":
        raise RuntimeError("Prediction manifest is not frozen with holdouts unopened")
    if manifest.get("campaignId") != "cdk2-at7519-hit-only":
        raise RuntimeError("Prediction manifest campaign changed")
    if manifest.get("protocol", {}).get("holdoutCoordinateReads") != 0:
        raise RuntimeError("Prediction run reports pre-freeze holdout access")
    if manifest["inputs"]["campaign"]["sha256"] != sha256_bytes(campaign_bytes):
        raise RuntimeError("Frozen run used a different campaign")
    checkpoints = []
    expected_steps = [entry[0] for entry in HOLDOUTS]
    if [entry["stepId"] for entry in manifest["checkpoints"]] != expected_steps:
        raise RuntimeError("The five frozen prediction checkpoints are incomplete")
    receptor_hashes = set()
    previous_freeze_sequence = -1
    for entry in manifest["checkpoints"]:
        path = RUN / entry["filename"]
        data = path.read_bytes()
        if len(data) != entry["bytes"] or sha256_bytes(data) != entry["sha256"]:
            raise RuntimeError(f"Frozen checkpoint changed: {entry['stepId']}")
        checkpoint = json.loads(data)
        if not checkpoint.get("frozenBeforeHoldoutAccess"):
            raise RuntimeError(f"Checkpoint was not frozen: {entry['stepId']}")
        if checkpoint.get("receptorPolicy", {}).get("sideChainMotion") != "disabled":
            raise RuntimeError(f"Side-chain motion entered run: {entry['stepId']}")
        receptor_hashes.add(checkpoint["receptorPolicy"]["coordinateSha256"])
        if entry["freezeActionSequence"] <= previous_freeze_sequence:
            raise RuntimeError("Freeze action sequence is not strictly increasing")
        previous_freeze_sequence = entry["freezeActionSequence"]
        checkpoints.append(checkpoint)
    if len(receptor_hashes) != 1:
        raise RuntimeError("The receptor coordinate hash changed across the campaign")
    audit_path = RUN / "chemist-action-audit.json"
    audit_bytes = audit_path.read_bytes()
    if sha256_bytes(audit_bytes) != manifest["agentApi"]["auditSha256"]:
        raise RuntimeError("Agent API audit changed after prediction freeze")
    audit = json.loads(audit_bytes)
    if len(audit["records"]) != manifest["agentApi"]["auditRecords"]:
        raise RuntimeError("Agent API audit record count changed")
    forbidden = ("2vtl", "2vtn", "2vto", "2vtp", "2vu3", "lz5", "lz7", "lz8", "lz9", "lze")
    prefreeze_text = json.dumps({"campaign": campaign, "manifest": manifest,
                                 "audit": audit}, separators=(",", ":")).lower()
    if any(token in prefreeze_text for token in forbidden):
        raise RuntimeError("A holdout identifier leaked into the pre-freeze provenance")
    return campaign, manifest, checkpoints


def pdb_atoms_and_graph(pdb: str) -> tuple[list[dict], list[set[int]]]:
    atoms = []
    serial_to_index = {}
    connect = []
    for line in pdb.splitlines():
        if line.startswith(("ATOM  ", "HETATM")):
            serial = int(line[6:11])
            element = line[76:78].strip()
            if not element:
                element = ''.join(character for character in line[12:16]
                                  if character.isalpha())[:1]
            if element.upper() == "H":
                continue
            serial_to_index[serial] = len(atoms)
            atoms.append({
                "serial": serial, "name": line[12:16].strip(),
                "element": element.capitalize(),
                "coordinates": (float(line[30:38]), float(line[38:46]), float(line[46:54])),
            })
        elif line.startswith("CONECT"):
            fields = line.split()
            if len(fields) >= 3:
                connect.append([int(field) for field in fields[1:]])
    graph = [set() for _ in atoms]
    for values in connect:
        first = serial_to_index.get(values[0])
        if first is None:
            continue
        for serial in values[1:]:
            second = serial_to_index.get(serial)
            if second is not None and second != first:
                graph[first].add(second)
                graph[second].add(first)
    if any(not neighbors for neighbors in graph):
        raise RuntimeError("Holdout ligand has an unconnected heavy atom")
    return atoms, graph


def product_graph(smiles: str) -> tuple[list[str], list[set[int]]]:
    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        raise RuntimeError(f"Invalid frozen product graph: {smiles}")
    elements = [atom.GetSymbol() for atom in molecule.GetAtoms()]
    graph = [set() for _ in elements]
    for bond in molecule.GetBonds():
        first, second = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
        graph[first].add(second)
        graph[second].add(first)
    return elements, graph


def graph_isomorphisms(crystal_atoms: list[dict], crystal_graph: list[set[int]],
                       product_elements: list[str], product_edges: list[set[int]]) -> list[dict[int, int]]:
    if len(crystal_atoms) != len(product_elements):
        raise RuntimeError("Crystal and registered graph heavy-atom counts differ")
    candidates = {}
    for crystal_index, atom in enumerate(crystal_atoms):
        candidates[crystal_index] = [product_index for product_index, element in enumerate(product_elements)
            if element == atom["element"]
            and len(product_edges[product_index]) == len(crystal_graph[crystal_index])]
        if not candidates[crystal_index]:
            raise RuntimeError(f"No graph candidate for crystal atom {atom['name']}")
    order = sorted(range(len(crystal_atoms)),
                   key=lambda index: (len(candidates[index]), -len(crystal_graph[index]), index))
    matches = []
    mapping: dict[int, int] = {}
    used = set()

    def visit(depth: int) -> None:
        if len(matches) > 20000:
            raise RuntimeError("Too many ligand graph symmetries")
        if depth == len(order):
            matches.append(dict(mapping))
            return
        crystal_index = order[depth]
        for product_index in candidates[crystal_index]:
            if product_index in used:
                continue
            if any(((other in crystal_graph[crystal_index])
                    != (mapped in product_edges[product_index]))
                   for other, mapped in mapping.items()):
                continue
            mapping[crystal_index] = product_index
            used.add(product_index)
            visit(depth + 1)
            used.remove(product_index)
            del mapping[crystal_index]

    visit(0)
    if not matches:
        raise RuntimeError("No element-labelled graph isomorphism for crystal ligand")
    return matches


def distance(first, second) -> float:
    return math.dist(first, second)


def rmsd(indices: list[int], predicted: list[tuple], crystal: list[tuple]) -> float:
    return math.sqrt(sum(distance(predicted[index], crystal[index]) ** 2 for index in indices)
                     / len(indices))


def centroid(points: list[tuple]) -> tuple[float, float, float]:
    return tuple(sum(point[axis] for point in points) / len(points) for axis in range(3))


def dihedral_degrees(first, second, third, fourth) -> float:
    def subtract(left, right):
        return tuple(left[index] - right[index] for index in range(3))
    def cross(left, right):
        return (left[1] * right[2] - left[2] * right[1],
                left[2] * right[0] - left[0] * right[2],
                left[0] * right[1] - left[1] * right[0])
    def dot(left, right):
        return sum(left[index] * right[index] for index in range(3))
    def unit(vector):
        length = math.sqrt(dot(vector, vector))
        return tuple(value / length for value in vector)
    first_bond = subtract(second, first)
    axis = unit(subtract(third, second))
    last_bond = subtract(fourth, third)
    first_normal = unit(cross(first_bond, axis))
    second_normal = unit(cross(axis, last_bond))
    return math.degrees(math.atan2(dot(cross(first_normal, second_normal), axis),
                                   dot(first_normal, second_normal)))


def affected_aryl_carbonyl_torsion(step: dict, predicted: list[tuple],
                                   crystal: list[tuple]) -> dict | None:
    molecule = Chem.MolFromSmiles(step["productSmiles"])
    added = {entry["productAtomIndex"] for entry in
             step["posePropagationMap"]["addedProductAtoms"]}
    graph = [set() for _ in molecule.GetAtoms()]
    for bond in molecule.GetBonds():
        graph[bond.GetBeginAtomIdx()].add(bond.GetEndAtomIdx())
        graph[bond.GetEndAtomIdx()].add(bond.GetBeginAtomIdx())

    def graph_distance(root: int) -> int:
        visited, frontier = {root}, [root]
        depth = 0
        while frontier:
            if any(index in added for index in frontier):
                return depth
            next_frontier = []
            for index in frontier:
                for neighbor in graph[index]:
                    if neighbor not in visited:
                        visited.add(neighbor); next_frontier.append(neighbor)
            frontier = next_frontier; depth += 1
        return 10**6

    candidates = []
    for bond in molecule.GetBonds():
        if bond.GetBondTypeAsDouble() != 1 or bond.GetIsAromatic():
            continue
        first, second = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
        for carbonyl, aryl in [(first, second), (second, first)]:
            if (molecule.GetAtomWithIdx(carbonyl).GetSymbol() != "C"
                    or not molecule.GetAtomWithIdx(aryl).GetIsAromatic()
                    or molecule.GetAtomWithIdx(aryl).GetSymbol() != "C"):
                continue
            oxygens = [neighbor.GetIdx() for neighbor in molecule.GetAtomWithIdx(carbonyl).GetNeighbors()
                       if neighbor.GetSymbol() == "O"
                       and molecule.GetBondBetweenAtoms(carbonyl, neighbor.GetIdx())
                       .GetBondTypeAsDouble() >= 1.9]
            orthos = [neighbor.GetIdx() for neighbor in molecule.GetAtomWithIdx(aryl).GetNeighbors()
                      if neighbor.GetIdx() != carbonyl and neighbor.GetIsAromatic()]
            if oxygens and orthos:
                candidates.append((graph_distance(aryl), carbonyl, aryl,
                                   min(oxygens), min(orthos)))
    if not candidates:
        return None
    _, carbonyl, aryl, oxygen, ortho = min(candidates)
    indices = [oxygen, carbonyl, aryl, ortho]
    predicted_angle = dihedral_degrees(*(predicted[index] for index in indices))
    crystal_angle = dihedral_degrees(*(crystal[index] for index in indices))
    predicted_folded = abs(((predicted_angle + 90) % 180) - 90)
    crystal_folded = abs(((crystal_angle + 90) % 180) - 90)
    return {
        "definition": "absolute O=C-C(aryl)-C(ortho) dihedral folded to 0-90 degrees",
        "productAtomIndices": indices,
        "productAtomNames": [step["productAtomNames"][index] for index in indices],
        "predictedDegrees": round(predicted_folded, 6),
        "holdoutDegrees": round(crystal_folded, 6),
        "absoluteDifferenceDegrees": round(abs(predicted_folded - crystal_folded), 6),
    }


def app_translation(checkpoint: dict, raw_hit_pdb: str) -> tuple[tuple[float, float, float], float]:
    raw_atoms = []
    for line in raw_hit_pdb.splitlines():
        if (line.startswith("HETATM") and line[17:20].strip() == "LZ1"
                and line[21:22].strip() == "A" and int(line[22:26]) == 1301):
            raw_atoms.append({"name": line[12:16].strip(),
                              "coordinates": (float(line[30:38]), float(line[38:46]),
                                              float(line[46:54]))})
    if len(raw_atoms) != 9:
        raise RuntimeError("The raw 2VTA hit ligand changed")
    raw_by_name = {atom["name"]: atom["coordinates"] for atom in raw_atoms}
    reference_atoms = [atom for atom in checkpoint["pocket"]["atoms"]
                       if atom["atomId"].startswith("reference-2VTA:HETATM:A:LZ1")]
    offsets = []
    for atom in reference_atoms:
        raw = raw_by_name[atom["atomName"]]
        app = atom["coordinatesAngstrom"]
        offsets.append(tuple(app[axis] - raw[axis] for axis in range(3)))
    translation = centroid(offsets)
    residual = math.sqrt(sum(distance(offset, translation) ** 2 for offset in offsets)
                         / len(offsets))
    if residual > 1e-6:
        raise RuntimeError(f"2VTA application transform is not a pure translation: {residual}")
    return translation, residual


def pdb_line(serial: int, name: str, residue: str, coordinates: tuple, element: str) -> str:
    x, y, z = coordinates
    return (f"HETATM{serial:5d} {name[:4]:>4s} {residue:>3s} A   1    "
            f"{x:8.3f}{y:8.3f}{z:8.3f}  1.00 20.00          {element:>2s}  ")


def write_ligand_pdb(path: Path, names: list[str], elements: list[str], coordinates: list[tuple],
                     edges: list[set[int]], residue: str, remark: str) -> None:
    lines = [f"REMARK 950 {remark}"]
    for index, (name, element, point) in enumerate(zip(names, elements, coordinates)):
        lines.append(pdb_line(index + 1, name, residue, point, element))
    for index, neighbors in enumerate(edges):
        if neighbors:
            lines.append(f"CONECT{index + 1:5d}" + ''.join(f"{neighbor + 1:5d}" for neighbor in sorted(neighbors)))
    lines.extend(["END", ""])
    path.write_text("\n".join(lines))


def main() -> None:
    global RUN, OUTPUT, ASSET_OUTPUT, ASSET_PREFIX
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", default=str(RUN.relative_to(ROOT)))
    parser.add_argument("--output", default=str(OUTPUT.relative_to(ROOT)))
    parser.add_argument("--asset-dir", default=str(ASSET_OUTPUT.relative_to(ROOT)))
    parser.add_argument("--asset-prefix", default=ASSET_PREFIX)
    args = parser.parse_args()
    RUN = (ROOT / args.run).resolve()
    OUTPUT = (ROOT / args.output).resolve()
    ASSET_OUTPUT = (ROOT / args.asset_dir).resolve()
    ASSET_PREFIX = str(args.asset_prefix)
    for path, label in [(RUN, "run"), (OUTPUT, "output"), (ASSET_OUTPUT, "asset directory")]:
        if path != ROOT and ROOT not in path.parents:
            raise RuntimeError(f"AT7519 {label} must remain inside the repository")
    campaign, manifest, checkpoints = verify_freeze()
    # Freeze verification is complete.  Holdout paths are opened only below.
    review_bytes = REVIEW.read_bytes()
    review = json.loads(review_bytes)
    raw_hit_pdb = (SOURCE / "2VTA.pdb").read_text()
    translation, transform_residual = app_translation(checkpoints[0], raw_hit_pdb)
    review_by_pdb = {entry["pdbId"]: entry for entry in review["ligands"]}
    steps_by_id = {step["id"]: step for step in campaign["steps"]}
    results = []
    emitted = []
    ASSET_OUTPUT.mkdir(parents=True, exist_ok=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    for sequence_index, ((step_id, pdb_id, ligand_id, state_id), checkpoint) in enumerate(
            zip(HOLDOUTS, checkpoints), start=1):
        source_path = SOURCE / f"{pdb_id}.pdb"
        source_bytes = source_path.read_bytes()
        review_entry = review_by_pdb[pdb_id]
        if sha256_bytes(source_bytes) != review_entry["source"]["sha256"]:
            raise RuntimeError(f"Holdout source hash changed: {pdb_id}")
        if checkpoint["stepId"] != step_id or checkpoint["predictedStateId"] != state_id:
            raise RuntimeError(f"Checkpoint/holdout order changed at {pdb_id}")
        step = steps_by_id[step_id]
        product_elements, product_edges = product_graph(step["productSmiles"])
        product_names = step["productAtomNames"]
        predicted_by_name = {atom["atomName"]: atom for atom in checkpoint["ligand"]["atoms"]
                             if atom["element"] != "H"}
        predicted_app = [tuple(predicted_by_name[name]["coordinatesAngstrom"])
                         for name in product_names]
        predicted = [tuple(point[axis] - translation[axis] for axis in range(3))
                     for point in predicted_app]
        crystal_atoms, crystal_edges = pdb_atoms_and_graph(review_entry["ligandPdb"])
        mappings = graph_isomorphisms(crystal_atoms, crystal_edges,
                                      product_elements, product_edges)
        best = None
        for mapping in mappings:
            crystal_by_product: list[tuple | None] = [None] * len(product_elements)
            names_by_product: list[str | None] = [None] * len(product_elements)
            for crystal_index, product_index in mapping.items():
                crystal_by_product[product_index] = crystal_atoms[crystal_index]["coordinates"]
                names_by_product[product_index] = crystal_atoms[crystal_index]["name"]
            score = rmsd(list(range(len(product_elements))), predicted, crystal_by_product)
            if best is None or score < best[0]:
                best = (score, crystal_by_product, names_by_product, mapping)
        full_rmsd, crystal, crystal_names, mapping = best
        common = [entry["productAtomIndex"] for entry in step["posePropagationMap"]["commonAtoms"]]
        edited = [entry["productAtomIndex"] for entry in step["posePropagationMap"]["addedProductAtoms"]]
        centroid_offset = distance(centroid(predicted), centroid(crystal))
        aryl_carbonyl_torsion = affected_aryl_carbonyl_torsion(step, predicted, crystal)
        prediction_path = ASSET_OUTPUT / f"{ASSET_PREFIX}-{sequence_index:02d}-{state_id}-prediction-ligand.pdb"
        crystal_path = ASSET_OUTPUT / f"{ASSET_PREFIX}-{sequence_index:02d}-{state_id}-crystal-ligand.pdb"
        write_ligand_pdb(prediction_path, product_names, product_elements, predicted,
                         product_edges, "PRD", f"FROZEN HIT-ONLY PREDICTION {step_id}")
        write_ligand_pdb(crystal_path, crystal_names, product_elements, crystal,
                         product_edges, "XTL", f"POST-FREEZE HOLDOUT {pdb_id}/{ligand_id} ALIGNED TO 2VTA")
        for path, role in [(prediction_path, "prediction"), (crystal_path, "holdout")]:
            emitted.append({"path": str(path.relative_to(ROOT)), "role": role,
                            "sha256": sha256(path), "bytes": path.stat().st_size})
        results.append({
            "sequenceIndex": sequence_index,
            "stepId": step_id, "stateId": state_id,
            "holdout": {"pdbId": pdb_id, "ligandId": ligand_id,
                        "sourcePath": str(source_path.relative_to(ROOT)),
                        "sourceSha256": sha256_bytes(source_bytes),
                        "alignedProteinCaRmsdAngstrom": review_entry["alignment"]["rmsdAngstrom"]},
            "predictionCheckpointSha256": manifest["checkpoints"][sequence_index - 1]["sha256"],
            "matching": {"method": "element-labelled full-graph isomorphism",
                         "symmetryMappingsEvaluated": len(mappings),
                         "selection": "minimum all-heavy-atom RMSD after receptor-only alignment"},
            "metrics": {
                "heavyAtomCount": len(product_elements),
                "allHeavyAtomRmsdAngstrom": round(full_rmsd, 6),
                "preservedAtomRmsdAngstrom": round(rmsd(common, predicted, crystal), 6),
                "newAtomRmsdAngstrom": round(rmsd(edited, predicted, crystal), 6),
                "centroidOffsetAngstrom": round(centroid_offset, 6),
                "affectedArylCarbonylTorsion": aryl_carbonyl_torsion,
            },
            "assets": {"prediction": str(prediction_path.relative_to(ROOT)),
                       "holdout": str(crystal_path.relative_to(ROOT))},
        })

    payload = {
        "schema": "molarium.at7519-holdout-evaluation/v1",
        "campaignId": "cdk2-at7519-hit-only",
        "status": "post-freeze-evaluated",
        "scientificStatus": "protocol-isolated prospective replay; deposited structures were known to the broader project but inaccessible to the prediction process",
        "freezeProof": {
            "predictionManifest": str((RUN / "prediction-manifest.json").relative_to(ROOT)),
            "predictionManifestSha256": sha256(RUN / "prediction-manifest.json"),
            "agentAuditSha256": manifest["agentApi"]["auditSha256"],
            "checkpointSha256": [entry["sha256"] for entry in manifest["checkpoints"]],
            "holdoutCoordinateReadsBeforeFreeze": 0,
        },
        "coordinateFrames": {
            "predictionFrame": "Molarium centered 2VTA frame",
            "evaluationFrame": "raw 2VTA frame",
            "predictionToEvaluationTranslationAngstrom": [round(value, 12) for value in translation],
            "translationFitResidualAngstrom": transform_residual,
            "holdoutAlignment": "whole-chain C-alpha least-squares alignment to 2VTA, from hash-pinned preapproval review",
        },
        "review": {"path": str(REVIEW.relative_to(ROOT)),
                   "sha256": sha256_bytes(review_bytes)},
        "results": results,
        "emittedAssets": emitted,
        "limitations": [
            "This is a protocol-isolated replay, not a historically blinded prediction experiment.",
            "RMSDs are receptor-aligned and corrected only for exact ligand graph symmetries; no ligand fitting is applied.",
            "The receptor is intentionally fixed to 2VTA, so the experiment tests placement without receptor rearrangement.",
            "Compound 23 is more biochemically potent against CDK2 than AT7519; the last decision is a cellular/PK/profile optimization, not a monotonic potency gain.",
        ],
    }
    OUTPUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {OUTPUT.relative_to(ROOT)} after verified prediction freeze")
    for result in results:
        metrics = result["metrics"]
        print(f"{result['stepId']}: RMSD {metrics['allHeavyAtomRmsdAngstrom']:.3f} A; "
              f"new atoms {metrics['newAtomRmsdAngstrom']:.3f} A")


if __name__ == "__main__":
    main()
