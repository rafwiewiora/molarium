#!/usr/bin/env python3
"""Compile OpenFF Sage 2.1.0 OFFXML into browser-native OpenMM units.

This is a deterministic data conversion only.  SMIRKS matching happens in the
browser with RDKit and the resulting numeric system is integrated by OpenMM.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path

KCAL_TO_KJ = 4.184
ANGSTROM_TO_NM = 0.1


def number(value: str) -> float:
    match = re.match(r"\s*([-+0-9.eE]+)", value)
    if match is None:
        raise ValueError(f"Could not read numeric value from {value!r}")
    return float(match.group(1))


def parameters(root: ET.Element, handler: str) -> list[ET.Element]:
    element = root.find(handler)
    if element is None:
        raise ValueError(f"OFFXML is missing {handler}")
    return list(element)


def compile_forcefield(source: Path) -> dict:
    source_bytes = source.read_bytes()
    root = ET.fromstring(source_bytes)
    if root.attrib.get("aromaticity_model") != "OEAroModel_MDL":
        raise ValueError("Only the Sage OEAroModel_MDL aromaticity model is supported")

    constraints = []
    for item in parameters(root, "Constraints"):
        entry = {"id": item.attrib["id"], "smirks": item.attrib["smirks"]}
        if "distance" in item.attrib:
            entry["distance_nm"] = number(item.attrib["distance"]) * ANGSTROM_TO_NM
        constraints.append(entry)

    bonds = []
    for item in parameters(root, "Bonds"):
        bonds.append({
            "id": item.attrib["id"],
            "smirks": item.attrib["smirks"],
            "length_nm": number(item.attrib["length"]) * ANGSTROM_TO_NM,
            # kcal mol-1 A-2 -> kJ mol-1 nm-2
            "k_kj_nm2": number(item.attrib["k"]) * KCAL_TO_KJ / (ANGSTROM_TO_NM**2),
        })

    angles = []
    for item in parameters(root, "Angles"):
        angles.append({
            "id": item.attrib["id"],
            "smirks": item.attrib["smirks"],
            "angle_rad": math.radians(number(item.attrib["angle"])),
            "k_kj_rad2": number(item.attrib["k"]) * KCAL_TO_KJ,
        })

    def torsions(handler: str, improper: bool) -> list[dict]:
        compiled = []
        for item in parameters(root, handler):
            terms = []
            index = 1
            while f"k{index}" in item.attrib:
                divisor = number(item.attrib.get(f"idivf{index}", "3" if improper else "1"))
                terms.append({
                    "periodicity": int(item.attrib[f"periodicity{index}"]),
                    "phase_rad": math.radians(number(item.attrib[f"phase{index}"])),
                    "k_kj": number(item.attrib[f"k{index}"]) * KCAL_TO_KJ / divisor,
                })
                index += 1
            compiled.append({
                "id": item.attrib["id"],
                "smirks": item.attrib["smirks"],
                "terms": terms,
            })
        return compiled

    vdw_handler = root.find("vdW")
    electrostatics = root.find("Electrostatics")
    if vdw_handler is None or electrostatics is None:
        raise ValueError("OFFXML is missing nonbonded handlers")
    vdw = []
    for item in vdw_handler:
        if "sigma" in item.attrib:
            sigma_nm = number(item.attrib["sigma"]) * ANGSTROM_TO_NM
        else:
            rmin_nm = 2 * number(item.attrib["rmin_half"]) * ANGSTROM_TO_NM
            sigma_nm = rmin_nm / (2 ** (1 / 6))
        vdw.append({
            "id": item.attrib["id"],
            "smirks": item.attrib["smirks"],
            "sigma_nm": sigma_nm,
            "epsilon_kj": number(item.attrib["epsilon"]) * KCAL_TO_KJ,
        })

    return {
        "schema": 1,
        "name": "OpenFF Sage 2.1.0",
        "source": source.name,
        "source_sha256": hashlib.sha256(source_bytes).hexdigest(),
        "aromaticity_model": root.attrib["aromaticity_model"],
        "charge_model": "Gasteiger (RDKit, 12 iterations)",
        "handlers": {
            "constraints": constraints,
            "bonds": bonds,
            "angles": angles,
            "proper_torsions": torsions("ProperTorsions", False),
            "improper_torsions": torsions("ImproperTorsions", True),
            "vdw": vdw,
        },
        "scales": {
            "electrostatics14": float(electrostatics.attrib["scale14"]),
            "vdw14": float(vdw_handler.attrib["scale14"]),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("offxml", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    compiled = compile_forcefield(args.offxml)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(compiled, separators=(",", ":")) + "\n")
    print(
        f"Wrote {args.output}: "
        + ", ".join(f"{name}={len(values)}" for name, values in compiled["handlers"].items())
    )


if __name__ == "__main__":
    main()
