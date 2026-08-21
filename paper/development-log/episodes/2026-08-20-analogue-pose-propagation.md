# Debugging episode: analogue edits, pose propagation, and required contacts

- **Date:** 2026-08-20
- **Status:** fixed and regression-tested
- **Area:** protein–ligand analogue pose construction
- **Protocol:** `molarium-pose-propagation-1` version `0.3.0`

## Trigger

The first constrained-docking interface asked the user to select a ligand core manually. During
testing, the user recognized that a compound edited inside Molarium already has a stronger mapping:

> “why should we have to be selecting a core, why not just do the MCS of design vs reference?”

> “can't every compound with a consistent core be described as an edit from a reference and we
> would just reproduce the edit->minimize paths as a user would do in the viewer?”

Molarium therefore records stable atom identities through graph edits and uses every surviving
same-element reference heavy atom as the inherited scaffold. It does not infer an MCS when the edit
lineage is available.

## Failure observed during methyl editing

After capturing a 41-heavy-atom reference ligand, the user added a methyl group and observed:

> “then add Me … whole ring rotates”

> “high energy poses only”

> “apply 1 … bent bond to Me”

The generic local MMFF cleanup expanded a touched ring into one movable unit. That is reasonable for
an isolated molecule, but it silently changed the trusted bound scaffold before pose propagation.
The original browser test had added an atom through a direct helper and therefore missed the real
canvas edit and automatic-cleanup path.

## Resolution

After reference capture, **Preserve reference** is now the default edit cleanup. All surviving
same-element reference heavy atoms remain exact; new atoms and hydrogens may move. **Free local
cleanup** exposes the earlier two-bond-neighborhood and fused-ring rule when intentional local
re-equilibration is wanted. Every cleanup event and its fixed/movable counts are appended to the run
labbook.

At the protocol boundary, candidates are aligned and every inherited heavy atom is hard-snapped to
its captured coordinate. Only graph branches containing no inherited atom are eligible for torsion
Monte Carlo. Fixed-scaffold OpenFF Sage relaxation is accepted only when it preserves required-contact
feasibility and improves the complete receptor-aware objective.

## Rejected donor-hydrogen hypothesis

A required ligand-donor contact contains a directional degree of freedom that heavy-atom fixation
does not determine: its explicit donor hydrogen. The first implementation hypothesis pointed that H
directly toward the captured acceptor. Independent review rejected this before commit because it
could manufacture a linear contact while violating the donor's local valence or planarity.

Version 0.3 instead restores a surviving required-contact hydrogen to its exact captured coordinate.
It never invents a D–H–A direction. The normal distance and angle audit still determines whether the
contact is feasible. Receptor-donor contacts are unchanged.

The same review found that a crystallographic water could participate in a captured required contact
without being included in the rigid protein-site hash. Capture now hashes the 8 Å receptor site plus
every fixed receptor or water contact participant and refuses a run if one is removed, changes
element, or moves by more than `1e-6 Å`.

## Validation

The browser regression uses the real canvas **Add C** operation on a prepared phenyl reference. It
requires all six inherited aromatic carbons to remain bit-for-bit fixed, the new aryl–methyl bond to
remain between `1.35` and `1.65 Å`, the cleanup history to name `preserve-reference`, and the entire
ring to become movable only after explicitly selecting `free-local`.

Run:

```sh
npm run test:docking
npm test
npm run test:2d
npm run build:web
npm run manifest:local
npm run test:local-lab
```

On 2026-08-20, the source feature branch passed 434/434 browser checks and 5/5 focused 2D checks.
After integration with `dev`, the docking unit gate passed, the main browser gate passed 435/435
checks, the expanded RDKit 2D gate passed 17/17 checks with 0.0000 px repeated-click drift, the production build produced 60 files
(10.32 MiB), the transcript-export regression passed, and the Local Lab privacy gate passed 14/14
checks with no external request reaching its pre-network interceptor. The first integrated focused
2D run timed out while starting Chrome inside the restricted process sandbox; it passed without a
code change when rerun with local Chrome permission.

## Evidence and limits

Implementation commit `0c90ebb` contains the fix and curated source log. Exact protocol constants,
prior-method provenance, rejected alternatives, and release gates live in
`docking/POSE-PROPAGATION-PROTOCOL.md`, `docking/protocol.mjs`, and `docking/DECISIONS.md`.

This is an experimental pose-preparation and ranking protocol, not a binding-free-energy method or
an induced-fit docking engine. Accuracy claims still require cognate redocking, analogue-pose
recovery, seed sensitivity, and held-out comparison against native published baselines. The private
Codex rollout contains the surrounding conversation and screenshots; publication use requires a
separately reviewed redacted transcript and reviewed image exports.
