#!/usr/bin/env python3
"""Turn a Molarium OpenFold validation prediction into a prepared protein PDB.

The OpenFold NPZ stores atom37 heavy-atom coordinates.  Rosemary expects an
explicit, hydrogen-complete polymer, so this utility writes the predicted
heavy atoms and lets PDBFixer add terminal atoms and hydrogens at the selected
pH.  It does not fetch any structure or alter the predicted heavy-atom
coordinates.
"""

from __future__ import annotations

import argparse
import json
import random
import tempfile
from pathlib import Path

import numpy
import openmm
from openmm.app import PDBFile
from pdbfixer import PDBFixer


ATOM_TYPES = (
    "N", "CA", "C", "CB", "O", "CG", "CG1", "CG2", "OG", "OG1", "SG",
    "CD", "CD1", "CD2", "ND1", "ND2", "OD1", "OD2", "SD", "CE", "CE1",
    "CE2", "CE3", "NE", "NE1", "NE2", "OE1", "OE2", "CH2", "NH1", "NH2",
    "OH", "CZ", "CZ2", "CZ3", "NZ", "OXT",
)
RESTYPE_3 = {
    "A": "ALA", "R": "ARG", "N": "ASN", "D": "ASP", "C": "CYS",
    "Q": "GLN", "E": "GLU", "G": "GLY", "H": "HIS", "I": "ILE",
    "L": "LEU", "K": "LYS", "M": "MET", "F": "PHE", "P": "PRO",
    "S": "SER", "T": "THR", "W": "TRP", "Y": "TYR", "V": "VAL",
}


def heavy_atom_pdb(sequence: str, positions, mask) -> str:
    lines = []
    serial = 1
    for residue_index, letter in enumerate(sequence):
        residue_name = RESTYPE_3.get(letter)
        if residue_name is None:
            raise ValueError(f"Unsupported residue {letter!r} at position {residue_index + 1}")
        for atom_index, atom_name in enumerate(ATOM_TYPES):
            if mask[residue_index, atom_index] < 0.5:
                continue
            x, y, z = positions[residue_index, atom_index]
            lines.append(
                f"ATOM  {serial:5d} {atom_name:>4s} {residue_name:>3s} A{residue_index + 1:4d}    "
                f"{x:8.3f}{y:8.3f}{z:8.3f}  1.00  0.00          {atom_name[0]:>2s}"
            )
            serial += 1
    return "\n".join(lines) + "\nEND\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("panel", type=Path, help="Molarium OpenFold validation panel.json")
    parser.add_argument("prediction", type=Path, help="Native OpenFold prediction NPZ")
    parser.add_argument("sample_id", help="Sample id in the validation panel")
    parser.add_argument("output", type=Path, help="Hydrogen-complete output PDB")
    parser.add_argument("--ph", type=float, default=7.0)
    parser.add_argument("--seed", type=int, default=20260817)
    args = parser.parse_args()

    panel = json.loads(args.panel.read_text())
    sample = next((item for item in panel["samples"] if item["id"] == args.sample_id), None)
    if sample is None:
        parser.error(f"sample {args.sample_id!r} is not present in {args.panel}")
    sequence = sample["sequence"]
    archive = numpy.load(args.prediction)
    positions = archive["positions"][0]
    mask = archive["atom_mask"][0]
    expected_shape = (sample["bucketResidues"], len(ATOM_TYPES))
    if positions.shape != (*expected_shape, 3) or mask.shape != expected_shape:
        raise ValueError(
            f"Unexpected atom37 arrays: positions {positions.shape}, mask {mask.shape}; "
            f"expected {(*expected_shape, 3)} and {expected_shape}"
        )

    with tempfile.TemporaryDirectory(prefix="molarium-openfold-pdb-") as directory:
        heavy_path = Path(directory) / "heavy.pdb"
        heavy_path.write_text(heavy_atom_pdb(sequence, positions, mask))
        fixer = PDBFixer(filename=str(heavy_path))
        fixer.platform = openmm.Platform.getPlatformByName("Reference")
        fixer.findMissingResidues()
        fixer.findNonstandardResidues()
        fixer.replaceNonstandardResidues()
        fixer.removeHeterogens(False)
        fixer.findMissingAtoms()
        fixer.addMissingAtoms(seed=args.seed)
        random.seed(args.seed)
        fixer.addMissingHydrogens(args.ph)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w") as handle:
            PDBFile.writeFile(fixer.topology, fixer.positions, handle, keepIds=True)

    atom_count = sum(1 for _ in fixer.topology.atoms())
    hydrogen_count = sum(1 for atom in fixer.topology.atoms() if atom.element.symbol == "H")
    print(
        f"Wrote {args.output}: {len(sequence)} residues, {atom_count} atoms "
        f"({hydrogen_count} hydrogens), pH {args.ph:g}, seed {args.seed}"
    )


if __name__ == "__main__":
    main()
