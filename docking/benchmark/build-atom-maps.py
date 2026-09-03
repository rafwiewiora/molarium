#!/usr/bin/env python3
"""Build deterministic reference/product heavy-atom maps for the pre-registered cohort.

This is an offline curation tool.  The resulting JSON contains reference crystal coordinates,
which are legitimate pose-generation input, but never analogue crystal coordinates.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import shlex
import sys

from rdkit import Chem, rdBase
from rdkit.Chem import rdFMCS


ROOT = pathlib.Path(__file__).resolve().parent


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cif_loops(text: str) -> dict[str, list[dict[str, str]]]:
    lines = text.splitlines()
    loops: dict[str, list[dict[str, str]]] = {}
    index = 0
    while index < len(lines):
        if lines[index].strip() != "loop_":
            index += 1
            continue
        index += 1
        headers: list[str] = []
        while index < len(lines) and lines[index].strip().startswith("_"):
            headers.append(lines[index].strip())
            index += 1
        tokens: list[str] = []
        while index < len(lines):
            stripped = lines[index].strip()
            if (not stripped or stripped.startswith("#") or stripped == "loop_"
                    or stripped.startswith("_") or stripped.startswith("data_")):
                break
            tokens.extend(shlex.split(stripped))
            index += 1
        if not headers:
            continue
        category = headers[0].split(".", 1)[0]
        keys = [header.split(".", 1)[1] for header in headers]
        rows = []
        for offset in range(0, len(tokens), len(headers)):
            values = tokens[offset:offset + len(headers)]
            if len(values) == len(headers):
                rows.append(dict(zip(keys, values)))
        loops[category] = rows
    return loops


def ccd_molecule(component_id: str) -> tuple[Chem.Mol, list[str]]:
    text = (ROOT / "fixtures" / "ccd" / f"{component_id}.cif").read_text()
    tables = cif_loops(text)
    editable = Chem.RWMol()
    atom_indices: dict[str, int] = {}
    atom_names: list[str] = []
    for row in tables["_chem_comp_atom"]:
        if row["type_symbol"] == "H":
            continue
        atom = Chem.Atom(row["type_symbol"].title())
        atom.SetFormalCharge(int(row["charge"]))
        atom.SetIsAromatic(row["pdbx_aromatic_flag"] == "Y")
        atom.SetProp("ccdAtomName", row["atom_id"])
        atom_indices[row["atom_id"]] = editable.AddAtom(atom)
        atom_names.append(row["atom_id"])
    bond_types = {
        "SING": Chem.BondType.SINGLE,
        "DOUB": Chem.BondType.DOUBLE,
        "TRIP": Chem.BondType.TRIPLE,
        "AROM": Chem.BondType.AROMATIC,
    }
    for row in tables["_chem_comp_bond"]:
        if row["atom_id_1"] not in atom_indices or row["atom_id_2"] not in atom_indices:
            continue
        editable.AddBond(atom_indices[row["atom_id_1"]], atom_indices[row["atom_id_2"]],
                         bond_types[row["value_order"]])
    molecule = editable.GetMol()
    Chem.SanitizeMol(molecule)
    return molecule, atom_names


def selected_pdb_coordinates(reference: dict) -> dict[str, list[float]]:
    selection = reference["selection"]
    text = (ROOT / reference["coordinateFile"]).read_text()
    model = 1
    coordinates: dict[str, list[float]] = {}
    for line in text.splitlines():
        if line.startswith("MODEL "):
            model = int(line[10:14].strip() or model)
        if not line.startswith("HETATM") or model != selection["model"]:
            continue
        if line[17:20].strip() != reference["componentId"]:
            continue
        if line[21:22].strip() != selection["chain"]:
            continue
        if int(line[22:26].strip()) != selection["residueNumber"]:
            continue
        if line[26:27].strip() != selection["insertionCode"]:
            continue
        alternate = line[16:17].strip()
        if selection["alternateLocation"] and alternate not in ("", selection["alternateLocation"]):
            continue
        atom_name = line[12:16].strip()
        coordinates[atom_name] = [float(line[30:38]), float(line[38:46]), float(line[46:54])]
    return coordinates


def exact_product_atom_names(product: Chem.Mol, paired_component_id: str | None) -> dict[int, str]:
    if not paired_component_id:
        return {}
    ccd_product, names = ccd_molecule(paired_component_id)
    matches = product.GetSubstructMatches(ccd_product, uniquify=True, useChirality=False,
                                          maxMatches=4096)
    if not matches:
        raise RuntimeError(f"{paired_component_id}: product SMILES is not the CCD graph")
    match = min(matches)
    return {product_index: names[ccd_index]
            for ccd_index, product_index in enumerate(match)}


def mcs_map(reference: Chem.Mol, product: Chem.Mol, expected_atoms: int | None) -> tuple:
    result = rdFMCS.FindMCS(
        [reference, product], timeout=5,
        atomCompare=rdFMCS.AtomCompare.CompareElements,
        bondCompare=rdFMCS.BondCompare.CompareOrder,
        ringMatchesRingOnly=True, completeRingsOnly=True,
        matchValences=False, matchChiralTag=False,
    )
    query = Chem.MolFromSmarts(result.smartsString)
    reference_matches = reference.GetSubstructMatches(query, uniquify=True,
                                                       useChirality=False, maxMatches=4096)
    product_matches = product.GetSubstructMatches(query, uniquify=True,
                                                   useChirality=False, maxMatches=4096)
    if not reference_matches or not product_matches:
        raise RuntimeError("MCS query has no complete match")
    if result.canceled and expected_atoms != result.numAtoms:
        raise RuntimeError(
            f"MCS timed out at {result.numAtoms} atoms without the pre-audited expected count")
    # Current cohort graphs each yield one symmetry-unique complete-ring match.  Keep the
    # lexicographic rule explicit so future symmetric additions remain deterministic.
    reference_match = min(reference_matches)
    product_match = min(product_matches)
    return result, query, reference_match, product_match, len(reference_matches), len(product_matches)


def main() -> None:
    curation_bytes = (ROOT / "curation.v0.1.json").read_bytes()
    curation_validation_bytes = (ROOT / "curation-validation.v0.1.json").read_bytes()
    fixture_bytes = (ROOT / "fixture-validation.v0.1.json").read_bytes()
    curation = json.loads(curation_bytes)
    curation_validation = json.loads(curation_validation_bytes)
    fixtures = json.loads(fixture_bytes)
    fixture_by_case = {entry["caseId"]: entry for entry in fixtures["cases"]}
    product_by_case = {entry["caseId"]: entry for entry in curation_validation["products"]}
    records = []
    for case in curation["cases"]:
        fixture = fixture_by_case[case["id"]]
        reference, reference_names = ccd_molecule(fixture["reference"]["componentId"])
        # Product atom indices must refer to the exact canonical graph string
        # passed to the browser, never the curation author's equivalent input
        # ordering.
        product_smiles = (fixture["analogue"]["canonicalSmiles"] if case.get("analogue")
                          else product_by_case[case["id"]]["canonicalSmiles"])
        product = Chem.MolFromSmiles(product_smiles)
        if product is None:
            raise RuntimeError(f"{case['id']}: RDKit rejected product graph")
        expected_atoms = case.get("mappingAudit", {}).get("expectedCommonHeavyAtoms")
        result, query, reference_match, product_match, reference_match_count, product_match_count = \
            mcs_map(reference, product, expected_atoms)
        coordinates = selected_pdb_coordinates(fixture["reference"])
        missing_coordinates = [name for name in reference_names if name not in coordinates]
        if missing_coordinates:
            raise RuntimeError(f"{case['id']}: missing PDB coordinates {missing_coordinates}")
        product_names = exact_product_atom_names(
            product, fixture.get("analogue", {}).get("componentId"))
        mapped_reference = set(reference_match)
        mapped_product = set(product_match)
        common = []
        for query_index in range(query.GetNumAtoms()):
            reference_index = reference_match[query_index]
            product_index = product_match[query_index]
            reference_atom = reference.GetAtomWithIdx(reference_index)
            product_atom = product.GetAtomWithIdx(product_index)
            if reference_atom.GetSymbol() != product_atom.GetSymbol():
                raise RuntimeError(f"{case['id']}: element-changing common atom")
            common.append({
                "referenceAtomIndex": reference_index,
                "referenceAtomName": reference_names[reference_index],
                "productAtomIndex": product_index,
                "productAtomName": product_names.get(product_index),
                "element": reference_atom.GetSymbol(),
                "referencePointAngstrom": coordinates[reference_names[reference_index]],
            })
        deleted = [{
            "referenceAtomIndex": index,
            "referenceAtomName": reference_names[index],
            "element": reference.GetAtomWithIdx(index).GetSymbol(),
            "referencePointAngstrom": coordinates[reference_names[index]],
        } for index in range(reference.GetNumAtoms()) if index not in mapped_reference]
        added = [{
            "productAtomIndex": index,
            "productAtomName": product_names.get(index),
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
        target_names = case.get("transformation", {}).get("referenceFeatureAtomNames", [])
        disposition = [{
            "referenceAtomName": name,
            "disposition": "preserved-exact" if reference_names.index(name) in mapped_reference
                           else "deleted-requires-role-compatible-remap",
        } for name in target_names]
        if case["tier"] == "adversarial-negative" and any(
                entry["disposition"] != "deleted-requires-role-compatible-remap"
                for entry in disposition):
            raise RuntimeError(f"{case['id']}: negative control retained a targeted feature")
        mapped = Chem.Mol(product)
        for atom in mapped.GetAtoms():
            atom.SetAtomMapNum(atom.GetIdx() + 1)
        records.append({
            "caseId": case["id"],
            "referenceHeavyAtoms": reference.GetNumAtoms(),
            "productHeavyAtoms": product.GetNumAtoms(),
            "commonHeavyAtoms": len(common),
            "commonReferenceFraction": len(common) / reference.GetNumAtoms(),
            "commonProductFraction": len(common) / product.GetNumAtoms(),
            "mcs": {
                "smarts": result.smartsString,
                "atoms": result.numAtoms,
                "bonds": result.numBonds,
                "timedOut": bool(result.canceled),
                "preAuditedExpectedAtoms": expected_atoms,
                "referenceMatchCount": reference_match_count,
                "productMatchCount": product_match_count,
                "selectionRule": "lexicographically first symmetry-unique complete-ring MCS match",
            },
            "mappedProductSmiles": Chem.MolToSmiles(mapped, canonical=True,
                                                      isomericSmiles=True),
            "commonAtoms": common,
            "deletedReferenceAtoms": deleted,
            "addedProductAtoms": added,
            "referenceBoundary": reference_boundary,
            "productBoundary": product_boundary,
            "targetFeatureDisposition": disposition,
        })
        print(f"{case['id']}: {len(common)}/{reference.GetNumAtoms()} reference, "
              f"{len(common)}/{product.GetNumAtoms()} product", flush=True)
    output = {
        "schemaVersion": 1,
        "datasetId": curation["datasetId"],
        "curationSha256": sha256(curation_bytes),
        "curationValidationSha256": sha256(curation_validation_bytes),
        "fixtureValidationSha256": sha256(fixture_bytes),
        "generator": {
            "name": "RDKit FindMCS offline curation gate",
            "rdkitVersion": rdBase.rdkitVersion,
            "atomCompare": "elements",
            "bondCompare": "order",
            "ringMatchesRingOnly": True,
            "completeRingsOnly": True,
            "timeoutSeconds": 5,
        },
        "containsHiddenAnalogueCoordinates": False,
        "cases": records,
    }
    (ROOT / "atom-maps.v0.1.json").write_text(json.dumps(output, indent=2) + "\n")
    print(f"Atom maps: BUILT ({len(records)} cases; RDKit {rdBase.rdkitVersion})")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Atom-map build failed: {error}", file=sys.stderr)
        raise
