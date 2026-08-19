# Molarium CCD-1

Molarium CCD-1 is an independent, browser-oriented protocol for reference-core and required
hydrogen-bond constrained ligand docking. It is the first Molarium feature organized explicitly as
a reproducible-method implementation: the executable protocol, scientific lineage, exclusions,
seeds, geometric constraints, run events, and result hashes travel together.

## Scientific lineage

The protocol adopts the staged-search idea described for Glide by Friesner et al.: broad pose
generation, torsional optimization, then refinement and ranking. Glide's public API distinguishes
reference-ligand core constraints from receptor H-bond constraints. The protocol also adopts the
ICM pattern of internal-coordinate sampling followed by local minimization, and the flat-bottom
soft-restraint semantics documented for ICM interaction restraints and ligand tethers.

- Friesner RA et al. *Glide: a new approach for rapid, accurate docking and scoring. 1. Method and
  assessment of docking accuracy.* J Med Chem. 2004;47:1739-1749.
  [doi:10.1021/jm0306430](https://doi.org/10.1021/jm0306430)
- Totrov M, Abagyan R. *Flexible protein-ligand docking by global energy optimization in internal
  coordinates.* Proteins. 1997;Suppl 1:215-220.
  [PubMed 9485515](https://pubmed.ncbi.nlm.nih.gov/9485515/)
- [Schrodinger public Glide constraint API](https://learn.schrodinger.com/public/python_api/2025-3/api/schrodinger.application.glide.constraints.html)
- [MolSoft public interaction-restraint documentation](https://www.molsoft.com/gui/interaction-restraints.html)
- [MolSoft public ligand-tether and template documentation](https://www.molsoft.com/gui/ligand-tether.html)

This is not a port or reimplementation of either commercial product. Molarium does not use
proprietary source code, Glide grids, GlideScore, ICM grids, ICM Score, or undisclosed product
defaults. The published ideas are reproduced with explicit Molarium geometry, sampling, physical
energy, and penalty definitions.

## Executable boundary

Version `0.1.0` implements and tests:

- least-squares reference-core alignment;
- positional core RMSD and a flat-bottom harmonic penalty;
- explicit donor-hydrogen-acceptor distance and angle audits;
- required-H-bond feasibility and transparent penalty scoring;
- deterministic feasible-first pose ranking;
- stable atom identities for edit-derived reference cores;
- an engine-independent constrained-docking orchestrator with physical-score and refinement hooks;
- input and protocol SHA-256 hashes;
- an append-only, hash-chained run labbook with JSON and Markdown representations.

The orchestrator accepts conformer coordinates but browser conformer generation and pocket refinement
are deliberately marked `not-yet-integrated` in the
protocol manifest. They must not be presented as complete until the UI path, reference redocking
fixtures, and prospective edited-ligand tests pass.

## Labbook design

The shareable audit records hashes of the exact receptor and ligand inputs rather than embedding
their coordinates. This lets a user establish that two runs used identical proprietary structures
without disclosing those structures. It records:

- application and protocol version;
- immutable protocol snapshot and hash;
- input labels, atom counts, and SHA-256 hashes;
- explicit core atom mapping and required H-bond selections;
- random seed and every non-default setting;
- runtime/backend information supplied by the browser;
- ordered stage events linked by SHA-256;
- constraint geometry, scores, selected pose, and final labbook hash.

Run the local unit gate with:

```sh
node docking/test.mjs
```

The detailed evidence and decision history is maintained in [`DECISIONS.md`](./DECISIONS.md).
Run-specific scientific rationale can be appended as ordinary `decision` or `note` labbook events;
those entries receive the same hashes as calculation-stage events.
