#!/usr/bin/env python3
"""Export an exact OpenFF Rosemary/OpenMM protein System for browser regression.

This utility deliberately delegates protein chemical perception and NAGL charge
assignment to the official OpenFF stack.  The resulting JSON contains only the
numeric System terms consumed by Molarium's OpenMM and direct WebGPU workers.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import openmm
from openmm import unit as omm_unit
from openff.toolkit import ForceField, Molecule, Topology
from openff.units import unit as off_unit


RESTYPE_1 = {
    "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C",
    "GLN": "Q", "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I",
    "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P",
    "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V",
}


def value(quantity, target):
    return float(quantity.value_in_unit(target))


def export_system(system: openmm.System) -> dict:
    result = {
        "particles": [
            {"mass_amu": value(system.getParticleMass(i), omm_unit.dalton)}
            for i in range(system.getNumParticles())
        ],
        "constraints": [], "bonds": [], "angles": [], "torsions": [],
        "nonbonded": [], "exceptions": [],
    }
    for index in range(system.getNumConstraints()):
        i, j, distance = system.getConstraintParameters(index)
        result["constraints"].append({
            "i": i, "j": j,
            "distance_nm": value(distance, omm_unit.nanometer),
        })
    for force_index in range(system.getNumForces()):
        force = system.getForce(force_index)
        if isinstance(force, openmm.HarmonicBondForce):
            for index in range(force.getNumBonds()):
                i, j, length, k = force.getBondParameters(index)
                result["bonds"].append({
                    "i": i, "j": j,
                    "r0_nm": value(length, omm_unit.nanometer),
                    "k_kj_nm2": value(k, omm_unit.kilojoule_per_mole / omm_unit.nanometer**2),
                })
        elif isinstance(force, openmm.HarmonicAngleForce):
            for index in range(force.getNumAngles()):
                i, j, k_atom, angle, k = force.getAngleParameters(index)
                result["angles"].append({
                    "i": i, "j": j, "k": k_atom,
                    "theta0_rad": value(angle, omm_unit.radian),
                    "k_kj_rad2": value(k, omm_unit.kilojoule_per_mole / omm_unit.radian**2),
                })
        elif isinstance(force, openmm.PeriodicTorsionForce):
            for index in range(force.getNumTorsions()):
                i, j, k_atom, l, periodicity, phase, k = force.getTorsionParameters(index)
                result["torsions"].append({
                    "i": i, "j": j, "k": k_atom, "l": l,
                    "periodicity": periodicity,
                    "phase_rad": value(phase, omm_unit.radian),
                    "k_kj": value(k, omm_unit.kilojoule_per_mole),
                })
        elif isinstance(force, openmm.NonbondedForce):
            for index in range(force.getNumParticles()):
                charge, sigma, epsilon = force.getParticleParameters(index)
                result["nonbonded"].append({
                    "index": index,
                    "charge_e": value(charge, omm_unit.elementary_charge),
                    "sigma_nm": value(sigma, omm_unit.nanometer),
                    "epsilon_kj": value(epsilon, omm_unit.kilojoule_per_mole),
                })
            for index in range(force.getNumExceptions()):
                i, j, charge_product, sigma, epsilon = force.getExceptionParameters(index)
                result["exceptions"].append({
                    "i": i, "j": j,
                    "chargeprod_e2": value(charge_product, omm_unit.elementary_charge**2),
                    "sigma_nm": value(sigma, omm_unit.nanometer),
                    "epsilon_kj": value(epsilon, omm_unit.kilojoule_per_mole),
                })
    if len(result["nonbonded"]) != system.getNumParticles():
        raise RuntimeError("The OpenMM System did not contain one supported NonbondedForce")
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdb", type=Path)
    parser.add_argument("offxml", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--model",
        default="experimental structure 1L2Y",
        help="Human-readable coordinate provenance stored in prediction.model",
    )
    parser.add_argument(
        "--minimize-iterations",
        type=int,
        default=0,
        help="Optionally minimize the exported coordinates with OpenMM Reference",
    )
    args = parser.parse_args()
    if args.minimize_iterations < 0:
        parser.error("--minimize-iterations must be non-negative")

    molecule = Molecule.from_polymer_pdb(str(args.pdb))
    topology = Topology.from_molecules([molecule])
    force_field = ForceField(str(args.offxml))
    interchange = force_field.create_interchange(topology)
    system = interchange.to_openmm_system()
    positions = interchange.positions.m_as(off_unit.angstrom)
    minimization = None
    if args.minimize_iterations:
        integrator = openmm.VerletIntegrator(0.001 * omm_unit.picosecond)
        context = openmm.Context(
            system,
            integrator,
            openmm.Platform.getPlatformByName("Reference"),
        )
        context.setPositions(interchange.positions.to_openmm())
        initial = context.getState(getEnergy=True).getPotentialEnergy()
        openmm.LocalEnergyMinimizer.minimize(
            context,
            tolerance=10.0 * omm_unit.kilojoule_per_mole / omm_unit.nanometer,
            maxIterations=args.minimize_iterations,
        )
        final = context.getState(getEnergy=True, getPositions=True)
        positions = final.getPositions(asNumpy=True).value_in_unit(omm_unit.angstrom)
        minimization = {
            "platform": "OpenMM Reference",
            "maxIterations": args.minimize_iterations,
            "toleranceKjMolNm": 10.0,
            "initialEnergyKcalMol": value(initial, omm_unit.kilocalorie_per_mole),
            "finalEnergyKcalMol": value(final.getPotentialEnergy(), omm_unit.kilocalorie_per_mole),
        }

    residues = []
    seen_residues = set()
    atoms = []
    for index, atom in enumerate(molecule.atoms):
        metadata = atom.metadata
        chain = str(metadata.get("chain_id", "A")).strip() or "A"
        residue_number = int(str(metadata.get("residue_number", "1")).strip())
        residue_name = str(metadata.get("residue_name", "UNK")).strip()
        residue_key = (chain, residue_number)
        if residue_key not in seen_residues:
            seen_residues.add(residue_key)
            residues.append((chain, residue_number, residue_name))
        atoms.append({
            "element": atom.symbol,
            "atomName": atom.name,
            "residueName": residue_name,
            "residueIndex": residue_number,
            "chain": chain,
            "x": float(positions[index, 0]),
            "y": float(positions[index, 1]),
            "z": float(positions[index, 2]),
            "charge": int(atom.formal_charge.m),
            "aromatic": bool(atom.is_aromatic),
            "plddt": 100.0,
        })
    bonds = [{
        "a": bond.atom1_index,
        "b": bond.atom2_index,
        "order": 1.5 if bond.is_aromatic else float(bond.bond_order),
        "topology": "protein",
    } for bond in molecule.bonds]
    sequence = "".join(RESTYPE_1.get(name, "X") for _, _, name in residues)
    forcefield_name = "OpenFF Rosemary 3.0.0-alpha0"
    charge_model = "NAGL openff-gnn-am1bcc-1.0.0"
    source = {
        "pdb": args.pdb.name,
        "forcefield": args.offxml.name,
        "forcefieldSha256": hashlib.sha256(args.offxml.read_bytes()).hexdigest(),
    }
    if minimization is not None:
        source["minimization"] = minimization
    payload = {
        "schema": 1,
        "source": source,
        "molecule": {
            "atoms": atoms,
            "bonds": bonds,
            "name": f"Rosemary alpha · {len(residues)}-residue protein",
            "smiles": f"Protein sequence · {len(residues)} aa",
            "charge": int(molecule.total_charge.m),
            "multiplicity": 1,
            "prediction": {
                "sequence": sequence,
                "meanPlddt": 100.0,
                "ptm": None,
                "msaDepth": None,
                "provider": "PDB",
                "recycles": 0,
                "model": args.model,
            },
            "parameterization": {
                "forcefield": forcefield_name,
                "chargeModel": charge_model,
                "sourceSha256": hashlib.sha256(args.offxml.read_bytes()).hexdigest(),
                "system": export_system(system),
            },
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    counts = {name: len(terms) for name, terms in payload["molecule"]["parameterization"]["system"].items()}
    print(f"Wrote {args.output}: {len(atoms)} atoms, {len(bonds)} bonds, {counts}")


if __name__ == "__main__":
    main()
