#!/usr/bin/env python3
"""Independent RDKit, OpenMM, and ANI-2x scoring for Molarium pose packets."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import platform
import socket
import struct
import sys
import tempfile
from pathlib import Path
from typing import Any


BOND_TYPES: dict[float, Any] = {}
KJ_PER_KCAL = 4.184

# The web application intentionally has a top-level `rdkit/` asset directory. When this script is
# launched from the checkout root, Python can otherwise resolve that directory as a namespace
# package and shadow the installed scientific RDKit distribution. Keep the script directory, but
# remove only the checkout root/current-directory entry before any deferred scientific imports.
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path[:] = [entry for entry in sys.path
               if Path(entry or os.getcwd()).resolve() != REPOSITORY_ROOT]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def integrity_canonical(value: Any) -> str:
    if isinstance(value, list):
        return "[" + ",".join(integrity_canonical(entry) for entry in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(
            json.dumps(key, separators=(",", ":")) + ":" + integrity_canonical(value[key])
            for key in sorted(value)
        ) + "}"
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return json.dumps(value, separators=(",", ":"))
    if isinstance(value, (int, float)):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("integrity hashes require finite numbers")
        return json.dumps("~f64:" + struct.pack(">d", number).hex(), separators=(",", ":"))
    raise TypeError(f"unsupported integrity value {type(value)!r}")


def canonical_sha256(value: Any) -> str:
    return sha256_bytes(integrity_canonical(value).encode())


def topology_of(record: dict[str, Any]) -> dict[str, Any]:
    def normalized_order(value: Any) -> int | float:
        number = float(value)
        return int(number) if number.is_integer() else number

    bonds = [{"a": min(int(bond["a"]), int(bond["b"])),
              "b": max(int(bond["a"]), int(bond["b"])),
              "order": normalized_order(bond.get("order", 1)),
              "aromatic": bool(bond.get("aromatic", float(bond.get("order", 1)) == 1.5))}
             for bond in record.get("bonds", [])]
    bonds.sort(key=lambda bond: (bond["a"], bond["b"], bond["order"], bond["aromatic"]))
    return {"atoms": [{"atomId": atom["atomId"], "element": atom["element"],
                       "formalCharge": int(atom.get("formalCharge", atom.get("charge", 0)) or 0),
                       "aromatic": bool(atom.get("aromatic", False))}
                      for atom in record["atoms"]], "bonds": bonds}


def validate_integrity(pose: dict[str, Any]) -> None:
    record = pose["molecule"]
    integrity = pose.get("integrity")
    if not isinstance(integrity, dict):
        raise ValueError(f"{pose['id']}: missing packet integrity record")
    atom_ids = [atom.get("atomId") for atom in record["atoms"]]
    if any(not isinstance(atom_id, str) or not atom_id for atom_id in atom_ids):
        raise ValueError(f"{pose['id']}: persistent atom IDs are required")
    if len(set(atom_ids)) != len(atom_ids):
        raise ValueError(f"{pose['id']}: persistent atom IDs are not unique")
    expected = {
        "atomOrderSha256": canonical_sha256(atom_ids),
        "topologySha256": canonical_sha256(topology_of(record)),
        "coordinatesSha256": canonical_sha256(coordinates(record)),
        "numericSystemSha256": canonical_sha256(record["parameterization"]["system"])
        if record.get("parameterization", {}).get("system") else None,
        "atomCount": len(record["atoms"]),
        "bondCount": len(record.get("bonds", [])),
    }
    for key, value in expected.items():
        if integrity.get(key) != value:
            raise ValueError(f"{pose['id']}: integrity mismatch for {key}")


def require_finite(value: float, label: str) -> float:
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(f"{label} is not finite")
    return value


def coordinates(molecule: dict[str, Any]) -> list[list[float]]:
    result = []
    for index, atom in enumerate(molecule["atoms"]):
        result.append([require_finite(atom[axis], f"atom {index} {axis}") for axis in "xyz"])
    return result


def rdkit_molecule(record: dict[str, Any]):
    from rdkit import Chem

    global BOND_TYPES
    if not BOND_TYPES:
        BOND_TYPES = {
            1.0: Chem.BondType.SINGLE,
            1.5: Chem.BondType.AROMATIC,
            2.0: Chem.BondType.DOUBLE,
            3.0: Chem.BondType.TRIPLE,
        }
    editable = Chem.RWMol()
    for source in record["atoms"]:
        atom = Chem.Atom(str(source["element"]))
        atom.SetFormalCharge(int(source.get("formalCharge", source.get("charge", 0)) or 0))
        atom.SetNoImplicit(True)
        editable.AddAtom(atom)
    for source in record.get("bonds", []):
        order = float(source.get("order", 1))
        if order not in BOND_TYPES:
            raise ValueError(f"unsupported bond order {order}")
        editable.AddBond(int(source["a"]), int(source["b"]), BOND_TYPES[order])
    molecule = editable.GetMol()
    Chem.SanitizeMol(molecule)
    conformer = Chem.Conformer(molecule.GetNumAtoms())
    for index, point in enumerate(coordinates(record)):
        conformer.SetAtomPosition(index, point)
    molecule.AddConformer(conformer, assignId=True)
    return molecule


def aligned_heavy_rms(reference, candidate) -> float | None:
    from rdkit.Chem import rdMolAlign

    atom_map = [(atom.GetIdx(), atom.GetIdx()) for atom in reference.GetAtoms()
                if atom.GetAtomicNum() > 1]
    if not atom_map:
        return None
    return float(rdMolAlign.AlignMol(candidate, reference, atomMap=atom_map))


def score_mmff94(record: dict[str, Any]) -> dict[str, Any]:
    from rdkit import Chem, rdBase
    from rdkit.Chem import AllChem

    molecule = rdkit_molecule(record)
    reference = Chem.Mol(molecule)
    properties = AllChem.MMFFGetMoleculeProperties(molecule, mmffVariant="MMFF94")
    if properties is None:
        raise ValueError("RDKit could not assign complete MMFF94 parameters")
    field = AllChem.MMFFGetMoleculeForceField(molecule, properties, confId=0)
    initial = float(field.CalcEnergy())
    status = int(field.Minimize(maxIts=2000, forceTol=1.0e-4, energyTol=1.0e-8))
    final = float(field.CalcEnergy())
    return {
        "engine": "RDKit MMFF94",
        "rdkitVersion": rdBase.rdkitVersion,
        "initialEnergyKcalMol": initial,
        "relaxedEnergyKcalMol": final,
        "relaxationDropKcalMol": initial - final,
        "minimizerStatus": status,
        "heavyAtomAlignedRmsAngstrom": aligned_heavy_rms(reference, molecule),
    }


def build_openmm_system(numeric: dict[str, Any]):
    import openmm

    schemas = {
        "particles": ({"mass_amu"}, {"index"}),
        "constraints": ({"i", "j", "distance_nm"}, set()),
        "bonds": ({"i", "j", "r0_nm", "k_kj_nm2"}, set()),
        "angles": ({"i", "j", "k", "theta0_rad", "k_kj_rad2"}, set()),
        "torsions": ({"i", "j", "k", "l", "periodicity", "phase_rad", "k_kj"}, set()),
        "nonbonded": ({"charge_e", "sigma_nm", "epsilon_kj"}, {"index"}),
        "exceptions": ({"i", "j", "chargeprod_e2", "sigma_nm", "epsilon_kj"}, set()),
    }
    unsupported = set(numeric) - set(schemas)
    missing_classes = set(schemas) - set(numeric)
    if unsupported:
        raise ValueError(f"unsupported numeric System force classes: {sorted(unsupported)}")
    if missing_classes:
        raise ValueError(f"numeric System omits force classes: {sorted(missing_classes)}")
    atom_count = len(numeric["particles"])
    if len(numeric["nonbonded"]) != atom_count:
        raise ValueError("numeric System nonbonded count differs from particle count")
    atom_index_fields = {"constraints": ("i", "j"), "bonds": ("i", "j"),
                         "angles": ("i", "j", "k"),
                         "torsions": ("i", "j", "k", "l"),
                         "exceptions": ("i", "j")}
    for name, (required, optional) in schemas.items():
        if not isinstance(numeric[name], list):
            raise ValueError(f"numeric System {name} must be an array")
        for ordinal, term in enumerate(numeric[name]):
            keys = set(term)
            if not required <= keys or keys - required - optional:
                raise ValueError(f"numeric System {name}[{ordinal}] has unsupported fields")
            if "index" in term and int(term["index"]) != ordinal:
                raise ValueError(f"numeric System {name}[{ordinal}] index changes atom order")
            for field in atom_index_fields.get(name, ()):
                if int(term[field]) not in range(atom_count):
                    raise ValueError(f"numeric System {name}[{ordinal}] atom index is out of range")

    system = openmm.System()
    bond_force = openmm.HarmonicBondForce()
    angle_force = openmm.HarmonicAngleForce()
    torsion_force = openmm.PeriodicTorsionForce()
    nonbonded_force = openmm.NonbondedForce()
    nonbonded_force.setNonbondedMethod(openmm.NonbondedForce.NoCutoff)
    nonbonded_force.setUseDispersionCorrection(False)
    for particle in numeric["particles"]:
        system.addParticle(float(particle["mass_amu"]))
    for term in numeric.get("constraints", []):
        system.addConstraint(int(term["i"]), int(term["j"]), float(term["distance_nm"]))
    for term in numeric.get("bonds", []):
        bond_force.addBond(int(term["i"]), int(term["j"]), float(term["r0_nm"]),
                           float(term["k_kj_nm2"]))
    for term in numeric.get("angles", []):
        angle_force.addAngle(int(term["i"]), int(term["j"]), int(term["k"]),
                             float(term["theta0_rad"]), float(term["k_kj_rad2"]))
    for term in numeric.get("torsions", []):
        torsion_force.addTorsion(int(term["i"]), int(term["j"]), int(term["k"]), int(term["l"]),
                                 int(term["periodicity"]), float(term["phase_rad"]),
                                 float(term["k_kj"]))
    for term in numeric["nonbonded"]:
        nonbonded_force.addParticle(float(term["charge_e"]), float(term["sigma_nm"]),
                                    float(term["epsilon_kj"]))
    for term in numeric.get("exceptions", []):
        nonbonded_force.addException(int(term["i"]), int(term["j"]),
                                     float(term["chargeprod_e2"]), float(term["sigma_nm"]),
                                     float(term["epsilon_kj"]))
    for force in (bond_force, angle_force, torsion_force, nonbonded_force):
        system.addForce(force)
    system.addForce(openmm.CMMotionRemover(1))
    return system


def score_openmm(record: dict[str, Any], platform_name: str) -> dict[str, Any]:
    import numpy as np
    import openmm
    from openmm import unit

    numeric = record.get("parameterization", {}).get("system")
    if not numeric:
        raise ValueError("pose packet has no exported numeric System")
    if len(numeric.get("particles", [])) != len(record["atoms"]):
        raise ValueError("numeric System particle count does not match coordinates")
    system = build_openmm_system(numeric)
    integrator = openmm.VerletIntegrator(0.001)
    selected_platform = openmm.Platform.getPlatformByName(platform_name)
    properties = {}
    if platform_name == "CUDA":
        properties = {"Precision": "double", "DeterministicForces": "true"}
    context = openmm.Context(system, integrator, selected_platform, properties)
    context.setPositions(np.asarray(coordinates(record), dtype=np.float64) * unit.angstrom)
    state = context.getState(getEnergy=True, getForces=True)
    energy_kj = float(state.getPotentialEnergy().value_in_unit(unit.kilojoule_per_mole))
    forces = np.asarray(state.getForces(asNumpy=True).value_in_unit(
        unit.kilojoule_per_mole / unit.nanometer), dtype=np.float64)
    version_module = getattr(openmm, "version", None)
    openmm_version = getattr(version_module, "version", None) or getattr(openmm, "__version__", None)
    result = {
        "engine": "OpenMM",
        "openmmVersion": openmm_version,
        "platform": selected_platform.getName(),
        "potentialEnergyKjMol": energy_kj,
        "potentialEnergyKcalMol": energy_kj / KJ_PER_KCAL,
        "forceRmsKjMolNm": float(np.sqrt(np.mean(forces * forces))),
        "forceMaxAbsKjMolNm": float(np.max(np.abs(forces))),
        "forceSha256": sha256_bytes(forces.tobytes()),
    }
    del context, integrator
    return result


_ANI_MODELS: dict[str, Any] = {}


def ani_model(device: str):
    import torchani

    if device not in _ANI_MODELS:
        model = torchani.models.ANI2x(periodic_table_index=True, device=device)
        model.eval()
        _ANI_MODELS[device] = model
    return _ANI_MODELS[device]


def score_ani2x(record: dict[str, Any], device: str) -> dict[str, Any]:
    import numpy as np
    import torch
    import torchani
    from rdkit import Chem

    atomic_numbers = [int(Chem.GetPeriodicTable().GetAtomicNumber(
        str(atom["element"]))) for atom in record["atoms"]]
    supported = {1, 6, 7, 8, 9, 16, 17}
    unsupported = sorted(set(atomic_numbers) - supported)
    if unsupported:
        raise ValueError(f"ANI-2x unsupported atomic numbers: {unsupported}")
    formal_charge = sum(int(atom.get("formalCharge", atom.get("charge", 0)) or 0)
                        for atom in record["atoms"])
    electron_count = sum(atomic_numbers) - formal_charge
    if formal_charge != 0 or electron_count % 2:
        raise ValueError("ANI-2x oracle requires a neutral, closed-shell pose packet")
    model = ani_model(device)
    species = torch.tensor([atomic_numbers], dtype=torch.long, device=device)
    start = torch.tensor([coordinates(record)], dtype=torch.float32, device=device)
    positions = start.clone().detach().requires_grad_(True)

    def energy():
        return model((species, positions)).energies.sum()

    with torch.no_grad():
        initial = float(model((species, start)).energies.item())
    optimizer = torch.optim.LBFGS([positions], lr=0.5, max_iter=500,
                                  tolerance_grad=1.0e-5, tolerance_change=1.0e-9,
                                  line_search_fn="strong_wolfe")

    def closure():
        optimizer.zero_grad()
        value = energy()
        value.backward()
        return value

    optimizer.step(closure)
    with torch.no_grad():
        final = float(model((species, positions)).energies.item())
    before = start.detach().cpu().numpy()[0]
    after = positions.detach().cpu().numpy()[0]
    heavy = np.asarray([number > 1 for number in atomic_numbers])
    # Kabsch alignment prevents rigid translation/rotation from inflating the strain displacement.
    left = before[heavy] - before[heavy].mean(axis=0)
    right = after[heavy] - after[heavy].mean(axis=0)
    u, _, vh = np.linalg.svd(right.T @ left)
    rotation = u @ vh
    if np.linalg.det(rotation) < 0:
        u[:, -1] *= -1
        rotation = u @ vh
    aligned = right @ rotation
    rms = float(np.sqrt(np.mean(np.sum((aligned - left) ** 2, axis=1))))
    hartree_to_kcal = 627.5094740631
    return {
        "engine": "TorchANI ANI-2x",
        "torchaniVersion": getattr(torchani, "__version__", None),
        "torchVersion": torch.__version__,
        "device": str(device),
        "deviceName": torch.cuda.get_device_name(0) if device.startswith("cuda") else platform.processor(),
        "initialEnergyHartree": initial,
        "relaxedEnergyHartree": final,
        "relaxationDropKcalMol": (initial - final) * hartree_to_kcal,
        "heavyAtomAlignedRmsAngstrom": rms,
    }


def engine_error(engine: str, error: Exception) -> dict[str, Any]:
    return {"engine": engine, "status": "unavailable", "error": f"{type(error).__name__}: {error}"}


def process_pose(pose: dict[str, Any], arguments: argparse.Namespace) -> dict[str, Any]:
    record = pose["molecule"]
    validate_integrity(pose)
    result: dict[str, Any] = {
        "id": pose["id"],
        "caseId": pose.get("caseId"),
        "inputSha256": sha256_bytes(json.dumps(pose, sort_keys=True,
                                                separators=(",", ":")).encode()),
        "atomCount": len(record["atoms"]),
    }
    engines: list[dict[str, Any]] = []
    requests = []
    if arguments.mmff94:
        requests.append(("RDKit MMFF94", lambda: score_mmff94(record)))
    for name in arguments.openmm_platform:
        requests.append((f"OpenMM {name}", lambda name=name: score_openmm(record, name)))
    if arguments.ani2x:
        requests.append(("TorchANI ANI-2x", lambda: score_ani2x(record, arguments.ani_device)))
    for name, operation in requests:
        try:
            engines.append(operation())
        except Exception as error:  # retain per-pose failures in a massive panel
            if arguments.require_engines:
                raise
            engines.append(engine_error(name, error))
    result["engines"] = engines
    openmm_results = {entry.get("platform"): entry for entry in engines
                      if entry.get("engine") == "OpenMM" and "potentialEnergyKjMol" in entry}
    if "Reference" in openmm_results and "CUDA" in openmm_results:
        result["openmmParity"] = {
            "absoluteEnergyDeltaKjMol": abs(openmm_results["Reference"]["potentialEnergyKjMol"]
                                             - openmm_results["CUDA"]["potentialEnergyKjMol"]),
            "referenceForceSha256": openmm_results["Reference"]["forceSha256"],
            "cudaForceSha256": openmm_results["CUDA"]["forceSha256"],
        }
    return result


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--shard-index", type=int, default=0)
    parser.add_argument("--shard-count", type=int, default=1)
    parser.add_argument("--mmff94", action="store_true")
    parser.add_argument("--openmm-platform", action="append", default=[])
    parser.add_argument("--ani2x", action="store_true")
    parser.add_argument("--ani-device", default="cuda")
    parser.add_argument("--require-engines", action="store_true")
    result = parser.parse_args()
    if result.shard_count < 1 or not 0 <= result.shard_index < result.shard_count:
        parser.error("shard index must be inside shard count")
    if not (result.mmff94 or result.openmm_platform or result.ani2x):
        parser.error("select at least one engine")
    return result


def main() -> None:
    arguments = parse_arguments()
    raw = arguments.input.read_bytes()
    payload = json.loads(raw)
    if payload.get("schema") != "molarium.analogue-pose-panel/v1":
        raise ValueError("unsupported panel schema")
    poses = payload.get("poses")
    if not isinstance(poses, list) or not all(isinstance(entry, dict) and entry.get("id")
                                              for entry in poses):
        raise ValueError("panel poses must be a list with unique ids")
    if len({entry["id"] for entry in poses}) != len(poses):
        raise ValueError("panel pose ids are not unique")
    selected = [pose for index, pose in enumerate(poses)
                if index % arguments.shard_count == arguments.shard_index]
    started = dt.datetime.now(dt.timezone.utc)
    results = [process_pose(pose, arguments) for pose in selected]
    output = {
        "schema": "molarium.independent-panel-results/v1",
        "inputSha256": sha256_bytes(raw),
        "protocol": payload.get("protocol"),
        "shard": {"index": arguments.shard_index, "count": arguments.shard_count,
                  "selectedPoseCount": len(selected), "totalPoseCount": len(poses)},
        "host": {"hostname": socket.gethostname(), "platform": platform.platform(),
                 "slurmJobId": os.environ.get("SLURM_JOB_ID"),
                 "slurmArrayTaskId": os.environ.get("SLURM_ARRAY_TASK_ID")},
        "startedAt": started.isoformat(),
        "completedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "results": results,
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=arguments.output.parent, delete=False,
                                     prefix=arguments.output.name + ".", suffix=".tmp") as handle:
        json.dump(output, handle, indent=2, sort_keys=True)
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(arguments.output)
    print(f"wrote {arguments.output} ({len(results)} poses)")


if __name__ == "__main__":
    main()
