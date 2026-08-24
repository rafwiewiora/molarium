#!/usr/bin/env python3
"""Compare OpenMM WASM single points with the same bridge linked to native OpenMM."""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import math
import struct
from pathlib import Path
from typing import Any


KJ_PER_KCAL = 4.184


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def double_array(values: list[float]):
    return (ctypes.c_double * len(values))(*map(float, values)) if values else None


def integer_array(values: list[int]):
    return (ctypes.c_int * len(values))(*map(int, values)) if values else None


def field(terms: list[dict[str, Any]], name: str) -> list[Any]:
    return [term[name] for term in terms]


def rms(values: list[float]) -> float:
    return math.sqrt(sum(value * value for value in values) / len(values))


def vector_parity(first: list[float], second: list[float]) -> dict[str, float]:
    if len(first) != len(second) or not first:
        raise ValueError("force arrays differ in length")
    delta = [left - right for left, right in zip(first, second)]
    delta_rms = rms(delta)
    return {"forceRmsDelta": delta_rms,
            "forceMaxAbsDelta": max(map(abs, delta)),
            "forceRelativeRms": delta_rms / max(rms(first), 1.0e-30)}


def configure_bridge(library):
    i = ctypes.c_int
    d = ctypes.c_double
    ip = ctypes.POINTER(i)
    dp = ctypes.POINTER(d)
    library.molarium_initialize_sage.argtypes = [
        i, dp, dp,
        i, ip, ip, dp,
        i, ip, ip, dp, dp,
        i, ip, ip, ip, dp, dp,
        i, ip, ip, ip, ip, ip, dp, dp,
        dp, dp, dp,
        i, ip, ip, dp, dp, dp,
        i, dp, dp, d, d,
    ]
    library.molarium_initialize_sage.restype = i
    library.molarium_get_potential_energy.restype = d
    library.molarium_get_forces.argtypes = [dp, i]
    library.molarium_get_forces.restype = i
    library.molarium_last_error.restype = ctypes.c_char_p
    library.molarium_openmm_version.restype = ctypes.c_char_p
    library.molarium_destroy.argtypes = []


def score(library, molecule: dict[str, Any]) -> tuple[float, list[float]]:
    system = molecule["parameterization"]["system"]
    constraints = system["constraints"]
    bonds = system["bonds"]
    angles = system["angles"]
    torsions = system["torsions"]
    exceptions = system["exceptions"]
    arrays = [
        double_array(field(system["particles"], "mass_amu")),
        double_array([coordinate for atom in molecule["atoms"]
                      for coordinate in (atom["x"], atom["y"], atom["z"])]),
        integer_array(field(constraints, "i")), integer_array(field(constraints, "j")),
        double_array(field(constraints, "distance_nm")),
        integer_array(field(bonds, "i")), integer_array(field(bonds, "j")),
        double_array(field(bonds, "r0_nm")), double_array(field(bonds, "k_kj_nm2")),
        integer_array(field(angles, "i")), integer_array(field(angles, "j")),
        integer_array(field(angles, "k")), double_array(field(angles, "theta0_rad")),
        double_array(field(angles, "k_kj_rad2")),
        integer_array(field(torsions, "i")), integer_array(field(torsions, "j")),
        integer_array(field(torsions, "k")), integer_array(field(torsions, "l")),
        integer_array(field(torsions, "periodicity")),
        double_array(field(torsions, "phase_rad")), double_array(field(torsions, "k_kj")),
        double_array(field(system["nonbonded"], "charge_e")),
        double_array(field(system["nonbonded"], "sigma_nm")),
        double_array(field(system["nonbonded"], "epsilon_kj")),
        integer_array(field(exceptions, "i")), integer_array(field(exceptions, "j")),
        double_array(field(exceptions, "chargeprod_e2")),
        double_array(field(exceptions, "sigma_nm")),
        double_array(field(exceptions, "epsilon_kj")),
    ]
    ok = library.molarium_initialize_sage(
        len(molecule["atoms"]), arrays[0], arrays[1],
        len(constraints), arrays[2], arrays[3], arrays[4],
        len(bonds), arrays[5], arrays[6], arrays[7], arrays[8],
        len(angles), arrays[9], arrays[10], arrays[11], arrays[12], arrays[13],
        len(torsions), arrays[14], arrays[15], arrays[16], arrays[17], arrays[18],
        arrays[19], arrays[20], arrays[21], arrays[22], arrays[23],
        len(exceptions), arrays[24], arrays[25], arrays[26], arrays[27], arrays[28],
        0, None, None, 0.001, 0.0,
    )
    if not ok:
        raise RuntimeError(library.molarium_last_error().decode())
    try:
        energy = float(library.molarium_get_potential_energy())
        output = (ctypes.c_double * (len(molecule["atoms"]) * 3))()
        if not library.molarium_get_forces(output, len(output)):
            raise RuntimeError(library.molarium_last_error().decode())
        return energy, list(output)
    finally:
        library.molarium_destroy()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--wasm-results", type=Path, required=True)
    parser.add_argument("--native-library", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    packet_bytes = arguments.input.read_bytes()
    wasm_bytes = arguments.wasm_results.read_bytes()
    packet = json.loads(packet_bytes)
    wasm = json.loads(wasm_bytes)
    if packet.get("schema") != "molarium.analogue-pose-panel/v1":
        raise ValueError("unsupported pose packet schema")
    if wasm.get("schema") != "molarium.openmm-wasm-single-points/v1":
        raise ValueError("unsupported WASM result schema")
    wasm_by_id = {entry["id"]: entry for entry in wasm["poses"]}
    library = ctypes.CDLL(str(arguments.native_library.resolve()))
    configure_bridge(library)
    native_version = library.molarium_openmm_version().decode()
    results = []
    for pose in packet["poses"]:
        wasm_pose = wasm_by_id.get(pose["id"])
        if not wasm_pose:
            raise ValueError(f"{pose['id']}: missing WASM single point")
        energy_kj, forces = score(library, pose["molecule"])
        comparison = {
            "absoluteEnergyDeltaKcalMol": abs(
                wasm_pose["energyKcalMol"] - energy_kj / KJ_PER_KCAL),
            **vector_parity(wasm_pose["forcesKjMolNm"], forces),
            "forceDeltaUnit": "kJ/mol/nm",
        }
        comparison["gate"] = {
            "passed": comparison["absoluteEnergyDeltaKcalMol"] <= 1.0e-2
                      and comparison["forceRelativeRms"] <= 1.0e-3,
            "maximumAbsoluteEnergyDelta": 1.0e-2,
            "energyUnit": "kcal/mol",
            "maximumForceRelativeRms": 1.0e-3,
        }
        native_force_bytes = b"".join(struct.pack("=d", value) for value in forces)
        results.append({"id": pose["id"], "atomCount": len(pose["molecule"]["atoms"]),
                        "wasmPotentialEnergyKcalMol": wasm_pose["energyKcalMol"],
                        "nativePotentialEnergyKcalMol": energy_kj / KJ_PER_KCAL,
                        "nativeForceRmsKjMolNm": rms(forces),
                        "nativeForceMaxAbsKjMolNm": max(map(abs, forces)),
                        "nativeForceSha256": sha256_bytes(native_force_bytes),
                        "comparison": comparison})
    report = {
        "schema": "molarium.openmm-wasm-native-validation/v1",
        "source": {"packetSha256": sha256_bytes(packet_bytes),
                   "wasmResultsSha256": sha256_bytes(wasm_bytes),
                   "nativeLibrarySha256": sha256_bytes(arguments.native_library.read_bytes()),
                   "openmmVersion": native_version,
                   "wasm": wasm["source"]},
        "gate": {"passed": all(entry["comparison"]["gate"]["passed"]
                                for entry in results),
                 "poseCount": len(results)},
        "poses": results,
    }
    arguments.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(f"wrote {arguments.output} ({len(results)} poses; gate={report['gate']['passed']})")


if __name__ == "__main__":
    main()
