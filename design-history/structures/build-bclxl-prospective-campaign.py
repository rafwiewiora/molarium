#!/usr/bin/env python3
"""Build the registered hit-only BCL-xL design campaign.

Only the compound-4 hit structure (PDB 3SPF) contributes coordinates.  Later
compounds contribute molecular graphs, and PDB 3SP7 is deliberately absent
from this generator.  A later crystal may be named in an evaluation manifest
only after a prediction artifact has been frozen.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from rdkit import Chem, rdBase
from rdkit.Chem import rdFMCS


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "bclxl-trajectory.json"
HIT_SDF = HERE / "3SPF-B50-bound.sdf"
HIT_LIGAND_PDB = HERE / "generated" / "3spf-ligand.pdb"
OUTPUT = HERE / "generated" / "bclxl-prospective-campaign.json"
REGISTERED_DESIGN_ROUTE_SCHEMA = "molarium.registered-design-route/v1"
EXPECTED_RDKIT_VERSION = "2026.03.4"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def selected_hit_atom_names() -> list[str]:
    names = []
    for line in HIT_LIGAND_PDB.read_text().splitlines():
        if line.startswith("HETATM"):
            names.append(line[12:16].strip())
    return names


def hit_ligand_definition(reference: Chem.Mol, heavy_names: list[str]) -> dict:
    molecule = Chem.AddHs(reference)
    names = list(heavy_names)
    names.extend(f"H{index + 1}" for index in range(molecule.GetNumAtoms() - len(names)))
    atoms = [{
        "id": names[index],
        "element": atom.GetSymbol(),
        "charge": atom.GetFormalCharge(),
        "aromatic": atom.GetIsAromatic(),
        "leaving": False,
        "x": 0, "y": 0, "z": 0,
    } for index, atom in enumerate(molecule.GetAtoms())]
    bonds = [{
        "a": names[bond.GetBeginAtomIdx()],
        "b": names[bond.GetEndAtomIdx()],
        "order": 1.5 if bond.GetIsAromatic() else float(bond.GetBondTypeAsDouble()),
        "aromatic": bond.GetIsAromatic(),
    } for bond in molecule.GetBonds()]
    return {"id": "B50", "source": "3SPF/B50 graph with RDKit-added explicit hydrogens",
            "atoms": atoms, "bonds": bonds}


def exact_mcs(reference: Chem.Mol, product: Chem.Mol) -> tuple:
    result = rdFMCS.FindMCS(
        [reference, product], timeout=30,
        atomCompare=rdFMCS.AtomCompare.CompareElements,
        bondCompare=rdFMCS.BondCompare.CompareOrder,
        ringMatchesRingOnly=True, completeRingsOnly=True,
        matchValences=False, matchChiralTag=False,
    )
    if result.canceled:
        raise RuntimeError("Hit/product MCS timed out; no partial map may enter a campaign")
    query = Chem.MolFromSmarts(result.smartsString)
    reference_matches = reference.GetSubstructMatches(
        query, uniquify=True, useChirality=False, maxMatches=4096)
    product_matches = product.GetSubstructMatches(
        query, uniquify=True, useChirality=False, maxMatches=4096)
    if not reference_matches or not product_matches:
        raise RuntimeError("Hit/product MCS has no complete match")
    return result, min(reference_matches), min(product_matches)


def pose_map(reference: Chem.Mol, names: list[str], product: Chem.Mol, step_id: str) -> dict:
    result, reference_match, product_match = exact_mcs(reference, product)
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
            "referenceAtomName": names[reference_index],
            "productAtomIndex": product_index,
            "element": reference_atom.GetSymbol(),
        })
    deleted = [{
        "referenceAtomIndex": index,
        "referenceAtomName": names[index],
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
            "commonAtomName": names[common_index],
            "editedAtomName": names[edited_index],
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
    return {
        "source": "hit-only graph MCS generated from PDB 3SPF/B50",
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
    }


def main() -> None:
    if rdBase.rdkitVersion != EXPECTED_RDKIT_VERSION:
        raise RuntimeError(
            f"This deterministic builder requires RDKit {EXPECTED_RDKIT_VERSION}; "
            f"found {rdBase.rdkitVersion}")
    source = json.loads(SOURCE.read_text())
    reference = Chem.MolFromMolFile(str(HIT_SDF), removeHs=True)
    if reference is None or reference.GetNumConformers() != 1:
        raise RuntimeError("Unable to load the 3SPF/B50 hit ligand")
    names = selected_hit_atom_names()
    if len(names) != reference.GetNumAtoms():
        raise RuntimeError("3SPF hit SDF/PDB atom counts differ")
    steps = []
    for state in source["states"]:
        if state["id"] == "4":
            continue
        parsed = Chem.MolFromSmiles(state["smiles"])
        if parsed is None:
            raise RuntimeError(f"Compound {state['id']} has an invalid graph")
        canonical = Chem.MolToSmiles(parsed, canonical=True, isomericSmiles=True)
        product = Chem.MolFromSmiles(canonical)
        step_id = f"compound-{state['id']}"
        steps.append({
            "id": step_id,
            "stateId": state["id"],
            "label": state["label"],
            "inputKind": "molecular-graph-only",
            "productSmiles": canonical,
            "standardInchiKey": state["standardInchiKey"],
            "posePropagationMap": pose_map(reference, names, product, step_id),
        })
    payload = {
        "schema": REGISTERED_DESIGN_ROUTE_SCHEMA,
        "id": "bclxl-hit-only",
        "title": "BCL-xL hit-only prospective replay",
        "protocolBoundary": {
            "coordinateInputs": ["PDB 3SPF protein", "PDB 3SPF ligand B50 / compound 4"],
            "allowedLaterInputs": ["reported compound molecular graphs"],
            "forbiddenBeforeFreeze": [
                "later protein coordinates", "later ligand coordinates",
                "later-structure scaffold constraints", "holdout-guided candidate selection",
            ],
        },
        "hit": {
            "pdbId": "3SPF",
            "stateId": "4",
            "ligand": "B50",
            "proteinAsset": "./design-history/structures/generated/3spf-protein.pdb",
            "ligandAsset": "./design-history/structures/generated/3spf-ligand.pdb",
            "proteinSha256": sha256(HERE / "generated" / "3spf-protein.pdb"),
            "ligandSha256": sha256(HIT_LIGAND_PDB),
            "ligandDefinition": hit_ligand_definition(reference, names),
        },
        "steps": steps,
        "generator": {
            "path": "design-history/structures/build-bclxl-prospective-campaign.py",
            "rdkitVersion": rdBase.rdkitVersion,
            "sourceManifest": "design-history/structures/bclxl-trajectory.json",
            "sourceManifestSha256": sha256(SOURCE),
            "coordinateFilesRead": ["3SPF-B50-bound.sdf", "generated/3spf-ligand.pdb"],
        },
        "evaluation": {
            "status": "locked-until-predictions-frozen",
            "holdouts": [],
        },
    }
    OUTPUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {OUTPUT.relative_to(HERE.parent.parent)} with {len(steps)} graph-only steps")


if __name__ == "__main__":
    main()
