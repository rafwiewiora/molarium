# Molarium third-party notices and provenance

This file records the software, model, scientific-data and design sources used by Molarium.
It is an attribution and release checklist, not a replacement for the complete license texts
linked below.

## Interface and molecular viewer

Molarium's interface and molecular viewer are implemented in this repository. The viewer is a
custom HTML Canvas renderer in `app.js`; it does not bundle Atomiverse, `xyzrender`, Mol*, 3Dmol.js
or Three.js.

The Molarium logo, mark, and animated calculation indicator are original assets implemented in
this repository and covered by Molarium's MIT License.

Early interface direction was inspired by [Atomiverse](https://atomiverse.com/). This is an
acknowledgement of visual inspiration, not a statement of affiliation, endorsement, shared code,
or a software dependency.

## Bundled software and scientific assets

| Component | Version or artifact | Use in Molarium | License / notice |
| --- | --- | --- | --- |
| OpenMM | 8.2.0 WebAssembly build | Reference energies, forces, minimization and dynamics | MIT; [`openmm/OPENMM-LICENSE.txt`](./openmm/OPENMM-LICENSE.txt) |
| RDKit | `Release_2025_03_4`, commit `276b5a6` | SMILES, ETKDGv3, MMFF94/UFF, Gasteiger charges and chemical perception | BSD-3-Clause; [`rdkit/RDKIT-LICENSE.txt`](./rdkit/RDKIT-LICENSE.txt) |
| Dimorphite-DL | 2.0.2, commit `1166e1f7` | Ordered empirical ionizable-site SMARTS and pKa distributions used by the browser protonation enumerator | Apache-2.0; [`licenses/DIMORPHITE-DL-NOTICE.txt`](./licenses/DIMORPHITE-DL-NOTICE.txt) and [complete license text](./licenses/APACHE-2.0-LICENSE.txt) |
| OpenFF force fields | Sage 2.1.0 and described Rosemary alpha fixtures | Force-field parameters and prepared numeric systems | CC BY 4.0; [`openff/OPENFF-FORCEFIELDS-LICENSE.txt`](./openff/OPENFF-FORCEFIELDS-LICENSE.txt) |
| TorchANI / ANI-2x | TorchANI 2.8.1 state exported to ONNX | ANI-2x model parameters and reference implementation provenance | MIT; [`mlip/TORCHANI-LICENSE.txt`](./mlip/TORCHANI-LICENSE.txt) |
| ONNX Runtime Web | 1.27.0 | Browser WebGPU/WASM execution of ONNX models | MIT; [`licenses/ONNXRUNTIME-LICENSE.txt`](./licenses/ONNXRUNTIME-LICENSE.txt); [complete vendored v1.27.0 third-party notices](./licenses/ONNXRUNTIME-1.27.0-THIRD-PARTY-NOTICES.txt) ([upstream](https://github.com/microsoft/onnxruntime/blob/v1.27.0/ThirdPartyNotices.txt)) |
| OpenFold | source revision `be2ec184`; `finetuning_no_templ_ptm_1.pt` | Exported fixed-shape OpenFold 2 browser models | Source Apache-2.0; parameters CC BY 4.0; [`licenses/OPENFOLD-LICENSE.txt`](./licenses/OPENFOLD-LICENSE.txt) and [`MODEL-CARD.md`](./openfold-export-results/trained/MODEL-CARD.md) |
| PDBFixer | preparation behavior reference | Reference for conservative protein-repair behavior; not a bundled Python runtime | MIT; [`licenses/PDBFIXER-LICENSE.txt`](./licenses/PDBFIXER-LICENSE.txt) |

The `stormm/` code is a Molarium WebGPU ensemble engine inspired by fixed-point and stacked-system
ideas. It is not an official STORMM port and does not bundle the native STORMM codebase. Its local
license is [`stormm/LICENSE`](./stormm/LICENSE).

The vendored ONNX Runtime notice is the complete unmodified file from tag `v1.27.0`: 325,054
bytes, Git blob `fbd9f9a95f6013d8ecaef81e02b0033e5882a675`, SHA-256
`0e07b95f3a8d6230037707c5c4a2b554d12c4cb67369669ac255635528ffcee2`.

## External services and scientific data

- The bundled launch structure in [`assets/lsd-launch.mol`](./assets/lsd-launch.mol) is the
  PubChem 3D conformer for lysergic acid diethylamide, CID 5761, retrieved 2026-08-18. The
  application records the CID and stereospecific SMILES alongside the coordinates.
- PDB coordinates and Chemical Component Dictionary records are retrieved from the
  [RCSB Protein Data Bank](https://www.rcsb.org/) only when requested by the user.
- Protein MSA searches use the user-configurable
  [ColabFold](https://github.com/sokrypton/ColabFold)-compatible endpoint shown in the interface.
  Protein sequences are sent to that endpoint; folding inference remains local.

## Suggested scientific citations

- Eastman, P. et al. *OpenMM 8: Molecular Dynamics Simulation with Machine Learning Potentials.*
  J. Phys. Chem. B (2024). [DOI](https://doi.org/10.1021/acs.jpcb.3c06662)
- Boothroyd, S. et al. *Development and Benchmarking of Open Force Field 2.0.0: The Sage Small
  Molecule Force Field.* J. Chem. Theory Comput. (2023).
  [DOI](https://doi.org/10.1021/acs.jctc.3c00039)
- Gao, X. et al. *TorchANI: A Free and Open Source PyTorch-Based Deep Learning Implementation of
  the ANI Neural Network Potentials.* J. Chem. Inf. Model. (2020).
  [DOI](https://doi.org/10.1021/acs.jcim.0c00451)
- Ahdritz, G. et al. *OpenFold: Retraining AlphaFold2 yields new insights into its learning
  mechanisms and capacity for generalization.* Nature Methods (2024).
  [DOI](https://doi.org/10.1038/s41592-024-02272-z)
- Mirdita, M. et al. *ColabFold: making protein folding accessible to all.*
  Nature Methods (2022). [DOI](https://doi.org/10.1038/s41592-022-01488-1)
- Ropp, P. J. et al. *Dimorphite-DL: an open-source program for enumerating the ionization
  states of drug-like small molecules.* J. Cheminform. (2019).
  [DOI](https://doi.org/10.1186/s13321-019-0336-9)

RDKit releases and citation metadata are maintained by the
[RDKit project](https://www.rdkit.org/) and its archived releases.

## Molarium license

Molarium's original code is licensed under the [MIT License](./LICENSE), copyright 2026 Molarium
contributors. That license does not replace or modify the separate terms governing the bundled
software, model parameters, force fields, and scientific data listed above.
