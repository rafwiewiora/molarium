# Molarium CCD-1

Molarium CCD-1 is an independent, browser-oriented protocol for reference-core and required
hydrogen-bond constrained ligand docking. It is the first Molarium feature organized explicitly as
a reproducible-method implementation: the executable protocol, scientific lineage, exclusions,
seeds, geometric constraints, run events, and result hashes travel together.

## Scientific lineage

The design is informed by the staged-search separation described for Glide and by ICM's use of
internal-coordinate sampling and soft restraints. Glide's public API distinguishes reference-ligand
core constraints from receptor H-bond constraints; ICM's public documentation describes
flat-bottom interaction restraints and reference-ligand tethers. Version 0.3 adds an independent,
receptor-aware torsion Monte Carlo stage. Rowan's open-source `openconf` analogue mode informed the
free-terminal-rotor/exact-core boundary; the AutoPose preprint is recorded as a related R-group pose
construction approach. Molarium does not execute or copy either method. It does not
implement either product's grids, search, refinement, or scoring function.

- Friesner RA et al. *Glide: a new approach for rapid, accurate docking and scoring. 1. Method and
  assessment of docking accuracy.* J Med Chem. 2004;47:1739-1749.
  [doi:10.1021/jm0306430](https://doi.org/10.1021/jm0306430)
- Totrov M, Abagyan R. *Flexible protein-ligand docking by global energy optimization in internal
  coordinates.* Proteins. 1997;Suppl 1:215-220.
  [PubMed 9485515](https://pubmed.ncbi.nlm.nih.gov/9485515/)
- [Schrodinger public Glide constraint API](https://learn.schrodinger.com/public/python_api/2025-3/api/schrodinger.application.glide.constraints.html)
- [MolSoft public interaction-restraint documentation](https://www.molsoft.com/gui/interaction-restraints.html)
- [MolSoft public ligand-tether and template documentation](https://www.molsoft.com/gui/ligand-tether.html)
- [Rowan Scientific `openconf`](https://github.com/rowansci/openconf) (MIT-licensed method
  inspiration; no source code is bundled or copied)
- Ponzoni L, York F, Kelley B. *AutoPose: R-Group Decomposition Based Posing for RBFE.* ChemRxiv
  (2026). [doi:10.26434/chemrxiv.15004703/v1](https://doi.org/10.26434/chemrxiv.15004703/v1)

This is not a port or reimplementation of either commercial product. Molarium does not use
proprietary source code, Glide grids, GlideScore, ICM grids, ICM Score, or undisclosed product
defaults. The published ideas are reproduced with explicit Molarium geometry, sampling, physical
energy, and penalty definitions.

## Executable boundary

Version `0.3.0` implements and tests:

- least-squares reference-core alignment;
- exact reference-coordinate snapping for every mapped core atom plus an independent RMSD audit;
- explicit donor-hydrogen-acceptor distance and angle audits;
- required-H-bond feasibility and transparent penalty scoring;
- deterministic feasible-first pose ranking;
- stable atom identities for edit-derived reference cores;
- a deterministic Metropolis torsion search that rotates only graph branches containing no core atom;
- hard feasible-state retention for required contacts during search;
- a transparent receptor-site score using cross OpenFF Lennard-Jones and Coulomb terms plus relative
  vacuum OpenFF Sage 2.1 intramolecular ligand energy;
- deterministic in-browser ETKDGv3 conformer generation and core alignment;
- a compact Build-mode setup, top-five pose selector, and pose application that leaves the receptor fixed;
- input and protocol SHA-256 hashes;
- an append-only, hash-chained run labbook with JSON and Markdown representations.

The receptor is rigid. There is no receptor grid, induced-fit refinement, solvation/desolvation
term, entropy model, or binding-free-energy estimate. The cross score uses the captured receptor's
numeric nonbonded terms, fresh edited-ligand OpenFF terms, an explicit relative dielectric of 4,
and relative vacuum OpenFF Sage ligand energy measured from the lowest fixed-core starting seed. RDKit
MMFF94/UFF still prepares the initial ETKDG conformers but is not the final strain score. The result is a
pose-ranking score, not a binding affinity.

The browser gate uses a synthetic protein–ligand fixture to execute capture, add a new ligand atom,
discard stale complex parameters, freshly parameterize the edited ligand with OpenFF/OpenMM WASM,
run RDKit WASM generation, rank the constrained poses, replay them deterministically, verify the
hash chain, and apply a pose without moving the receptor. It also proves that a removed contact atom
is disabled and explicitly logged rather than silently remapped. Accuracy claims still require prospective
cognate-redocking and cross-docking benchmarks; version 0.3 must be presented as experimental until
those are added.

## Labbook design

The shareable audit records hashes of the exact receptor and ligand inputs rather than embedding
their coordinates. This lets a user establish that two runs used identical proprietary structures
without disclosing those structures. It records:

- application and protocol version;
- immutable protocol snapshot and hash;
- input labels, atom counts, and SHA-256 hashes;
- explicit core atom mapping and required H-bond selections;
- omitted or unavailable reference contacts and their reason;
- random seed and every non-default setting;
- torsion definitions, proposal schedule, acceptance/improvement counts, and per-conformer outcomes;
- runtime/backend information supplied by the browser;
- ordered stage events linked by SHA-256;
- constraint geometry, scores, selected pose, and final labbook hash.

Run the local unit gate with:

```sh
npm run test:docking
npm test
```

The detailed evidence and decision history is maintained in [`DECISIONS.md`](./DECISIONS.md).
Run-specific scientific rationale can be appended as ordinary `decision` or `note` labbook events;
those entries receive the same hashes as calculation-stage events.
