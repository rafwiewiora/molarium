# Molarium ConstraintDock-1 decision ledger

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

Use the name **Molarium ConstraintDock-1**, not “Glide in the browser,” “ICM docking,” or a compatible-product
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

The protocol manifest labels constraint geometry, ranking, labbooks, and browser pose generation
independently. Version 0.2 marks deterministic ETKDGv3 pose generation as implemented and pocket
refinement as explicitly absent.

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

### Initial implementation gates (status at v0.2)

1. **Complete:** capture a reference ligand and stable atom identities before Build edits.
2. **Partial by design:** exact edit-lineage mapping is implemented; unrelated-ligand MCS and
   symmetry enumeration remain future work.
3. **Complete:** generate, score, and core-align deterministic ligand conformers.
4. **Deferred:** bounded pose perturbation beyond ETKDG conformational diversity.
5. **Complete:** capture visible explicit receptor/ligand H-bonds and preserve atom identities.
6. **Complete with an experimental boundary:** captured receptor numeric nonbonded terms and newly
   assigned ligand terms are scored transparently; no whole complex is silently retyped after edits.
7. **Deferred:** active-restraint ligand/pocket refinement.
8. **Partial:** synthetic execution and deterministic replay pass; prospective cognate redocking,
   cross-docking, seed sensitivity, and accuracy benchmarks remain release-science gates.
9. **Complete:** verified JSON and readable Markdown labbooks download from Build mode.

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

## 2026-08-19 — browser integration v0.2

### Decision D-010 — explicit mixed-System scoring boundary

The receptor site is captured before ligand edits from the prepared complex's numeric nonbonded
System. The current edited ligand is separately parameterized through Molarium's OpenFF/OpenMM path.
Only cross receptor–ligand Lennard-Jones and Coulomb terms are evaluated, with Lorentz–Berthelot
combining rules, an 8 Å cutoff, and relative dielectric 4. Relative RDKit conformer strain is added.

Reason: deleting the complex System after a chemical edit is correct because its ligand parameters
are stale. Re-parameterizing the entire protein through the generic small-molecule path would hide a
scientifically invalid boundary. Capturing receptor terms and assigning only the edited ligand keeps
that boundary explicit and auditable.

Limit: mixed force-field provenance, dielectric screening, and omitted desolvation mean the result is
a pose-ranking heuristic, not a binding free energy. The exact receptor and ligand force-field labels
are recorded for every run.

### Decision D-011 — rigid receptor for the first executable protocol

Version 0.2 performs no pocket minimization. It applies no unlogged relaxation after the constraint
audit and does not imply induced fit.

Reason: a refinement stage is only credible if restraint forces, fixed atoms, convergence, and
same-coordinate backend parity are all tested. Rigid docking is narrower but reproducible. Pocket
refinement remains an explicit future protocol version rather than an invisible UI convenience.

### Decision D-012 — reject underdetermined reference cores

Any connected set of at least three selected heavy atoms may define the core and must include a
non-collinear triple. Capture records the maximum triangle double-area and rejects a value below
`1e-3 Å²`. There is no upper atom-count limit: larger selections deliberately preserve more of the
reference scaffold, while smaller selections leave more conformational freedom.

Reason: a collinear core cannot uniquely determine a 3D rigid orientation. Accepting it would produce
arbitrary rotations around the core axis despite a deceptively small RMSD.

### Decision D-013 — camera gestures remain available while building

Build actions are committed on click release. Crossing a five-pixel movement threshold turns the
same left-button gesture into arcball rotation instead, while right-button or Ctrl/Command drag pans
the entire scene. Manipulate retains direct atom dragging, but only when its gesture begins on an
atom; empty-space drag rotates.

Reason: selecting a buried ligand core requires repeated camera changes. Immediate pointer-down
editing made rotation impossible and could accidentally alter chemistry when the user intended to
inspect another side of the complex. Compact `i` controls document the three tool semantics without
adding permanent instructional copy.

### Observed failure F-002 — edited atom counts were initially coupled to the reference

The first workflow validator required each candidate coordinate array to have the same length as the
reference ligand. That contradicted the edit-derived design: adding or deleting a non-core atom must
remain valid.

Resolution: reference and candidate coordinate arrays are validated independently. Core atom pairs
map between their different index spaces. A regression docks a five-atom edited ligand against a
four-atom reference and separately rejects inconsistent candidate-stack shapes.

### Validation V-003 — real browser execution and deterministic replay

The Chrome regression uses a parameterized synthetic protein–ligand complex with one explicit
receptor-donor interaction. It selects a three-atom ligand core, captures the required H-bond,
adds a non-core fluorine atom, confirms that the stale complex System was removed, freshly
parameterizes the edited ligand with OpenFF/OpenMM WASM, and executes RDKit WASM conformer
generation. It then checks a feasible selected pose, verifies the hash chain, confirms no coordinate
payload entered the labbook, repeats the same seed with identical selected-coordinate SHA-256 and
score, applies the pose, and confirms the receptor coordinates did not move.

This is an execution/reproducibility gate, not an accuracy benchmark. Cognate redocking and
cross-docking datasets remain required before reporting docking accuracy.

### Validation V-004 — Build gesture disambiguation and large cores

The Chrome regression begins a left drag on an atom in Select mode and verifies that the camera
rotates without selecting the atom. It then clicks all six connected atoms of a ring, verifies that
the selection remains intact beyond the four-atom geometry-editor limit, and right-drags to pan while
asserting that every molecular coordinate is unchanged. Unit tests capture and map the six-atom core
and reject a non-collinear but disconnected selection.

## 2026-08-19 — receptor-aware torsion refinement v0.3

### Additional public evidence consulted

1. Rowan Scientific's MIT-licensed `openconf` documentation describes analogue/FEP-style
   generation from a supplied pose: explore only free terminal rotors whose moving fragments lie
   outside the constrained core, use position restraints during minimization, and snap constrained
   atoms back to their exact input coordinates. Its full generator also includes a CrystalFF torsion
   library, correlated moves, ring flips, macrocycle moves, MMFF94s minimization, deduplication, and
   selection. Molarium adopts only the free-terminal-rotor/exact-snap boundary and does not copy or
   execute the implementation.
2. Ponzoni, York, and Kelley, *AutoPose: R-Group Decomposition Based Posing for RBFE*, ChemRxiv
   2026, DOI `10.26434/chemrxiv.15004703/v1`, describes RDKit R-group decomposition and Free-Wilson
   modeling to reconstruct congeneric ligand poses for a TMD RBFE workflow. This is a related
   pose-construction strategy, not evidence for Molarium's torsion search.
3. Glide's public method description separates initial placement from torsional optimization, and
   ICM describes internal-coordinate global optimization. These remain lineage rather than code or
   parameter sources.

### Decision D-014 — exact core, flexible external graph branches

Version 0.3 rigidly aligns each candidate and then copies every mapped core coordinate from the
reference pose exactly. Candidate rotors are single, non-aromatic, non-ring, non-amide heavy-atom
bonds whose moving connected component contains no core atom. A proposal rotates only that component.

Reason: edit-derived atom lineage makes the analogue core mapping exact. Allowing a core atom into a
moving branch would silently weaken the user's structural hypothesis. Snapping after alignment also
makes “hard core” literal rather than an RMSD penalty that may drift.

Limit: independently snapping a core generated with a different internal geometry can create strain
at its attachment. The OpenFF Sage intramolecular term exposes that strain, but future constrained
embedding should start directly from the reference geometry. Ring-pucker and macrocycle moves are
not implemented.

### Decision D-015 — independent receptor-aware Metropolis search

For each fixed-core ETKDG seed, Molarium makes 96 deterministic single-torsion proposals from an
explicit angle set under a geometric temperature schedule from 900 K to 150 K. The objective is the
rigid 8 Å receptor cross energy, relative vacuum OpenFF Sage intramolecular energy, and explicit restraint
penalties. The implementation is original Molarium JavaScript and does not use `openconf` source,
torsion rules, MMFF minimization, or selection logic.

Reason: ETKDG diversity plus rigid alignment did not optimize the edited ligand against the receptor.
The new score is evaluated after every proposal, so torsions are selected in the actual pocket under
the same objective that ranks the final pose.

### Decision D-016 — contact feasibility is a search state, not merely a final annotation

A move that first reaches all required contacts is accepted. Once a chain is feasible, a proposal
that loses required-contact feasibility is rejected. Within the same feasibility class, ordinary
Metropolis acceptance applies. The best state is also chosen feasible-first.

Reason: a contact labelled “required” must not disappear in exchange for a favorable energy. The
continuous flat-bottom penalty guides infeasible states toward the allowed geometry; the state rule
gives the label hard operational meaning.

### Decision D-017 — unavailable edit-derived contacts are omitted, never guessed

If an edited ligand no longer contains a stable atom identifier used by a captured contact, the UI
unchecks and disables that contact with an `atom removed` label. Docking can continue with remaining
valid contacts. The omitted contact, missing stable atom identifier, and reason are written into the
hashed labbook.

Reason: throwing stopped a legitimate analogue workflow, while remapping to a chemically similar
atom would silently change the hypothesis. Explicit omission is both usable and auditable.

### Validation V-005 — torsion search invariants

Unit tests prove that ring and amide bonds are excluded, moving components contain no core atoms,
same-seed runs are bitwise deterministic, a synthetic receptor-like objective improves, feasible
states are found, exact core coordinates never move, and a rotor-free molecule is unchanged.

The Chrome gate executes a flexible edited ligand through RDKit WASM, fresh OpenFF parameterization,
fixed-core torsion search, rigid-site scoring, hash verification, deterministic replay, and pose
application. The selected core RMSD is below `1e-12 Å`, at least one external rotor receives the full
proposal budget, and the labbook contains both method-decision and per-conformer search events. A
second browser case deletes the ligand atom used by a reference H-bond and verifies disabled UI,
continued docking, and an explicit `ligand-atom-removed` audit record.

These are correctness and reproducibility gates, not pose-accuracy validation. Cognate redocking,
cross-docking, analogue-series recovery, seed sensitivity, and comparison against published/native
methods remain required before an accuracy claim.
