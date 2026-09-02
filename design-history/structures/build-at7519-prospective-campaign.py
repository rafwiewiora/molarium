#!/usr/bin/env python3
"""Build the AT7519/CDK2 protocol-isolated prospective replay.

Only PDB 2VTA is opened by this builder.  Compounds 15, 18, 22, 23, and 33
enter as reported molecular graphs.  Their deposited structures are evaluation
holdouts and are deliberately absent from the campaign until all five poses
have been frozen.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

from rdkit import Chem, rdBase
from rdkit.Chem import rdFMCS


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
HIT_PDB = ROOT / "outputs" / "design-history" / "at7519-preapproval" / "source" / "2VTA.pdb"
GENERATED = HERE / "generated"
PROTEIN_OUTPUT = GENERATED / "at7519-2vta-protein.pdb"
LIGAND_OUTPUT = GENERATED / "at7519-2vta-ligand.pdb"
CAMPAIGN_OUTPUT = GENERATED / "at7519-prospective-campaign.json"

GRAPHS = [
    ("compound-6", "c1ccc2[nH]ncc2c1"),
    ("compound-15", "O=C(Nc1ccccc1)c1cc[nH]n1"),
    ("compound-18", "CC(=O)Nc1c(C(=O)Nc2ccc(F)cc2)n[nH]c1"),
    ("compound-22", "O=C(c1ccccc1)Nc1c(C(=O)Nc2ccc(F)cc2)n[nH]c1"),
    ("compound-23", "O=C(c1c(F)cccc1F)Nc1c(C(=O)Nc2ccc(F)cc2)n[nH]c1"),
    ("compound-33", "O=C(c1c(Cl)cccc1Cl)Nc1c(C(=O)NC2CCNCC2)n[nH]c1"),
]

HIT_ATOM_NAMES = ["C1", "C2", "C3", "C4", "C5", "C6", "N", "C9", "N2"]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_molecule(smiles: str) -> tuple[str, Chem.Mol]:
    parsed = Chem.MolFromSmiles(smiles)
    if parsed is None:
        raise RuntimeError(f"Invalid registered graph: {smiles}")
    canonical = Chem.MolToSmiles(parsed, canonical=True, isomericSmiles=True)
    molecule = Chem.MolFromSmiles(canonical)
    if molecule is None:
        raise RuntimeError(f"Unable to reload canonical graph: {canonical}")
    return canonical, molecule


def mcs_matches(reference: Chem.Mol, product: Chem.Mol) -> tuple:
    result = rdFMCS.FindMCS(
        [reference, product], timeout=30,
        atomCompare=rdFMCS.AtomCompare.CompareElements,
        bondCompare=rdFMCS.BondCompare.CompareOrder,
        ringMatchesRingOnly=True, completeRingsOnly=True,
        matchValences=False, matchChiralTag=False,
    )
    if result.canceled:
        raise RuntimeError("AT7519 graph MCS timed out; a partial map is forbidden")
    query = Chem.MolFromSmarts(result.smartsString)
    reference_matches = reference.GetSubstructMatches(
        query, uniquify=False, useChirality=False, maxMatches=4096)
    product_matches = product.GetSubstructMatches(
        query, uniquify=False, useChirality=False, maxMatches=4096)
    if not reference_matches or not product_matches:
        raise RuntimeError("AT7519 graph MCS has no complete match")
    return result, reference_matches, product_matches


def assigned_product_names(product: Chem.Mol, common: list[dict]) -> list[str]:
    names: list[str | None] = [None] * product.GetNumAtoms()
    for entry in common:
        names[entry["productAtomIndex"]] = entry["referenceAtomName"]
    used = {name for name in names if name}
    counters: dict[str, int] = {}
    for index, atom in enumerate(product.GetAtoms()):
        if names[index]:
            continue
        symbol = atom.GetSymbol().upper()
        while True:
            counters[symbol] = counters.get(symbol, 0) + 1
            candidate = f"{symbol}X{counters[symbol]}"
            if candidate not in used:
                break
        names[index] = candidate
        used.add(candidate)
    return [str(name) for name in names]


def map_payload(reference: Chem.Mol, reference_names: list[str], product: Chem.Mol,
                pairs: list[tuple[int, int]], source: str, mcs: dict) -> tuple[dict, list[str]]:
    mapped_reference = {pair[0] for pair in pairs}
    mapped_product = {pair[1] for pair in pairs}
    if len(mapped_reference) != len(pairs) or len(mapped_product) != len(pairs):
        raise RuntimeError("Pose map is not one-to-one")
    common = []
    for reference_index, product_index in pairs:
        reference_atom = reference.GetAtomWithIdx(reference_index)
        product_atom = product.GetAtomWithIdx(product_index)
        if reference_atom.GetSymbol() != product_atom.GetSymbol():
            raise RuntimeError("Pose map changes an element")
        common.append({
            "referenceAtomIndex": reference_index,
            "referenceAtomName": reference_names[reference_index],
            "productAtomIndex": product_index,
            "element": reference_atom.GetSymbol(),
        })
    common.sort(key=lambda entry: entry["referenceAtomIndex"])
    deleted = [{
        "referenceAtomIndex": index,
        "referenceAtomName": reference_names[index],
        "element": reference.GetAtomWithIdx(index).GetSymbol(),
    } for index in range(reference.GetNumAtoms()) if index not in mapped_reference]
    added = [{
        "productAtomIndex": index,
        "element": product.GetAtomWithIdx(index).GetSymbol(),
    } for index in range(product.GetNumAtoms()) if index not in mapped_product]
    reference_boundary = []
    for bond in reference.GetBonds():
        first, second = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
        if (first in mapped_reference) == (second in mapped_reference):
            continue
        common_index, edited_index = (first, second) if first in mapped_reference else (second, first)
        reference_boundary.append({
            "commonAtomName": reference_names[common_index],
            "editedAtomName": reference_names[edited_index],
            "bondType": str(bond.GetBondType()),
        })
    product_boundary = []
    for bond in product.GetBonds():
        first, second = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
        if (first in mapped_product) == (second in mapped_product):
            continue
        common_index, edited_index = (first, second) if first in mapped_product else (second, first)
        product_boundary.append({
            "commonProductAtomIndex": common_index,
            "editedProductAtomIndex": edited_index,
            "bondType": str(bond.GetBondType()),
        })
    names = assigned_product_names(product, common)
    return ({
        "source": source,
        "referenceHeavyAtoms": reference.GetNumAtoms(),
        "productHeavyAtoms": product.GetNumAtoms(),
        "commonHeavyAtoms": len(common),
        "commonReferenceFraction": round(len(common) / reference.GetNumAtoms(), 6),
        "commonProductFraction": round(len(common) / product.GetNumAtoms(), 6),
        "mcs": mcs,
        "commonAtoms": common,
        "deletedReferenceAtoms": deleted,
        "addedProductAtoms": added,
        "referenceBoundary": reference_boundary,
        "productBoundary": product_boundary,
    }, names)


def exact_pose_map(reference: Chem.Mol, reference_names: list[str],
                   product: Chem.Mol) -> tuple[dict, list[str]]:
    result, reference_matches, product_matches = mcs_matches(reference, product)
    reference_match, product_match = min(
        (r, p) for r in reference_matches for p in product_matches)
    return map_payload(
        reference, reference_names, product,
        list(zip(reference_match, product_match)),
        "reported molecular graphs only; no later coordinates",
        {"smarts": result.smartsString, "atoms": result.numAtoms, "bonds": result.numBonds},
    )


def aromatic_n(molecule: Chem.Mol, hydrogen: bool) -> int:
    found = [atom.GetIdx() for atom in molecule.GetAtoms()
             if atom.GetSymbol() == "N" and atom.GetIsAromatic()
             and bool(atom.GetTotalNumHs()) == hydrogen]
    if len(found) != 1:
        raise RuntimeError(f"Expected one aromatic N (hydrogen={hydrogen}), found {found}")
    return found[0]


def ordered_pyrazole(molecule: Chem.Mol) -> list[int]:
    """Return [nH, n, adjacent-C, next-C, other-C] for the hinge five-ring."""
    nh = aromatic_n(molecule, True)
    n = aromatic_n(molecule, False)
    if not molecule.GetBondBetweenAtoms(nh, n):
        raise RuntimeError("Registered hinge nitrogens are no longer adjacent")
    carbon_after_n = next(
        atom.GetIdx() for atom in molecule.GetAtomWithIdx(n).GetNeighbors()
        if atom.GetIdx() != nh and atom.GetSymbol() == "C")
    carbon_after_nh = next(
        atom.GetIdx() for atom in molecule.GetAtomWithIdx(nh).GetNeighbors()
        if atom.GetIdx() != n and atom.GetSymbol() == "C")
    path = Chem.rdmolops.GetShortestPath(molecule, carbon_after_n, carbon_after_nh)
    if len(path) != 3:
        raise RuntimeError(f"Unexpected hinge-ring carbon path: {path}")
    return [nh, n, path[0], path[1], path[2]]


def scaffold_hop_map(reference: Chem.Mol, reference_names: list[str],
                     product: Chem.Mol) -> tuple[dict, list[str]]:
    hit_ring = ordered_pyrazole(reference)
    product_ring = ordered_pyrazole(product)
    pairs = list(zip(hit_ring, product_ring))
    return map_payload(
        reference, reference_names, product, pairs,
        "designer-declared hinge pyrazole correspondence from the 2VTA hit pose plus reported product graph; no later coordinates",
        {"method": "curated-five-membered-hinge-ring", "atoms": 5, "bonds": 5},
    )


def hit_graph_atom_names(reference: Chem.Mol) -> list[str]:
    full = Chem.MolFromPDBFile(str(HIT_PDB), removeHs=True, sanitize=False)
    if full is None:
        raise RuntimeError("Unable to parse the 2VTA hit PDB")
    selected = []
    selected_names = []
    for atom in full.GetAtoms():
        info = atom.GetPDBResidueInfo()
        if (info and info.GetResidueName().strip() == "LZ1"
                and info.GetChainId().strip() == "A"
                and info.GetResidueNumber() == 1301):
            selected.append(atom.GetIdx())
            selected_names.append(info.GetName().strip())
    if selected_names != HIT_ATOM_NAMES:
        raise RuntimeError(f"The audited 2VTA/LZ1 atom order changed: {selected_names}")
    fragment = Chem.RWMol()
    old_to_new = {}
    for old_index in selected:
        old_to_new[old_index] = fragment.AddAtom(Chem.Atom(full.GetAtomWithIdx(old_index).GetAtomicNum()))
    for bond in full.GetBonds():
        first, second = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
        if first in old_to_new and second in old_to_new:
            fragment.AddBond(old_to_new[first], old_to_new[second], Chem.BondType.SINGLE)
    pdb_graph = fragment.GetMol()
    result = rdFMCS.FindMCS(
        [pdb_graph, reference], timeout=30,
        atomCompare=rdFMCS.AtomCompare.CompareElements,
        bondCompare=rdFMCS.BondCompare.CompareAny,
        ringMatchesRingOnly=False, completeRingsOnly=False,
    )
    if result.canceled or result.numAtoms != reference.GetNumAtoms():
        raise RuntimeError("The 2VTA ligand topology does not match its registered graph")
    query = Chem.MolFromSmarts(result.smartsString)
    candidates = []
    for pdb_match in pdb_graph.GetSubstructMatches(query, uniquify=False, maxMatches=4096):
        for reference_match in reference.GetSubstructMatches(query, uniquify=False, maxMatches=4096):
            names: list[str | None] = [None] * reference.GetNumAtoms()
            for pdb_index, reference_index in zip(pdb_match, reference_match):
                names[reference_index] = HIT_ATOM_NAMES[pdb_index]
            if any(name is None for name in names):
                continue
            # Fix the hinge orientation: the protonated hit N is named N and
            # the acceptor is N2 in the audited 2VTA residue.
            if names[aromatic_n(reference, True)] == "N" and names[aromatic_n(reference, False)] == "N2":
                candidates.append([str(name) for name in names])
    if not candidates:
        raise RuntimeError("Unable to preserve the audited 2VTA hinge-N identities")
    return min(candidates)


def ligand_definition(reference: Chem.Mol, reference_names: list[str]) -> dict:
    molecule = Chem.AddHs(reference)
    names = list(reference_names)
    names.extend(f"H{index + 1}" for index in range(molecule.GetNumAtoms() - len(names)))
    atoms = [{
        "id": names[index], "element": atom.GetSymbol(),
        "charge": atom.GetFormalCharge(), "aromatic": atom.GetIsAromatic(),
        "leaving": False, "x": 0, "y": 0, "z": 0,
    } for index, atom in enumerate(molecule.GetAtoms())]
    bonds = [{
        "a": names[bond.GetBeginAtomIdx()], "b": names[bond.GetEndAtomIdx()],
        "order": 1.5 if bond.GetIsAromatic() else float(bond.GetBondTypeAsDouble()),
        "aromatic": bond.GetIsAromatic(),
    } for bond in molecule.GetBonds()]
    return {"id": "LZ1", "source": "registered 2VTA/LZ1 graph with RDKit-added hydrogens",
            "atoms": atoms, "bonds": bonds}


def pdb_point(line: str) -> tuple[float, float, float]:
    return (float(line[30:38]), float(line[38:46]), float(line[46:54]))


def extract_hit_assets() -> None:
    lines = HIT_PDB.read_text().splitlines()
    ligand_lines = [line for line in lines if line.startswith("HETATM")
                    and line[17:20].strip() == "LZ1"
                    and line[21:22].strip() == "A"
                    and int(line[22:26]) == 1301]
    if len(ligand_lines) != 9:
        raise RuntimeError(f"Expected 9 hit ligand atoms, found {len(ligand_lines)}")
    if [line[12:16].strip() for line in ligand_lines] != HIT_ATOM_NAMES:
        raise RuntimeError("The audited 2VTA/LZ1 atom order changed")
    ligand_points = [pdb_point(line) for line in ligand_lines]
    protein_lines = []
    for line in lines:
        if line.startswith("ATOM") and line[21:22].strip() == "A":
            protein_lines.append(line)
            continue
        if not line.startswith("HETATM") or line[21:22].strip() != "A":
            continue
        if line[17:20].strip() == "HOH":
            point = pdb_point(line)
            if min(math.dist(point, ligand) for ligand in ligand_points) <= 6.0:
                protein_lines.append(line)
    GENERATED.mkdir(parents=True, exist_ok=True)
    PROTEIN_OUTPUT.write_text("\n".join([
        "REMARK 950 DERIVED ONLY FROM PDB 2VTA MODEL 1",
        "REMARK 950 CDK2 CHAIN A; WATERS WITHIN 6 A OF HIT LZ1 RETAINED",
        *protein_lines, "END", "",
    ]))
    LIGAND_OUTPUT.write_text("\n".join([
        "REMARK 950 EXACT PDB 2VTA LIGAND LZ1 CHAIN A RESIDUE 1301",
        *ligand_lines, "END", "",
    ]))


def main() -> None:
    canonical = [canonical_molecule(smiles) for _, smiles in GRAPHS]
    smiles = [entry[0] for entry in canonical]
    molecules = [entry[1] for entry in canonical]
    if molecules[0].GetNumAtoms() != len(HIT_ATOM_NAMES):
        raise RuntimeError("The registered LZ1 graph no longer matches the hit PDB")
    names = [hit_graph_atom_names(molecules[0])]
    maps = []
    first_map, first_names = scaffold_hop_map(molecules[0], names[0], molecules[1])
    maps.append(first_map)
    names.append(first_names)
    for index in range(1, 5):
        mapping, product_names = exact_pose_map(molecules[index], names[index], molecules[index + 1])
        maps.append(mapping)
        names.append(product_names)
    expected_common = [5, 14, 18, 24, 18]
    actual_common = [mapping["commonHeavyAtoms"] for mapping in maps]
    if actual_common != expected_common:
        raise RuntimeError(f"Registered AT7519 edit topology changed: {actual_common}")
    extract_hit_assets()
    definitions = [
        ("scaffold-hop", "compound-15", "indazole-to-pyrazole scaffold hop with amide-vector placement"),
        ("grow-acetamide", "compound-18", "install the pyrazole acetamide and para-fluorophenyl vector"),
        ("grow-benzamide", "compound-22", "replace acetyl with a pocket-filling benzamide"),
        ("lock-difluoro-torsion", "compound-23", "add the 2,6-difluoro torsional lock"),
        ("finish-at7519", "compound-33", "swap the terminal aryl group for piperidine and fluorines for chlorines"),
    ]
    steps = []
    for index, (step_id, state_id, label) in enumerate(definitions):
        steps.append({
            "id": step_id,
            "sequenceIndex": index + 1,
            "referenceStateId": GRAPHS[index][0],
            "stateId": state_id,
            "label": label,
            "inputKind": "molecular-graph-only",
            "productSmiles": smiles[index + 1],
            "productAtomNames": names[index + 1],
            "posePropagationMap": maps[index],
        })
    payload = {
        "schema": "molarium.design-campaign/v1",
        "id": "cdk2-at7519-hit-only",
        "title": "AT7519 five-decision hit-only prospective replay",
        "protocolBoundary": {
            "coordinateInputs": ["PDB 2VTA protein", "PDB 2VTA ligand LZ1 (compound 6)"],
            "allowedLaterInputs": ["reported compound molecular graphs for 15, 18, 22, 23, and 33"],
            "forbiddenBeforeFreeze": [
                "later protein coordinates",
                "later ligand coordinates",
                "later-structure scaffold constraints",
                "holdout-guided pose selection",
            ],
            "sequenceRule": "Each step starts from the preceding frozen prediction; no later crystal becomes a pose reference.",
        },
        "hit": {
            "pdbId": "2VTA", "stateId": "compound-6", "ligand": "LZ1",
            "canonicalSmiles": smiles[0],
            "proteinAsset": "./design-history/structures/generated/at7519-2vta-protein.pdb",
            "ligandAsset": "./design-history/structures/generated/at7519-2vta-ligand.pdb",
            "proteinSha256": sha256(PROTEIN_OUTPUT),
            "ligandSha256": sha256(LIGAND_OUTPUT),
            "ligandDefinition": ligand_definition(molecules[0], names[0]),
        },
        "steps": steps,
        "source": {
            "article": "Identification of N-(4-piperidinyl)-4-(2,6-dichlorobenzoylamino)-1H-pyrazole-3-carboxamide (AT7519), a novel cyclin dependent kinase inhibitor using fragment-based X-ray crystallography and structure based drug design",
            "doi": "10.1021/jm800382h",
            "graphRole": "reported compound identities only",
        },
        "generator": {
            "path": "design-history/structures/build-at7519-prospective-campaign.py",
            "rdkitVersion": rdBase.rdkitVersion,
            "coordinateFilesRead": ["outputs/design-history/at7519-preapproval/source/2VTA.pdb"],
        },
        "evaluation": {"status": "locked-until-predictions-frozen", "holdouts": []},
    }
    CAMPAIGN_OUTPUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {CAMPAIGN_OUTPUT.relative_to(ROOT)} with {len(steps)} graph-only decisions")
    print("Common heavy atoms:", actual_common)


if __name__ == "__main__":
    main()
