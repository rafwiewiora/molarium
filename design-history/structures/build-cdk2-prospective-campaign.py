#!/usr/bin/env python3
"""Build the registered hit-only CDK2 prospective campaign.

The only coordinate-bearing source opened here is PDB 1H1Q.  The two later
compounds contribute molecular graphs from the cited medicinal-chemistry
series.  Their deposited structures are deliberately absent: 1H1R and 1OIU
are evaluation holdouts that may be opened only after predictions are frozen.
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
HIT_PDB = ROOT / "docking" / "benchmark" / "fixtures" / "pdb" / "1h1q.pdb"
GENERATED = HERE / "generated"
PROTEIN_OUTPUT = GENERATED / "cdk2-1h1q-protein.pdb"
LIGAND_OUTPUT = GENERATED / "cdk2-1h1q-ligand.pdb"
CAMPAIGN_OUTPUT = GENERATED / "cdk2-prospective-campaign.json"
DESIGNER_CAMPAIGN_OUTPUT = GENERATED / "cdk2-designer-campaign.json"
REGISTERED_DESIGN_ROUTE_SCHEMA = "molarium.registered-design-route/v1"
EXPECTED_RDKIT_VERSION = "2026.03.4"

HIT_SMILES = "c1ccc(Nc2nc(OCC3CCCCC3)c3[nH]cnc3n2)cc1"
CHLORO_SMILES = "Clc1cccc(Nc2nc(OCC3CCCCC3)c3[nH]cnc3n2)c1"
SULFONAMIDE_SMILES = "NS(=O)(=O)c1cccc(Nc2nc(OCC3CCCCC3)c3nc[nH]c3n2)c1"

# The heavy-atom order is the audited 2A6 order in the hit PDB.  This is hit
# identity, not information from either holdout structure.
HIT_ATOM_NAMES = [
    "C2", "C8", "C10", "C11", "C12", "C13", "C14", "C15", "C16",
    "C19", "C20", "C21", "C22", "N1", "C6", "O6", "C5", "N7",
    "N9", "C4", "N3", "N2", "C17", "C18",
]


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


def exact_mcs(reference: Chem.Mol, product: Chem.Mol) -> tuple:
    result = rdFMCS.FindMCS(
        [reference, product], timeout=30,
        atomCompare=rdFMCS.AtomCompare.CompareElements,
        bondCompare=rdFMCS.BondCompare.CompareOrder,
        ringMatchesRingOnly=True, completeRingsOnly=True,
        matchValences=False, matchChiralTag=False,
    )
    if result.canceled:
        raise RuntimeError("CDK2 graph MCS timed out; a partial map is forbidden")
    query = Chem.MolFromSmarts(result.smartsString)
    reference_matches = reference.GetSubstructMatches(
        query, uniquify=False, useChirality=False, maxMatches=4096)
    product_matches = product.GetSubstructMatches(
        query, uniquify=False, useChirality=False, maxMatches=4096)
    if not reference_matches or not product_matches:
        raise RuntimeError("CDK2 graph MCS has no complete match")
    return result, reference_matches, product_matches


def assigned_product_names(product: Chem.Mol, common: list[dict]) -> list[str]:
    names: list[str | None] = [None] * product.GetNumAtoms()
    for entry in common:
        names[entry["productAtomIndex"]] = entry["referenceAtomName"]
    element_counts: dict[str, int] = {}
    used = {name for name in names if name}
    for index, atom in enumerate(product.GetAtoms()):
        if names[index]:
            continue
        symbol = atom.GetSymbol().upper()
        while True:
            element_counts[symbol] = element_counts.get(symbol, 0) + 1
            candidate = f"{symbol}X{element_counts[symbol]}"
            if candidate not in used:
                break
        names[index] = candidate
        used.add(candidate)
    return [str(name) for name in names]


def pose_map(reference: Chem.Mol, reference_names: list[str],
             product: Chem.Mol, step_id: str,
             preferred_attachment_reference_name: str | None = None) -> tuple[dict, list[str]]:
    if len(reference_names) != reference.GetNumAtoms():
        raise RuntimeError(f"{step_id}: reference name count changed")
    result, reference_matches, product_matches = exact_mcs(reference, product)
    candidates = []
    for reference_match in reference_matches:
        for product_match in product_matches:
            mapped_product = set(product_match)
            added_product = set(range(product.GetNumAtoms())) - mapped_product
            boundary_common = []
            for bond in product.GetBonds():
                first, second = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
                if (first in mapped_product) == (second in mapped_product):
                    continue
                boundary_common.append(first if first in mapped_product else second)
            attachment_names = []
            for product_index in boundary_common:
                query_index = product_match.index(product_index)
                attachment_names.append(reference_names[reference_match[query_index]])
            if preferred_attachment_reference_name is not None \
                    and preferred_attachment_reference_name not in attachment_names:
                continue
            candidates.append((reference_match, product_match, tuple(sorted(added_product))))
    if not candidates:
        raise RuntimeError(
            f"{step_id}: no exact map grows from {preferred_attachment_reference_name}")
    reference_match, product_match, _ = min(candidates)
    mapped_reference = set(reference_match)
    mapped_product = set(product_match)
    common = []
    for reference_index, product_index in zip(reference_match, product_match):
        reference_atom = reference.GetAtomWithIdx(reference_index)
        product_atom = product.GetAtomWithIdx(product_index)
        if reference_atom.GetSymbol() != product_atom.GetSymbol():
            raise RuntimeError(f"{step_id}: element-changing common atom")
        common.append({
            "referenceAtomIndex": reference_index,
            "referenceAtomName": reference_names[reference_index],
            "productAtomIndex": product_index,
            "element": reference_atom.GetSymbol(),
        })
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
        common_index, edited_index = (
            (first, second) if first in mapped_reference else (second, first))
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
        common_index, edited_index = (
            (first, second) if first in mapped_product else (second, first))
        product_boundary.append({
            "commonProductAtomIndex": common_index,
            "editedProductAtomIndex": edited_index,
            "bondType": str(bond.GetBondType()),
        })
    product_names = assigned_product_names(product, common)
    return ({
        "source": "registered molecular graphs plus designer-selected hit exit vector; no later coordinates"
        if preferred_attachment_reference_name else
        "registered molecular graphs only; no later coordinates",
        "referenceHeavyAtoms": reference.GetNumAtoms(),
        "productHeavyAtoms": product.GetNumAtoms(),
        "commonHeavyAtoms": len(common),
        "commonReferenceFraction": round(len(common) / reference.GetNumAtoms(), 6),
        "commonProductFraction": round(len(common) / product.GetNumAtoms(), 6),
        "mcs": {"smarts": result.smartsString, "atoms": result.numAtoms,
                "bonds": result.numBonds},
        "commonAtoms": common,
        "deletedReferenceAtoms": deleted,
        "addedProductAtoms": added,
        "referenceBoundary": reference_boundary,
        "productBoundary": product_boundary,
    }, product_names)


def hit_graph_atom_names(reference: Chem.Mol) -> list[str]:
    full = Chem.MolFromPDBFile(str(HIT_PDB), removeHs=True, sanitize=False)
    if full is None:
        raise RuntimeError("Unable to parse the 1H1Q hit PDB")
    selected = []
    for atom in full.GetAtoms():
        info = atom.GetPDBResidueInfo()
        if (info and info.GetResidueName().strip() == "2A6"
                and info.GetChainId().strip() == "A"
                and info.GetResidueNumber() == 1298):
            selected.append(atom.GetIdx())
    if len(selected) != len(HIT_ATOM_NAMES):
        raise RuntimeError("The selected 1H1Q/2A6 graph changed")
    fragment = Chem.RWMol()
    old_to_new = {}
    for old_index in selected:
        old_to_new[old_index] = fragment.AddAtom(
            Chem.Atom(full.GetAtomWithIdx(old_index).GetAtomicNum()))
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
        raise RuntimeError("The 1H1Q ligand topology does not match its registered graph")
    query = Chem.MolFromSmarts(result.smartsString)
    pdb_match = min(pdb_graph.GetSubstructMatches(query, uniquify=True, maxMatches=4096))
    reference_match = min(reference.GetSubstructMatches(
        query, uniquify=True, maxMatches=4096))
    names: list[str | None] = [None] * reference.GetNumAtoms()
    for pdb_index, reference_index in zip(pdb_match, reference_match):
        names[reference_index] = HIT_ATOM_NAMES[pdb_index]
    if any(name is None for name in names):
        raise RuntimeError("The 1H1Q ligand atom-name map is incomplete")
    return [str(name) for name in names]


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
    return {"id": "2A6", "source": "registered 1H1Q/2A6 graph with RDKit-added hydrogens",
            "atoms": atoms, "bonds": bonds}


def pdb_point(line: str) -> tuple[float, float, float]:
    return (float(line[30:38]), float(line[38:46]), float(line[46:54]))


def extract_hit_assets() -> None:
    lines = HIT_PDB.read_text().splitlines()
    ligand_lines = [line for line in lines if line.startswith("HETATM")
                    and line[17:20].strip() == "2A6"
                    and line[21:22].strip() == "A"
                    and int(line[22:26]) == 1298]
    if len(ligand_lines) != 24:
        raise RuntimeError(f"Expected 24 hit ligand atoms, found {len(ligand_lines)}")
    if [line[12:16].strip() for line in ligand_lines] != HIT_ATOM_NAMES:
        raise RuntimeError("The audited 1H1Q/2A6 atom order changed")
    ligand_points = [pdb_point(line) for line in ligand_lines]
    protein_lines = []
    for line in lines:
        if line.startswith("ATOM") and line[21:22].strip() == "A":
            protein_lines.append(line)
            continue
        if not line.startswith("HETATM") or line[21:22].strip() != "A":
            continue
        residue = line[17:20].strip()
        if residue == "TPO":
            # PDB records modified amino acids as HETATM.  Molarium supports
            # covalent TPO explicitly, so retain the exact atoms while marking
            # them as part of the protein chain for topology construction.
            protein_lines.append("ATOM  " + line[6:])
        elif residue == "HOH":
            point = pdb_point(line)
            if min(math.dist(point, ligand) for ligand in ligand_points) <= 6.0:
                protein_lines.append(line)
    GENERATED.mkdir(parents=True, exist_ok=True)
    header = [
        "REMARK 950 DERIVED ONLY FROM PDB 1H1Q MODEL 1",
        "REMARK 950 CDK2 CHAIN A; WATERS WITHIN 6 A OF HIT 2A6 RETAINED",
    ]
    PROTEIN_OUTPUT.write_text("\n".join([*header, *protein_lines, "END", ""]) )
    LIGAND_OUTPUT.write_text("\n".join([
        "REMARK 950 EXACT PDB 1H1Q LIGAND 2A6 CHAIN A RESIDUE 1298",
        *ligand_lines, "END", "",
    ]))


def main() -> None:
    if rdBase.rdkitVersion != EXPECTED_RDKIT_VERSION:
        raise RuntimeError(
            f"This deterministic builder requires RDKit {EXPECTED_RDKIT_VERSION}; "
            f"found {rdBase.rdkitVersion}")
    hit_smiles, hit = canonical_molecule(HIT_SMILES)
    chloro_smiles, chloro = canonical_molecule(CHLORO_SMILES)
    sulfonamide_smiles, sulfonamide = canonical_molecule(SULFONAMIDE_SMILES)
    if hit.GetNumAtoms() != len(HIT_ATOM_NAMES):
        raise RuntimeError("The registered 2A6 graph no longer matches the hit PDB")
    hit_names = hit_graph_atom_names(hit)
    map_chloro, chloro_names = pose_map(hit, hit_names, chloro, "add-meta-chloro")
    map_sulfonamide, sulfonamide_names = pose_map(
        chloro, chloro_names, sulfonamide, "replace-chloro-with-sulfonamide")
    designer_map_chloro, designer_chloro_names = pose_map(
        hit, hit_names, chloro, "add-meta-chloro", "C19")
    designer_map_sulfonamide, designer_sulfonamide_names = pose_map(
        chloro, designer_chloro_names, sulfonamide,
        "replace-chloro-with-sulfonamide", "C19")
    if map_chloro["commonHeavyAtoms"] != 24 or map_sulfonamide["commonHeavyAtoms"] != 24:
        raise RuntimeError("The registered CDK2 common scaffold changed")
    extract_hit_assets()
    steps = [
        {
            "id": "add-meta-chloro", "sequenceIndex": 1,
            "referenceStateId": "2A6", "stateId": "6CP",
            "label": "add a meta chlorine", "inputKind": "molecular-graph-only",
            "productSmiles": chloro_smiles, "productAtomNames": chloro_names,
            "posePropagationMap": map_chloro,
        },
        {
            "id": "replace-chloro-with-sulfonamide", "sequenceIndex": 2,
            "referenceStateId": "6CP", "stateId": "N76",
            "label": "replace chlorine with sulfonamide",
            "inputKind": "molecular-graph-only",
            "productSmiles": sulfonamide_smiles,
            "productAtomNames": sulfonamide_names,
            "posePropagationMap": map_sulfonamide,
        },
    ]
    payload = {
        "schema": REGISTERED_DESIGN_ROUTE_SCHEMA,
        "id": "cdk2-hit-only",
        "title": "CDK2 rigid-pocket hit-only prospective replay",
        "protocolBoundary": {
            "coordinateInputs": ["PDB 1H1Q protein", "PDB 1H1Q ligand 2A6"],
            "allowedLaterInputs": ["reported compound molecular graphs"],
            "forbiddenBeforeFreeze": [
                "later protein coordinates", "later ligand coordinates",
                "later-structure scaffold constraints", "holdout-guided candidate selection",
            ],
            "sequenceRule": "Each step starts from the preceding frozen prediction; no later crystal becomes a reference.",
        },
        "hit": {
            "pdbId": "1H1Q", "stateId": "2A6", "ligand": "2A6",
            "canonicalSmiles": hit_smiles,
            "proteinAsset": "./design-history/structures/generated/cdk2-1h1q-protein.pdb",
            "ligandAsset": "./design-history/structures/generated/cdk2-1h1q-ligand.pdb",
            "proteinSha256": sha256(PROTEIN_OUTPUT),
            "ligandSha256": sha256(LIGAND_OUTPUT),
            "ligandDefinition": ligand_definition(hit, hit_names),
        },
        "steps": steps,
        "source": {
            "article": "Structure-based design of a potent purine-based cyclin-dependent kinase inhibitor",
            "doi": "10.1038/nsb842",
            "graphRole": "reported compound identities only",
        },
        "generator": {
            "path": "design-history/structures/build-cdk2-prospective-campaign.py",
            "rdkitVersion": rdBase.rdkitVersion,
            "coordinateFilesRead": ["docking/benchmark/fixtures/pdb/1h1q.pdb"],
        },
        "evaluation": {"status": "locked-until-predictions-frozen", "holdouts": []},
    }
    CAMPAIGN_OUTPUT.write_text(json.dumps(payload, indent=2) + "\n")
    designer_steps = [
        {
            "id": "add-meta-chloro", "sequenceIndex": 1,
            "referenceStateId": "2A6", "stateId": "6CP",
            "label": "grow chlorine from the designer-selected meta carbon",
            "inputKind": "designer-directed-graph-only",
            "productSmiles": chloro_smiles,
            "productAtomNames": designer_chloro_names,
            "posePropagationMap": designer_map_chloro,
            "spatialIntent": {
                "method": "selected-exit-vector",
                "attachmentReferenceAtomName": "C19",
                "declaredBeforePoseSearch": True,
            },
        },
        {
            "id": "replace-chloro-with-sulfonamide", "sequenceIndex": 2,
            "referenceStateId": "6CP", "stateId": "N76",
            "label": "grow sulfonamide from the same selected meta carbon",
            "inputKind": "designer-directed-graph-only",
            "productSmiles": sulfonamide_smiles,
            "productAtomNames": designer_sulfonamide_names,
            "posePropagationMap": designer_map_sulfonamide,
            "spatialIntent": {
                "method": "selected-exit-vector",
                "attachmentReferenceAtomName": "C19",
                "declaredBeforePoseSearch": True,
            },
        },
    ]
    designer_payload = {
        **payload,
        "id": "cdk2-designer-intent",
        "title": "CDK2 designer-directed hit-to-lead replay",
        "protocolBoundary": {
            **payload["protocolBoundary"],
            "allowedLaterInputs": [
                "reported compound molecular graphs",
                "designer-selected attachment atom on the current predicted ligand",
            ],
            "sequenceRule": "Each step grows from an explicit persistent atom ID on the hit or preceding prediction.",
        },
        "steps": designer_steps,
    }
    DESIGNER_CAMPAIGN_OUTPUT.write_text(json.dumps(designer_payload, indent=2) + "\n")
    print(f"Wrote {CAMPAIGN_OUTPUT.relative_to(ROOT)} with {len(steps)} sequential graph-only steps")
    print(f"Wrote {DESIGNER_CAMPAIGN_OUTPUT.relative_to(ROOT)} with explicit C19 designer intent")


if __name__ == "__main__":
    main()
