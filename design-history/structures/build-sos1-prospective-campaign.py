#!/usr/bin/env python3
"""Build the registered SOS1 hit-only prospective campaign.

Only PDB 5OVE contributes coordinates.  Compounds 17, 18, 21, and 23
contribute reported molecular graphs; their deposited coordinates are never
opened by this generator.  The resulting campaign is therefore suitable for
freezing predictions before any structural comparison with 5OVF--5OVI.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

from rdkit import Chem, rdBase
from rdkit.Chem import rdFMCS


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
GENERATED = HERE / "generated"
PROTEIN_OUTPUT = GENERATED / "sos1-5ove-protein.pdb"
LIGAND_OUTPUT = GENERATED / "sos1-5ove-ligand.pdb"
CAMPAIGN_OUTPUT = GENERATED / "sos1-prospective-campaign.json"
REGISTERED_DESIGN_ROUTE_SCHEMA = "molarium.registered-design-route/v1"
EXPECTED_RDKIT_VERSION = "2026.03.4"
DEFAULT_HIT_PDB = (ROOT / "outputs" / "design-history" / "sos1-preapproval"
                   / "source" / "5OVE.pdb")

# RCSB chemical-component graphs.  These are identities, not coordinates.
GRAPHS = {
    "AXE": "COc1cc2ncnc(N[C@H](C)c3cccc4ccccc34)c2cc1OC",
    "AWT": "COc1cc2nc(C)nc(N[C@H](C)c3cccc(-c4cn[nH]c4)c3)c2cc1OC",
    "AWZ": "COc1cc2nc(C)nc(N[C@H](C)c3ccc(-c4cnc5n4CCC5)s3)c2cc1OC",
    "AWW": "COC1=C(OC)Cc2c(nc(C)nc2N[C@H](C)c2ccc(-c3ccccc3CO)s2)C1",
    "AXH": "CNCc1ccccc1-c1csc([C@@H](C)Nc2nc(C)nc3cc(OC)c(OC)cc23)c1",
}

GRAPH_SOURCES = {
    key: f"https://www.rcsb.org/ligand/{key}" for key in GRAPHS
}


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
        raise RuntimeError("SOS1 graph MCS timed out; a partial map is forbidden")
    query = Chem.MolFromSmarts(result.smartsString)
    reference_matches = reference.GetSubstructMatches(
        query, uniquify=False, useChirality=False, maxMatches=4096)
    product_matches = product.GetSubstructMatches(
        query, uniquify=False, useChirality=False, maxMatches=4096)
    if not reference_matches or not product_matches:
        raise RuntimeError("SOS1 graph MCS has no complete match")
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


def match_quality(reference: Chem.Mol, product: Chem.Mol,
                  reference_match: tuple[int, ...],
                  product_match: tuple[int, ...]) -> tuple:
    """Prefer maps that preserve the most local chemical context.

    This breaks graph automorphisms without consulting a later structure.
    The final index tuples make the choice deterministic when chemistry is
    genuinely symmetric.
    """
    score = 0
    for reference_index, product_index in zip(reference_match, product_match):
        reference_atom = reference.GetAtomWithIdx(reference_index)
        product_atom = product.GetAtomWithIdx(product_index)
        score += 8 * int(reference_atom.GetIsAromatic() == product_atom.GetIsAromatic())
        score += 4 * int(reference_atom.IsInRing() == product_atom.IsInRing())
        score += 2 * int(reference_atom.GetDegree() == product_atom.GetDegree())
        score += int(reference_atom.GetTotalValence() == product_atom.GetTotalValence())
        reference_neighbors = sorted(atom.GetSymbol() for atom in reference_atom.GetNeighbors())
        product_neighbors = sorted(atom.GetSymbol() for atom in product_atom.GetNeighbors())
        score += 3 * int(reference_neighbors == product_neighbors)
    return (-score, reference_match, product_match)


def pose_map(reference: Chem.Mol, reference_names: list[str],
             product: Chem.Mol, step_id: str) -> tuple[dict, list[str]]:
    if len(reference_names) != reference.GetNumAtoms():
        raise RuntimeError(f"{step_id}: reference name count changed")
    result, reference_matches, product_matches = exact_mcs(reference, product)
    candidates = [(reference_match, product_match)
                  for reference_match in reference_matches
                  for product_match in product_matches]
    reference_match, product_match = min(
        candidates, key=lambda pair: match_quality(reference, product, *pair))
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
        "source": "reported molecular graphs plus deterministic local-context map; no later coordinates",
        "referenceHeavyAtoms": reference.GetNumAtoms(),
        "productHeavyAtoms": product.GetNumAtoms(),
        "commonHeavyAtoms": len(common),
        "commonReferenceFraction": round(len(common) / reference.GetNumAtoms(), 6),
        "commonProductFraction": round(len(common) / product.GetNumAtoms(), 6),
        "mcs": {"smarts": result.smartsString, "atoms": result.numAtoms,
                "bonds": result.numBonds},
        "ambiguity": {"referenceMatches": len(reference_matches),
                      "productMatches": len(product_matches),
                      "candidateMaps": len(candidates),
                      "selection": "maximum local chemical-context preservation; deterministic tie break"},
        "commonAtoms": common,
        "deletedReferenceAtoms": deleted,
        "addedProductAtoms": added,
        "referenceBoundary": reference_boundary,
        "productBoundary": product_boundary,
    }, product_names)


def hit_graph_atom_names(hit_pdb: Path, reference: Chem.Mol) -> list[str]:
    full = Chem.MolFromPDBFile(str(hit_pdb), removeHs=True, sanitize=False)
    if full is None:
        raise RuntimeError("Unable to parse the 5OVE hit PDB")
    selected = []
    for atom in full.GetAtoms():
        info = atom.GetPDBResidueInfo()
        if (info and info.GetResidueName().strip() == "AXE"
                and info.GetChainId().strip() == "A"
                and info.GetResidueNumber() == 1104):
            selected.append(atom.GetIdx())
    if len(selected) != reference.GetNumAtoms():
        raise RuntimeError("The selected 5OVE/AXE graph changed")
    fragment = Chem.RWMol()
    old_to_new = {}
    pdb_names = []
    for old_index in selected:
        atom = full.GetAtomWithIdx(old_index)
        old_to_new[old_index] = fragment.AddAtom(Chem.Atom(atom.GetAtomicNum()))
        pdb_names.append(atom.GetPDBResidueInfo().GetName().strip())
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
        raise RuntimeError("The 5OVE ligand topology does not match its registered graph")
    query = Chem.MolFromSmarts(result.smartsString)
    pdb_match = min(pdb_graph.GetSubstructMatches(query, uniquify=True, maxMatches=4096))
    reference_match = min(reference.GetSubstructMatches(
        query, uniquify=True, maxMatches=4096))
    names: list[str | None] = [None] * reference.GetNumAtoms()
    for pdb_index, reference_index in zip(pdb_match, reference_match):
        names[reference_index] = pdb_names[pdb_index]
    if any(name is None for name in names):
        raise RuntimeError("The 5OVE ligand atom-name map is incomplete")
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
    return {"id": "AXE",
            "source": "registered 5OVE/AXE graph with RDKit-added hydrogens",
            "atoms": atoms, "bonds": bonds}


def pdb_point(line: str) -> tuple[float, float, float]:
    return (float(line[30:38]), float(line[38:46]), float(line[46:54]))


def extract_hit_assets(hit_pdb: Path) -> None:
    lines = hit_pdb.read_text().splitlines()
    ligand_lines = [line for line in lines if line.startswith("HETATM")
                    and line[17:20].strip() == "AXE"
                    and line[21:22].strip() == "A"
                    and int(line[22:26]) == 1104]
    if len(ligand_lines) != 27:
        raise RuntimeError(f"Expected 27 hit ligand atoms, found {len(ligand_lines)}")
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
        "REMARK 950 DERIVED ONLY FROM PDB 5OVE MODEL 1",
        "REMARK 950 SOS1 CHAIN A; WATERS WITHIN 6 A OF HIT AXE RETAINED",
        *protein_lines, "END", "",
    ]))
    LIGAND_OUTPUT.write_text("\n".join([
        "REMARK 950 EXACT PDB 5OVE LIGAND AXE CHAIN A RESIDUE 1104",
        *ligand_lines, "END", "",
    ]))


def main() -> None:
    if rdBase.rdkitVersion != EXPECTED_RDKIT_VERSION:
        raise RuntimeError(
            f"This deterministic builder requires RDKit {EXPECTED_RDKIT_VERSION}; "
            f"found {rdBase.rdkitVersion}")
    parser = argparse.ArgumentParser()
    parser.add_argument("--hit-pdb", type=Path, default=DEFAULT_HIT_PDB)
    args = parser.parse_args()
    hit_pdb = args.hit_pdb.resolve()
    if not hit_pdb.exists():
        raise RuntimeError(f"Missing PDB 5OVE input: {hit_pdb}")

    canonical = {}
    molecules = {}
    for ligand_id, smiles in GRAPHS.items():
        canonical[ligand_id], molecules[ligand_id] = canonical_molecule(smiles)
    hit_names = hit_graph_atom_names(hit_pdb, molecules["AXE"])
    sequence = ["AXE", "AWT", "AWZ", "AWW", "AXH"]
    step_specs = [
        ("scaffold-rewrite", "17", "replace the naphthyl region with the pyrazolyl-phenyl design"),
        ("fragment-merge", "18", "merge the bicyclic amine fragment through thiophene"),
        ("open-phe890-pocket", "21", "install the benzyl-alcohol arm that challenges Phe890"),
        ("finish-bay-293", "23", "replace hydroxymethyl with methylaminomethyl and restore the aromatic core"),
    ]
    steps = []
    reference_names = hit_names
    for index, (reference_id, product_id) in enumerate(zip(sequence, sequence[1:])):
        step_id, compound, label = step_specs[index]
        mapping, product_names = pose_map(
            molecules[reference_id], reference_names, molecules[product_id], step_id)
        steps.append({
            "id": step_id, "sequenceIndex": index + 1,
            "referenceStateId": reference_id, "stateId": product_id,
            "compound": compound, "label": label,
            "inputKind": "molecular-graph-only",
            "productSmiles": canonical[product_id],
            "productAtomNames": product_names,
            "posePropagationMap": mapping,
        })
        reference_names = product_names

    extract_hit_assets(hit_pdb)
    source_path = str(hit_pdb.relative_to(ROOT)) if hit_pdb.is_relative_to(ROOT) else str(hit_pdb)
    payload = {
        "schema": REGISTERED_DESIGN_ROUTE_SCHEMA,
        "id": "sos1-hit-only",
        "title": "SOS1 five-state hit-only conformational replay",
        "protocolBoundary": {
            "coordinateInputs": ["PDB 5OVE SOS1 protein", "PDB 5OVE ligand AXE"],
            "allowedLaterInputs": ["reported compound molecular graphs"],
            "forbiddenBeforeFreeze": [
                "5OVF--5OVI protein coordinates", "5OVF--5OVI ligand coordinates",
                "later-structure scaffold constraints", "holdout-guided rotamer selection",
            ],
            "sequenceRule": "Every step starts from the preceding frozen prediction; Phe890 branches are ranked from the current predicted complex.",
        },
        "hit": {
            "pdbId": "5OVE", "stateId": "AXE", "ligand": "AXE",
            "canonicalSmiles": canonical["AXE"],
            "proteinAsset": "./design-history/structures/generated/sos1-5ove-protein.pdb",
            "ligandAsset": "./design-history/structures/generated/sos1-5ove-ligand.pdb",
            "proteinSha256": sha256(PROTEIN_OUTPUT),
            "ligandSha256": sha256(LIGAND_OUTPUT),
            "ligandDefinition": ligand_definition(molecules["AXE"], hit_names),
        },
        "steps": steps,
        "source": {
            "article": "Discovery of potent SOS1 inhibitors that block RAS activation via disruption of the RAS-SOS1 interaction",
            "doi": "10.1073/pnas.1812963116",
            "graphRole": "reported compound identities only",
            "chemicalComponents": GRAPH_SOURCES,
        },
        "generator": {
            "path": "design-history/structures/build-sos1-prospective-campaign.py",
            "rdkitVersion": rdBase.rdkitVersion,
            "coordinateFilesRead": [source_path],
        },
        "evaluation": {"status": "locked-until-predictions-frozen", "holdouts": []},
    }
    CAMPAIGN_OUTPUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {CAMPAIGN_OUTPUT.relative_to(ROOT)} with {len(steps)} graph-only steps")
    for step in steps:
        mapping = step["posePropagationMap"]
        print(f"  {step['id']}: {mapping['commonHeavyAtoms']}/"
              f"{mapping['referenceHeavyAtoms']} -> {mapping['productHeavyAtoms']} heavy atoms")


if __name__ == "__main__":
    main()
