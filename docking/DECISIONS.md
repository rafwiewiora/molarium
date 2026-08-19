# Molarium CCD-1 decision ledger

This ledger records the evidence, assumptions, implementation choices, rejected alternatives,
observed failures, and open questions behind the constrained-docking protocol. It is deliberately
more detailed than the user-facing method description. It records engineering rationale, not a
private model reasoning trace.

## 2026-08-19 — method survey

### Question

Can Molarium implement core-constrained, required-H-bond constrained docking as a reproducible
published-method feature while avoiding unsupported claims about Glide or ICM?

### Local capabilities observed

- RDKit WebAssembly already creates deterministic ETKDGv3 conformer ensembles and MMFF94/UFF
  minimized coordinates.
- Molarium already identifies protein, ligand, water, pocket residues, explicit hydrogen bonds,
  aromatic stacks, and movable pocket atoms.
- Direct WebGPU can minimize selected atoms while holding the remainder of a complete numeric
  molecular System fixed.
- Existing conformer analysis already contains Horn rigid fitting, symmetry-aware RMSD, clustering,
  deterministic seeds, and SDF export.
- There was no existing docking engine or docking-specific provenance schema.

### Primary and official evidence consulted

1. Friesner RA et al., *Glide: a new approach for rapid, accurate docking and scoring. 1. Method
   and assessment of docking accuracy*, J Med Chem. 2004. DOI `10.1021/jm0306430`.
   The abstract describes broad conformational/orientational/positional search, rough screening,
   torsional optimization on a receptor potential grid, Monte Carlo refinement, and final ranking.
2. Totrov M and Abagyan R, *Flexible protein-ligand docking by global energy optimization in
   internal coordinates*, Proteins. 1997. PubMed `9485515`. The abstract describes internal-coordinate
   global optimization, pseudobrownian and multitorsion moves, and local energy minimization.
3. Schrodinger's public constraint API distinguishes receptor donor, receptor acceptor, metal,
   positional, NOE, and core constraints. It specifies that receptor donors require complementary
   ligand acceptors and receptor acceptors require ligand donors.
4. MolSoft's public ICM restraint documentation states that distance restraints are soft harmonic
   potentials outside an allowed range, with no penalty inside the range. Its template documentation
   describes substructure-based positional tethers to a reference ligand.

### Decision D-001 — independent protocol identity

Use the name **Molarium CCD-1**, not “Glide in the browser,” “ICM docking,” or a compatible-product
label. Cite published lineage explicitly and enumerate both adopted ideas and excluded proprietary
components.

Reason: the public papers support reproducing a methodological pattern, but do not specify enough
of either commercial implementation to reproduce its full search, grids, score, or defaults.

Rejected alternative: present the feature as a Glide or ICM clone. This would be scientifically
misleading and could create trademark, licensing, and community-trust problems.

### Decision D-002 — two independently audited constraint classes

Represent the reference core and required hydrogen bonds separately.

- Core: matched heavy atoms are aligned to a reference pose, then evaluated by positional RMSD with
  a flat-bottom harmonic penalty.
- H-bond: an explicit donor, hydrogen, and acceptor are evaluated by D–A distance, H–A distance,
  and D–H–A angle, each with published-in-the-record thresholds.

Reason: a shared core and a required polar interaction answer different medicinal-chemistry
questions. Combining them into one opaque bias would prevent diagnosis of failed poses.

### Decision D-003 — explicit hydrogen geometry

Do not infer an H-bond from heavy-atom distance alone when an explicit donor hydrogen is available.
The constraint audit requires D–H–A geometry.

Reason: the Tyr example in Molarium already demonstrated that plausible heavy-atom proximity can
hide a wrongly oriented hydroxyl hydrogen. Explicit angular geometry makes that failure observable.

Open question: a future hydrogen-free fallback may be useful for raw structures, but it must be
separately labelled and cannot silently replace the explicit-H protocol.

### Decision D-004 — feasibility before energy rank

Required-constraint satisfaction sorts before the combined energy/penalty score. A very favorable
unconstrained physical energy cannot outrank a pose that satisfies every required constraint.

Reason: “required” must have operational meaning. The continuous penalty remains visible for
diagnostics and for ranking within the feasible or infeasible groups.

Rejected alternative: penalty-only ranking. A sufficiently negative physical energy could then
overcome a required restraint, contradicting the UI and the recorded protocol.

### Decision D-005 — proprietary-input-safe audit

The default shareable labbook stores SHA-256 hashes, labels, atom counts, selections, settings, and
results, but not coordinate payloads.

Reason: hashes establish whether two runs used byte-identical inputs without disclosing proprietary
structures. A future complete archive may embed coordinates only after an explicit export choice.

### Decision D-006 — tamper-evident stage history

Every run event includes the previous event hash; the complete record receives a final hash.
Protocol settings are copied into each run and independently hashed.

Reason: a mutable activity log is insufficient for a method-reproduction claim. Hash chaining does
not prove that a browser calculation was honest, but it makes post-export modification detectable.

### Decision D-007 — incomplete stages remain machine-readable

The protocol manifest labels constraint geometry, ranking, and labbooks as implemented. Browser pose
generation and pocket refinement remain `not-yet-integrated` until end-to-end and redocking gates
pass.

Reason: documentation prose is easy to overread. Machine-readable status prevents the current
foundation from being presented as a complete docking product.

## 2026-08-19 — implementation notes

### Files introduced

- `protocol.mjs`: immutable scientific identity, lineage, defaults, exclusions, and stage status.
- `constraints.mjs`: core fitting/restraint, explicit H-bond audit, scoring, and ranking.
- `labbook.mjs`: canonical serialization, SHA-256 input/protocol hashes, event chain, verification,
  and Markdown rendering.
- `test.mjs`: deterministic geometry, feasibility, ranking, provenance, and tamper tests.

### Observed failure F-001

The first rigid-fit test compared rounded arrays with strict JavaScript equality and failed because
valid floating-point output contained `-0` while the reference contained `0`.

Resolution: compare coordinate errors against `1e-7 Å`. This tests the scientific property and does
not conflate IEEE-754 signed zero with a geometric discrepancy.

### Remaining implementation gates

1. Capture a reference ligand and stable atom identities before Build edits.
2. Obtain a chemically valid core correspondence, preferably from RDKit MCS/substructure matching,
   and enumerate symmetry-equivalent mappings.
3. Generate and core-align deterministic ligand conformers.
4. Add bounded rigid-body and rotatable-bond sampling around the reference pose.
5. Select receptor donor/acceptor constraints interactively and preserve the exact atom identities.
6. Score receptor–ligand contacts without silently applying an invalid whole-protein small-molecule
   parameterization.
7. Refine ligand and optional pocket atoms with every restraint active and logged.
8. Validate cognate redocking, cross-docking failure modes, constraint satisfaction, reproducibility,
   and sensitivity to seeds and thresholds.
9. Expose JSON and Markdown labbook downloads from the result card.

The force-field boundary in gate 6 is the main scientific risk. A quick geometric search is possible
now, but a credible physical rank requires a properly prepared receptor–ligand numeric System or a
new, explicitly validated receptor-grid score. Molarium must not conceal this distinction.

### Decision D-008 — edit-derived stable core identity first

The first browser integration will preserve stable atom identifiers across Molarium Build edits and
define the conserved core as an explicit subset of those surviving atoms. Automatic MCS matching of
an unrelated imported ligand is deferred.

Reason: stable edit lineage is exact and auditable for the immediate medicinal-chemistry workflow.
An unvalidated JavaScript graph heuristic could silently choose the wrong symmetric or tautomeric
mapping. A later general-ligand path should use RDKit MCS/substructure chemistry and enumerate
symmetry-equivalent mappings.

### Decision D-009 — backend-independent orchestration

The constrained-docking workflow receives physical scoring and optional refinement as callbacks.
Constraint evaluation and labbook construction do not assume Sage, Rosemary, MMFF, Glide, or ICM.

Reason: this keeps the published constraint protocol stable while the scientifically appropriate
protein–ligand scoring boundary is validated. It also makes the exact backend identity a recorded
run property instead of an accidental property of the UI.

### Validation V-001 — feasibility dominates physical energy

A synthetic two-pose test assigns `-100 kcal/mol` to a pose that violates the required H-bond and
`-10 kcal/mol` to the satisfying pose. The satisfying pose ranks first. This proves that a required
constraint cannot be numerically overwhelmed by a favorable physical score.

### Validation V-002 — completed labbooks are immutable

Appending an event after finalization throws. An in-progress workflow record verifies its protocol
hash and two-event chain; modifying a prior event causes verification to fail.
