#!/usr/bin/env python3
"""Measure matched MMFF94 strain for exported 7KPA reference/edited ligands."""

import argparse
import hashlib
import json
import math
from pathlib import Path

from rdkit import Chem, rdBase
from rdkit.Chem import AllChem, rdMolAlign


RING_ATOM_NAMES = {"O3", "C28", "N3", "C26", "C27", "C29", "C30"}
BOND_TYPES = {
    1.0: Chem.BondType.SINGLE,
    1.5: Chem.BondType.AROMATIC,
    2.0: Chem.BondType.DOUBLE,
    3.0: Chem.BondType.TRIPLE,
}


def molecule_from_record(record):
    editable = Chem.RWMol()
    for source in record["atoms"]:
        atom = Chem.Atom(source["element"])
        atom.SetFormalCharge(int(source.get("formalCharge", source.get("charge", 0)) or 0))
        atom.SetNoImplicit(True)
        editable.AddAtom(atom)
    for source in record["bonds"]:
        order = float(source.get("order", 1))
        if order not in BOND_TYPES:
            raise ValueError(f"Unsupported bond order: {order}")
        editable.AddBond(int(source["a"]), int(source["b"]), BOND_TYPES[order])
    molecule = editable.GetMol()
    Chem.SanitizeMol(molecule)
    conformer = Chem.Conformer(molecule.GetNumAtoms())
    for index, source in enumerate(record["atoms"]):
        conformer.SetAtomPosition(index, (source["x"], source["y"], source["z"]))
    molecule.AddConformer(conformer, assignId=True)
    return molecule


def displacement(reference, candidate, atom_indices):
    before = reference.GetConformer()
    after = candidate.GetConformer()
    distances = [math.dist(tuple(before.GetAtomPosition(index)),
                           tuple(after.GetAtomPosition(index))) for index in atom_indices]
    return {
        "rmsAngstrom": math.sqrt(sum(value * value for value in distances) / len(distances)),
        "meanAngstrom": sum(distances) / len(distances),
        "maximumAngstrom": max(distances),
    }


def forcefield(molecule):
    properties = AllChem.MMFFGetMoleculeProperties(molecule, mmffVariant="MMFF94")
    if properties is None:
        raise ValueError("RDKit could not assign complete MMFF94 parameters")
    return AllChem.MMFFGetMoleculeForceField(molecule, properties, confId=0)


def full_relaxation(record):
    molecule = molecule_from_record(record)
    reference = Chem.Mol(molecule)
    field = forcefield(molecule)
    initial = field.CalcEnergy()
    status = field.Minimize(maxIts=2000, forceTol=1.0e-4, energyTol=1.0e-8)
    final = field.CalcEnergy()
    heavy = [index for index, atom in enumerate(record["atoms"]) if atom["element"] != "H"]
    aligned_rms = rdMolAlign.AlignMol(molecule, reference, atomMap=[(index, index) for index in heavy])
    return {
        "initialEnergyKcalMol": initial,
        "finalEnergyKcalMol": final,
        "relaxationEnergyDropKcalMol": initial - final,
        "minimizerStatus": status,
        "heavyAtomAlignedRmsAngstrom": aligned_rms,
        "heavyAtomDisplacement": displacement(reference, molecule, heavy),
    }


def transformed_ring_relaxation(record):
    molecule = molecule_from_record(record)
    reference = Chem.Mol(molecule)
    ring = {index for index, atom in enumerate(record["atoms"])
            if atom.get("atomName") in RING_ATOM_NAMES}
    movable = set(ring)
    for index in ring:
        movable.update(neighbor.GetIdx() for neighbor in molecule.GetAtomWithIdx(index).GetNeighbors()
                       if neighbor.GetSymbol() == "H")
    field = forcefield(molecule)
    for index in set(range(molecule.GetNumAtoms())) - movable:
        field.AddFixedPoint(index)
    initial = field.CalcEnergy()
    status = field.Minimize(maxIts=2000, forceTol=1.0e-4, energyTol=1.0e-8)
    final = field.CalcEnergy()
    return {
        "initialEnergyKcalMol": initial,
        "finalEnergyKcalMol": final,
        "relaxationEnergyDropKcalMol": initial - final,
        "minimizerStatus": status,
        "movableAtomCount": len(movable),
        "movableAtomDisplacement": displacement(reference, molecule, sorted(movable)),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("fixture", type=Path,
                        help="JSON exported with MOLARIUM_EXPORT_STRAIN_FIXTURE")
    arguments = parser.parse_args()
    raw = arguments.fixture.read_bytes()
    payload = json.loads(raw)
    if set(payload) != {"reference", "edited"}:
        raise ValueError("Expected matched reference and edited ligand records")
    result = {
        "schema": "molarium.7kpa-matched-strain/v1",
        "inputSha256": hashlib.sha256(raw).hexdigest(),
        "rdkitVersion": rdBase.rdkitVersion,
        "forcefield": "MMFF94",
        "environment": "isolated ligand in vacuum",
        "fullRelaxation": {name: full_relaxation(record) for name, record in payload.items()},
        "transformedRingRelaxation": {
            name: transformed_ring_relaxation(record) for name, record in payload.items()
        },
    }
    result["editedMinusReferenceFullStrainKcalMol"] = (
        result["fullRelaxation"]["edited"]["relaxationEnergyDropKcalMol"]
        - result["fullRelaxation"]["reference"]["relaxationEnergyDropKcalMol"]
    )
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
