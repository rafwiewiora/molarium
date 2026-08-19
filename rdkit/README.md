# RDKit MMFF94/UFF browser engine

Molarium uses the BSD-licensed RDKit implementation of MMFF94, with genuine
UFF as a fallback when MMFF94 cannot parameterize a molecule. The generated
WebAssembly module runs in a worker and returns energies in kcal/mol.

`forcefield.cpp` is a narrow extension to RDKit MinimalLib. It exposes energy,
BFGS geometry optimization with saved frames, and short Langevin dynamics using
RDKit's analytical force-field gradients. It does not reimplement or alter the
MMFF94/UFF potential terms or parameter tables.

Geometry jobs can fix an explicit set of atoms. Molarium uses that feature for
automatic builder cleanup: the new or replaced atoms, two bonded shells,
attached hydrogens, and every touched fused ring system are movable. All other
atoms remain fixed while still contributing to the force-field energy. The
user-invoked Optimize action remains a whole-molecule optimization.

The bridge also exposes RDKit's real ETKDGv3 conformer generator. Conformer
search requests use deterministic seeds, symmetry-aware heavy-atom RMS pruning,
and a short MMFF94 (or genuine UFF fallback) polish before the coordinates enter
Molarium's batched Sage/WebGPU refinement path.

The same bridge exposes deterministic Gasteiger charges and mapped SMIRKS
matches to the OpenFF Sage browser parameterizer. It also applies the complete,
ordered Dimorphite-DL 2.0.2 empirical ionizable-site table to enumerate
pH-dependent ligand states. RDKit performs every SMARTS match and formal-charge /
explicit-hydrogen edit in WebAssembly; the selected state is then embedded with
ETKDGv3. The displayed state weights are an independent Henderson-Hasselbalch
ranking from empirical site means, not coupled microscopic pKa predictions.
Matching enumerates
symmetry-related embeddings and normalizes the target molecule to Sage's MDL
aromaticity model before parameter assignment.

## Rebuilding

Install CMake and Emscripten, then run:

```sh
bash rdkit/build-wasm.sh /path/to/rdkit-Release_2025_03_4
```

The build is pinned to RDKit tag `Release_2025_03_4`, commit
`276b5a662302c6a548ac4f1363c066f3258e3a20`. Generated files are written to
`rdkit/dist/`. The checked-in artifacts are:

- `RDKit_minimal.js`: 127,197 bytes, SHA-256
  `8fbe5a895562b7a86afb226b6e04caeab53acd86ffce3fdc59a3922a5df21659`
- `RDKit_minimal.wasm`: 5,634,149 bytes, SHA-256
  `813445a8b8459f6c44e65e572d4d674d58010fe7acd225ff06e054a3105abb94`

RDKit's BSD license is reproduced in `RDKIT-LICENSE.txt`.
