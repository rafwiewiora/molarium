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
REGISTERED_SOFT_SPATIAL_FEATURE_RESTRAINT_SCHEMA = (
    "molarium.registered-soft-spatial-feature-restraint/v1")
REGISTERED_SPATIAL_FEATURE_PARAMETER_DECISION_SCHEMA = (
    "molarium.registered-spatial-feature-parameter-decision/v1")
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

# Human/agent design intent is declared separately from the graph algorithm that
# proposes conserved fragments.  The declaration is part of the registered
# route bytes (and therefore its pre-holdout SHA-256); the proposal cannot make
# itself required merely by labelling its own output.
RETAINED_FEATURE_INTENTS = {
    "finish-bay-293": [{
        "id": "retain-terminal-feature-through-bay293",
        "featureId": "secondary-exact-fragment-1",
        "kind": "conserved-fragment-rmsd",
        "actorClass": "human",
        "source": "registered-designer-intent",
        "treatment": "soft-restraint",
        "required": True,
        "restraint": {
            "schema": REGISTERED_SOFT_SPATIAL_FEATURE_RESTRAINT_SCHEMA,
            "metric": "graph-symmetry-minimized Cartesian RMSD",
            "toleranceAngstrom": 2.25,
            "weightKcalMolPerAngstrom2": 20,
            "required": True,
            "parameterDecision": {
                "schema": REGISTERED_SPATIAL_FEATURE_PARAMETER_DECISION_SCHEMA,
                "actorClass": "human",
                "basis": "pre-holdout-diagnostic",
                "sourceAttemptId": (
                    "sos1-final-retention-9a73dd8-20260904t0535z-"
                    "use1b-a010-r01"),
                "observedBestRmsdAngstrom": 2.161703263647055,
                "selectedToleranceAngstrom": 2.25,
                "holdoutCoordinatesUsed": False,
            },
        },
        "rationale": ("retain the separately conserved terminal ring feature "
                      "while allowing the intervening graph rewrite"),
    }],
}


def registered_intents(step_id: str) -> list[dict]:
    return [dict(record) for record in RETAINED_FEATURE_INTENTS.get(step_id, [])]


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


def induced_subgraph(molecule: Chem.Mol,
                     retained_indices: list[int]) -> tuple[Chem.Mol, list[int]]:
    """Return an index-preserving graph induced by ``retained_indices``.

    The graph is intentionally not sanitized: deleting a protected component
    can leave an aromatic boundary atom in another component.  FMCS only needs
    the recorded atom and bond properties, and accepting a sanitizer repair
    here would silently change the registered molecular graph.
    """
    retained = sorted(set(retained_indices))
    old_to_new: dict[int, int] = {}
    editable = Chem.RWMol()
    for old_index in retained:
        old_to_new[old_index] = editable.AddAtom(
            Chem.Atom(molecule.GetAtomWithIdx(old_index)))
    for bond in molecule.GetBonds():
        first, second = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
        if first in old_to_new and second in old_to_new:
            editable.AddBond(old_to_new[first], old_to_new[second], bond.GetBondType())
            copied = editable.GetBondBetweenAtoms(old_to_new[first], old_to_new[second])
            copied.SetIsAromatic(bond.GetIsAromatic())
    result = editable.GetMol()
    Chem.FastFindRings(result)
    return result, retained


def biconnected_atom_blocks(molecule: Chem.Mol) -> list[tuple[int, ...]]:
    """Return deterministic vertex-biconnected atom blocks.

    This is a graph-only Tarjan traversal.  A cyclic block represents a ring
    system even when RDKit's smallest-ring basis chooses a different set of
    individual rings for a fused system.
    """
    adjacency = {
        atom.GetIdx(): sorted(neighbor.GetIdx() for neighbor in atom.GetNeighbors())
        for atom in molecule.GetAtoms()
    }
    discovery: dict[int, int] = {}
    low: dict[int, int] = {}
    parent: dict[int, int | None] = {}
    edge_stack: list[tuple[int, int]] = []
    blocks: list[tuple[int, ...]] = []
    clock = 0

    def finish_block(stop: tuple[int, int]) -> None:
        atoms: set[int] = set()
        while edge_stack:
            edge = edge_stack.pop()
            atoms.update(edge)
            if edge == stop:
                break
        if atoms:
            blocks.append(tuple(sorted(atoms)))

    def visit(atom_index: int) -> None:
        nonlocal clock
        clock += 1
        discovery[atom_index] = low[atom_index] = clock
        for neighbor_index in adjacency[atom_index]:
            if neighbor_index not in discovery:
                parent[neighbor_index] = atom_index
                edge_stack.append((atom_index, neighbor_index))
                visit(neighbor_index)
                low[atom_index] = min(low[atom_index], low[neighbor_index])
                if low[neighbor_index] >= discovery[atom_index]:
                    finish_block((atom_index, neighbor_index))
            elif (parent.get(atom_index) != neighbor_index
                  and discovery[neighbor_index] < discovery[atom_index]):
                low[atom_index] = min(low[atom_index], discovery[neighbor_index])
                edge_stack.append((neighbor_index, atom_index))

    for atom_index in sorted(adjacency):
        if atom_index in discovery:
            continue
        parent[atom_index] = None
        visit(atom_index)
        if edge_stack:
            finish_block(edge_stack[0])
    return sorted(set(blocks), key=lambda block: (block[0], len(block), block))


def block_bond_count(molecule: Chem.Mol, block: set[int]) -> int:
    return sum(1 for bond in molecule.GetBonds()
               if bond.GetBeginAtomIdx() in block
               and bond.GetEndAtomIdx() in block)


def migrated_mapped_ring_blocks(reference: Chem.Mol, reference_names: list[str],
                                product: Chem.Mol,
                                reference_match: tuple[int, ...],
                                product_match: tuple[int, ...]) -> list[dict]:
    """Identify mapped cyclic blocks whose edited-region attachment migrates.

    A mapped ring cannot be a rigid coordinate anchor when an edited region
    leaves one ring atom and enters another.  The graph identity remains
    registered, but all ring atoms except conserved junctions to the remaining
    mapped scaffold are released from the hard coordinate anchor.
    """
    reference_to_product = dict(zip(reference_match, product_match))
    product_to_reference = dict(zip(product_match, reference_match))
    mapped_reference = set(reference_to_product)
    mapped_product = set(product_to_reference)

    def external_sites(molecule: Chem.Mol, mapped: set[int]) -> set[int]:
        return {atom_index for atom_index in mapped
                if any(neighbor.GetIdx() not in mapped
                       for neighbor in molecule.GetAtomWithIdx(atom_index).GetNeighbors())}

    reference_external = external_sites(reference, mapped_reference)
    product_external_as_reference = {
        product_to_reference[index]
        for index in external_sites(product, mapped_product)
    }
    product_blocks = [set(block) for block in biconnected_atom_blocks(product)]
    results = []
    for reference_block_tuple in biconnected_atom_blocks(reference):
        reference_block = set(reference_block_tuple)
        if (len(reference_block) < 3
                or block_bond_count(reference, reference_block) < len(reference_block)
                or not reference_block.issubset(mapped_reference)):
            continue
        product_block = {reference_to_product[index] for index in reference_block}
        if not any(product_block.issubset(candidate)
                   and block_bond_count(product, candidate) >= len(candidate)
                   for candidate in product_blocks):
            continue
        old_sites = reference_block & reference_external
        new_sites = reference_block & product_external_as_reference
        migrated_from = old_sites - new_sites
        migrated_to = new_sites - old_sites
        if not migrated_from or not migrated_to:
            continue

        retained_junctions = set()
        for reference_index in reference_block:
            product_index = reference_to_product[reference_index]
            for neighbor in reference.GetAtomWithIdx(reference_index).GetNeighbors():
                neighbor_index = neighbor.GetIdx()
                if neighbor_index in reference_block or neighbor_index not in mapped_reference:
                    continue
                product_neighbor = reference_to_product[neighbor_index]
                reference_bond = reference.GetBondBetweenAtoms(
                    reference_index, neighbor_index)
                product_bond = product.GetBondBetweenAtoms(product_index, product_neighbor)
                if (product_bond is not None
                        and reference_bond is not None
                        and product_bond.GetBondType() == reference_bond.GetBondType()):
                    retained_junctions.add(reference_index)
                    break
        released = reference_block - retained_junctions
        if not released:
            continue
        results.append({
            "id": f"mapped-ring-attachment-migration-{len(results) + 1}",
            "reason": "attachment-migration-within-mapped-biconnected-ring",
            "referenceBlockAtomNames": [reference_names[index]
                                        for index in sorted(reference_block)],
            "productBlockAtomIndices": [reference_to_product[index]
                                        for index in sorted(reference_block)],
            "referenceAttachmentAtomNames": [reference_names[index]
                                             for index in sorted(old_sites)],
            "productAttachmentReferenceAtomNames": [reference_names[index]
                                                    for index in sorted(new_sites)],
            "retainedJunctionReferenceAtomNames": [reference_names[index]
                                                   for index in sorted(retained_junctions)],
            "releasedReferenceAtomNames": [reference_names[index]
                                           for index in sorted(released)],
            "releasedProductAtomIndices": [reference_to_product[index]
                                           for index in sorted(released)],
        })
    return results


def secondary_exact_feature(reference: Chem.Mol, reference_names: list[str],
                            product: Chem.Mol,
                            primary_reference_match: tuple[int, ...],
                            primary_product_match: tuple[int, ...]) -> dict | None:
    """Find a second conserved graph region without making it a hard core.

    RDKit FMCS is connected.  Analogue rewrites can nevertheless retain two
    spatially meaningful pieces separated by changed connectivity.  We remove
    the primary hard MCS and run the same exact, complete-ring search on the
    remaining graph.  Every graph-symmetric atom map is retained for later
    coordinate-free pose ranking; the deterministic first map is used only to
    construct an initial seed.
    """
    reference_available = [index for index in range(reference.GetNumAtoms())
                           if index not in set(primary_reference_match)]
    product_available = [index for index in range(product.GetNumAtoms())
                         if index not in set(primary_product_match)]
    if len(reference_available) < 3 or len(product_available) < 3:
        return None
    reference_remainder, reference_origin = induced_subgraph(
        reference, reference_available)
    product_remainder, product_origin = induced_subgraph(product, product_available)
    result, reference_matches, product_matches = exact_mcs(
        reference_remainder, product_remainder)
    if result.numAtoms < 5:
        return None
    candidates = []
    seen = set()
    for reference_match in reference_matches:
        for product_match in product_matches:
            original_reference = tuple(reference_origin[index]
                                       for index in reference_match)
            original_product = tuple(product_origin[index]
                                     for index in product_match)
            reference_set, product_set = set(original_reference), set(original_product)
            if not any(set(ring).issubset(reference_set)
                       for ring in reference.GetRingInfo().AtomRings()):
                continue
            if not any(set(ring).issubset(product_set)
                       for ring in product.GetRingInfo().AtomRings()):
                continue
            key = (original_reference, original_product)
            if key in seen:
                continue
            seen.add(key)
            candidates.append((original_reference, original_product))
    candidates.sort(key=lambda pair: match_quality(
        reference, product, pair[0], pair[1]))
    if not candidates:
        return None
    selected_reference, selected_product = candidates[0]
    variants = [{
        "referenceAtomNames": [reference_names[index] for index in reference_match],
        "productAtomIndices": list(product_match),
    } for reference_match, product_match in candidates]
    return {
        "id": "secondary-exact-fragment-1",
        "kind": "conserved-fragment-rmsd",
        "transferMode": "seed-only",
        "treatment": "seed-only",
        "required": False,
        "source": "automatic-graph-proposal",
        "mcs": {"smarts": result.smartsString, "atoms": result.numAtoms,
                "bonds": result.numBonds},
        "referenceAtomNames": [reference_names[index]
                               for index in selected_reference],
        "productAtomIndices": list(selected_product),
        "mappingVariants": variants,
        "ambiguity": {
            "referenceMatches": len(reference_matches),
            "productMatches": len(product_matches),
            "candidateMaps": len(candidates),
            "selection": ("enumerate graph symmetry; retain the registered terminal "
                          "feature during pose search"),
        },
}


def apply_registered_feature_intent(feature: dict | None,
                                    intents: list[dict], step_id: str) -> dict | None:
    if feature is None:
        if intents:
            raise RuntimeError(f"{step_id}: registered retained feature was not detected")
        return None
    matching = [intent for intent in intents if intent["featureId"] == feature["id"]]
    if not matching:
        return feature
    if len(matching) != 1:
        raise RuntimeError(f"{step_id}: retained feature intent is ambiguous")
    intent = matching[0]
    if intent["kind"] != feature["kind"]:
        raise RuntimeError(f"{step_id}: retained feature kind does not match graph proposal")
    return {
        **feature,
        "transferMode": "score-only",
        "treatment": intent["treatment"],
        "required": intent["required"],
        "source": intent["source"],
        "registeredIntentId": intent["id"],
        "restraint": dict(intent["restraint"]),
    }


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


def build_pose_map(reference: Chem.Mol, reference_names: list[str],
                   product: Chem.Mol, step_id: str,
                   reference_match: tuple[int, ...],
                   product_match: tuple[int, ...], *, source: str,
                   mapping_record: dict, ambiguity: dict) -> tuple[dict, list[str]]:
    if len(reference_names) != reference.GetNumAtoms():
        raise RuntimeError(f"{step_id}: reference name count changed")
    if len(reference_match) != len(product_match) or not reference_match:
        raise RuntimeError(f"{step_id}: protected reference map is incomplete")
    if len(set(reference_match)) != len(reference_match):
        raise RuntimeError(f"{step_id}: protected reference atoms are duplicated")
    if len(set(product_match)) != len(product_match):
        raise RuntimeError(f"{step_id}: protected product atoms are duplicated")
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
        "source": source,
        "referenceHeavyAtoms": reference.GetNumAtoms(),
        "productHeavyAtoms": product.GetNumAtoms(),
        "commonHeavyAtoms": len(common),
        "commonReferenceFraction": round(len(common) / reference.GetNumAtoms(), 6),
        "commonProductFraction": round(len(common) / product.GetNumAtoms(), 6),
        **mapping_record,
        "ambiguity": ambiguity,
        "commonAtoms": common,
        "deletedReferenceAtoms": deleted,
        "addedProductAtoms": added,
        "referenceBoundary": reference_boundary,
        "productBoundary": product_boundary,
    }, product_names)


def pose_map(reference: Chem.Mol, reference_names: list[str],
             product: Chem.Mol, step_id: str,
             intents: list[dict]) -> tuple[dict, list[str]]:
    result, reference_matches, product_matches = exact_mcs(reference, product)
    candidates = [(reference_match, product_match)
                  for reference_match in reference_matches
                  for product_match in product_matches]
    reference_match, product_match = min(
        candidates, key=lambda pair: match_quality(reference, product, *pair))
    mapping, product_names = build_pose_map(
        reference, reference_names, product, step_id,
        reference_match, product_match,
        source=("reported molecular graphs plus deterministic local-context map; "
                "no later coordinates"),
        mapping_record={
            "mcs": {"smarts": result.smartsString, "atoms": result.numAtoms,
                    "bonds": result.numBonds},
        },
        ambiguity={
            "referenceMatches": len(reference_matches),
            "productMatches": len(product_matches),
            "candidateMaps": len(candidates),
            "selection": ("maximum local chemical-context preservation; "
                          "deterministic tie break"),
        },
    )
    secondary = apply_registered_feature_intent(secondary_exact_feature(
        reference, reference_names, product, reference_match, product_match),
        intents, step_id)
    if secondary:
        mapping["spatialFeatureCorrespondences"] = [secondary]
        mapping["seedMatchedHeavyAtoms"] = secondary["mcs"]["atoms"]
        mapping["totalReferencedHeavyAtoms"] = (
            mapping["commonHeavyAtoms"] + mapping["seedMatchedHeavyAtoms"])
    else:
        mapping["spatialFeatureCorrespondences"] = []
        mapping["seedMatchedHeavyAtoms"] = 0
        mapping["totalReferencedHeavyAtoms"] = mapping["commonHeavyAtoms"]

    migrations = migrated_mapped_ring_blocks(
        reference, reference_names, product, reference_match, product_match)
    mapping["mappedRingAttachmentMigrations"] = migrations
    released_names = {
        name for migration in migrations
        for name in migration["releasedReferenceAtomNames"]
    }
    released_product_indices = {
        atom_index for migration in migrations
        for atom_index in migration["releasedProductAtomIndices"]
    }
    mapping["releasedMappedAtoms"] = [
        {**entry,
         "reason": "attachment-migration-within-mapped-biconnected-ring"}
        for entry in mapping["commonAtoms"]
        if entry["referenceAtomName"] in released_names
    ]
    hard_common = [entry for entry in mapping["commonAtoms"]
                   if entry["referenceAtomName"] not in released_names]
    mapping["hardCoordinateHeavyAtoms"] = len(hard_common)
    mapping["releasedMappedHeavyAtoms"] = len(released_names)
    if released_names:
        hard_reference_indices = {entry["referenceAtomIndex"] for entry in hard_common}
        hard_bonds = block_bond_count(reference, hard_reference_indices)
        if len(hard_common) < 3:
            raise RuntimeError(
                f"{step_id}: attachment migration leaves fewer than three hard atoms")
        if released_product_indices != {
                entry["productAtomIndex"] for entry in mapping["releasedMappedAtoms"]}:
            raise RuntimeError(f"{step_id}: mapped ring release is internally inconsistent")
        mapping["protectedReferenceAnchor"] = {
            "method": "exact-common-subgraph-after-topology-release/v1",
            "label": "exact mapped atoms outside attachment-migrated ring blocks",
            "referenceAtomNames": [entry["referenceAtomName"] for entry in hard_common],
            "atoms": len(hard_common),
            "bonds": hard_bonds,
            "releasedRegions": [
                "mapped biconnected ring atoms affected by attachment migration",
                "unmapped deleted and added graph regions",
            ],
        }
        mapping["transitionExplanation"] = (
            "An edited region changes its attachment atom within a mapped "
            "biconnected ring. Conserved scaffold junctions remain hard; the "
            "other ring atoms are released from hard coordinates, and any "
            "separately conserved terminal feature is retained as registered designer intent.")
    return mapping, product_names


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
        ("finish-bay-293", "23", "preserve the proximal quinazoline-thiophene core while rebuilding the regioisomeric distal arm"),
    ]
    steps = []
    reference_names = hit_names
    for index, (reference_id, product_id) in enumerate(zip(sequence, sequence[1:])):
        step_id, compound, label = step_specs[index]
        intents = registered_intents(step_id)
        mapping, product_names = pose_map(
            molecules[reference_id], reference_names, molecules[product_id], step_id,
            intents)
        steps.append({
            "id": step_id, "sequenceIndex": index + 1,
            "referenceStateId": reference_id, "stateId": product_id,
            "productComponentId": product_id,
            "compound": compound, "label": label,
            "inputKind": "molecular-graph-only",
            "productSmiles": canonical[product_id],
            "productAtomNames": product_names,
            "retainedFeatureIntents": intents,
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
