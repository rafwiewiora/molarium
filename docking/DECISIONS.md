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

## 2026-08-20 — edit-lineage pose propagation v0.1

### Additional primary evidence consulted

1. Cournia Z et al., *Relative Binding Free Energy Calculations in Drug Discovery: Recent Advances
   and Practical Considerations*, J Chem Inf Model. 2017. DOI `10.1021/acs.jcim.7b00564`, states
   that reasonable initial poses are critical and recommends common-substructure alignment combined
   with sampling of modified substituents. It notes that minimization or short equilibration can
   resolve new-group clashes while maintaining the inherited ligand and receptor pose.
2. Ohadi D et al., *Input Pose is Key to Performance of Free Energy Perturbation*, J Chem Inf Model.
   2024. DOI `10.1021/acs.jcim.4c01223`, found strong FEP dependence on the input pose. In its MAGL
   series, simple MCS alignment outperformed the tested docking inputs, while H-bond constraints
   improved every tested pose-generation route. This is one target/series, not a universal ranking.
3. Pinheiro JP et al., *TEMPL: A Template-Based Protein-Ligand Pose Prediction Baseline*, J Chem
   Inf Model. 2025. DOI `10.1021/acs.jcim.5c01985`, uses MCS followed by constrained embedding and
   reference alignment. Its ablation warns that unconstrained force-field optimization can degrade
   poses by releasing the inherited coordinates; it also documents poor extrapolation when no close
   reference exists and a high clash-invalidity rate without receptor-aware cleanup.

### Decision D-018 — propagation is the default for recorded analogue edits

When a ligand is edited inside Molarium, every surviving atom retains a stable `designAtomId`.
Pose Propagation-1 therefore fixes every surviving heavy atom to its exact reference coordinate.
The user does not select an MCS or core. Added and removed atom identities are written to the labbook.

Reason: edit lineage is exact and strictly more informative than inferring an MCS after the fact.
For a congeneric series it preserves the medicinal-chemistry hypothesis and avoids unnecessary
rigid-body search. Selected-core ConstraintDock remains an expert alternative; independently
imported analogues still require a future symmetry-aware chemical MCS path.

The propagation map is rejected when fewer than three non-collinear reference heavy atoms survive.
This is not silently converted to global docking because the structural hypothesis has become
underdetermined.

### Decision D-019 — search only the changed graph

All propagated candidates begin from the live edit-derived coordinates, not fresh whole-ligand
ETKDG conformers. Independent deterministic torsion chains rotate only branches whose moving
component contains no inherited atom. Required H-bond feasibility remains a hard search state.

Reason: whole-ligand regeneration throws away the strongest available evidence. Multiple chains
still explore alternative new-group torsions, while the unchanged binding mode is invariant.

Current limit: a reference contact whose ligand atom was deleted is explicitly omitted. Molarium
does not guess which new donor or acceptor should replace it. A future interaction-retargeting UI
must make that medicinal-chemistry hypothesis explicit and auditable.

### Decision D-020 — fixed-scaffold Sage relaxation with a receptor-aware safeguard

After torsion search, the edited ligand is relaxed with its fresh OpenFF Sage 2.1 System in OpenMM
WebAssembly. Each relaxation step restores inherited heavy atoms to their exact input coordinates.
The receptor remains rigid. A relaxed candidate is retained only if it does not lose required-contact
feasibility and improves the complete receptor-cross-energy, ligand-strain, and restraint objective;
otherwise the pre-relaxation torsion-search pose is kept.

Reason: local bond and angle geometry around a replacement should be repaired, but relaxation must
not erase the reference-pose prior or a required interaction. The relaxation is ligand-internal;
receptor forces enter through the acceptance safeguard rather than the OpenMM minimizer. This is a
pose-preparation heuristic, not FEP equilibration or an induced-fit protocol.

### Validation V-006 — automatic lineage and fixed-coordinate invariants

Unit tests cover surviving, removed, added, and underdetermined lineage maps. The browser gate
captures a reference without atom selection, edits the ligand, verifies every surviving heavy atom
is automatically inherited, performs deterministic torsion search plus fixed-scaffold Sage
relaxation, checks sub-picometer core RMSD, verifies the hash-linked lineage/relaxation events, and
applies a pose carrying the distinct `molarium-pose-propagation-1` protocol identity.

## 2026-08-20 — Pose Propagation-1 reproducibility lock v0.2

### Decision D-021 — separate a protocol claim from a novelty claim

Pose Propagation-1 is described as an independent experimental protocol composition. Reference/MCS
placement, fixed-core posing, torsional Monte Carlo, H-bond restraints, and force-field relaxation
all have prior art. Molarium's distinctive implementation is the combination of exact edit-lineage
identity, fixation of every surviving heavy atom, changed-graph-only search, lexicographic contact
feasibility, guarded ligand-only relaxation, and a hash-linked browser-local audit. We do not claim
that this combination is methodologically or legally novel without a broader literature and patent
review.

Reason: scientific provenance must distinguish reproduction, adaptation, and original engineering.
The current evidence supports the latter two, not a categorical novelty claim.

### Decision D-022 — freeze every algorithmically significant default

Protocol version `0.2.0` adds a machine-readable lock for mapping, candidate initialization, seed
derivation, PRNG identity, rotor eligibility, proposal angles, temperature schedule, Metropolis
logic, score constants, force-field source hash, fixed-relaxation steps, acceptance logic, exclusions,
and failure conditions. The normative prose specification is
[`POSE-PROPAGATION-PROTOCOL.md`](./POSE-PROPAGATION-PROTOCOL.md).

Runs embed the full protocol object and its SHA-256. Actual run overrides such as candidate count,
seed, torsion proposals, or relaxation iterations remain recorded in hash-linked events. A behavior
change requires a version change; documentation alone cannot redefine an existing labbook.

### Validation V-007 — reproducibility vectors

The unit gate locks the `mulberry32(20260819)` output vector, the first four candidate seeds, all
critical v0.2 constants, and parity between executable torsion defaults and the protocol snapshot.
The browser gate records actual fixed-relaxation step scale and displacement cap in addition to the
engine, force field, iterations, fixed atoms, score, and acceptance decision.

## 2026-08-20 — reference-preserving edit cleanup and captured donor-H restoration v0.3

### Decision D-023 — captured analogue scaffolds override generic ring cleanup

The generic local editor expands a touched fused ring into one movable unit. That remains appropriate
for unconstrained isolated-molecule cleanup, but it conflicts with a captured analogue pose. After
Pose Propagation reference capture, `Preserve reference` is therefore the default: every surviving
same-element reference heavy atom is fixed during automatic and explicit MMFF94/UFF cleanup, while
new atoms and hydrogens remain movable. `Free local cleanup` exposes the older behavior explicitly.

Reason: a reference-bound ring is experimental or otherwise trusted pose evidence, not merely the
boundary of a local optimizer. An automatic builder polish must not silently change that hypothesis.
The selected mode and the append-only cleanup history are copied into the run labbook.

### Decision D-024 — restore, rather than invent, ligand donor-H geometry

For a selected required ligand-donor contact, Pose Propagation restores the surviving explicit
ligand donor hydrogen to its captured reference coordinate before torsion search. No heavy atom
moves. Receptor-donor contacts are unchanged, a missing captured H coordinate is reported rather
than guessed, and a second contact reusing the same hydrogen is skipped in stable captured order.

Reason: heavy-atom fixation cannot determine a donor hydrogen's direction. This restoration repairs
that one remaining directional degree of freedom without manufacturing a linear D-H-A arrangement
that could violate an sp2 donor's local valence geometry. It does not assert that the contact exists;
the same distance and D-H-A feasibility gate still accepts or rejects it. Because this is an
algorithmic change, Pose Propagation advances to version `0.3.0`; ConstraintDock remains unchanged.

### Validation V-008 — reproduce the reported methyl-edit path

The browser gate now uses the real canvas add-element operation on a prepared phenyl reference rather
than a direct test helper. It requires all six inherited aromatic carbons to remain bit-for-bit fixed,
an aryl-methyl bond between `1.35` and `1.65 Å`, an append-only cleanup record naming
`preserve-reference`, and explicit selection of the entire ring only after choosing `free-local`.
The complete browser gate passes 434/434 checks. The unit gate separately verifies exact captured-H
coordinate restoration, stable duplicate-contact handling, and no mutation of the input array. The
RDKit 2D gate passes 5/5, the Local Lab privacy gate passes 14/14 with zero outbound requests reaching
its pre-network interceptor, and the production web build succeeds.

## 2026-08-21 — receptor-anchored contact features after R-group replacement v0.4

### Decision D-025 — preserve the pharmacophore hypothesis, not a deleted atom ID

A captured required contact represents an immutable receptor participant and a complementary
ligand pharmacophore feature. After a valid staged graph edit, a removed ligand participant may be
transferred only to a newly added or changed feature with the exact captured donor/acceptor
signature and the same nonempty surviving edit-boundary atom IDs. One candidate maps automatically;
multiple candidates require an explicit user choice; no candidate leaves the contact unavailable.
Current 3D proximity is evidence only and never establishes eligibility or resolves ambiguity.

For ligand donors, donor and explicit bonded hydrogen are one feature tuple. A replacement hydrogen
has no captured reference coordinate, so the captured-H restoration rule cannot invent its
direction. Receptor participants and their captured coordinates are never rewritten.

Reason: medicinal-chemistry R-group scans commonly replace the atom carrying the intended
interaction. Raw `designAtomId` continuity would incorrectly discard the hypothesis, while a loose
nearest-heteroatom rule would silently change chemistry based on a transient distorted pose. The
exact feature and edit-boundary rule retains the hypothesis only where the completed chemical graph
supports it and exposes genuine ambiguity to the scientist.

This supersedes Decisions D-017 and D-019's temporary omission-only rule for Pose Propagation.
The pre-v0.4 behavior remains the fallback when exact transfer cannot be established. Selected-core
ConstraintDock retains its explicit omission behavior. Pose Propagation advances to `0.4.0`;
ConstraintDock remains `0.3.0`.

### Validation V-009 — feature transfer, ambiguity, and pending-state boundary

Unit tests cover unique carbonyl-acceptor replacement, two-candidate ambiguity, incompatible
feature rejection, immutable receptor descriptors, and donor-plus-hydrogen tuple replacement. The
browser gate keeps the original constraint selected while an edit is pending, blocks Optimize and
Refine, exposes Finish chemistry in the central viewer toolbar, transfers a carbonyl contact after
successful sanitization, and requires the hash-linked mapping event in the completed run labbook.

The release audit additionally locks append-only atom IDs, one shared feature typer from display
through run validation, donor-H tuple continuity, persistent ambiguity across later edits, complete
chained-remap provenance, atomic Undo/Redo contact state, and monotonically ordered labbook events.
The focused browser gate exercises automatic transfer, distinct replacement identity, Undo/Redo,
run participation, and immediate-mode feature-role invalidation without depending on unrelated ML
backends.

### Decision D-026 — carry an unresolved feature boundary across completed edit batches

An unresolved contact-feature proposal persists after a valid deletion batch. A later valid batch
may resolve it only from features newly added or chemically changed in that later batch whose exact
feature signature and surviving attachment boundary match the originating deletion. The audit stores
distinct `originatingCommittedEditId` and `committedEditId` values. Pre-existing features elsewhere
in the ligand are never admitted merely because they have the same pharmacophore type.

Reason: replacing an R group is often naturally performed as delete/finish followed by build/finish.
The deletion graph is the last graph that can identify where the old feature was attached, whereas
the addition graph is the first graph containing the replacement. Requiring both facts to occur in
one UI transaction made the protocol depend on editing style rather than chemistry.

### Validation V-010 — sequential carbonyl replacement and graph-faithful 2D depiction

The unit gate deletes a pyridone acceptor, completes that graph, then adds a cyclohexanone carbonyl
in a later graph and requires one exact candidate at the recorded boundary. Wrong-boundary and
two-candidate controls remain rejected or ambiguous. The browser gate repeats the two completed
batches, requires automatic contact transfer, verifies both edit IDs in the audit, and checks that
the RDKit panel's current bond graph contains the replacement C=O. RDKit always generates fresh 2D
coordinates; previous display state may contribute only rotation, uniform scale, and translation.

The paired 7KPA chemistry control also records what must *not* transfer: cyclohexanone preserves the
pyridone carbonyl-acceptor hypothesis, but has no N-H donor that can replace the pyridone-to-water
contact. That donor constraint remains explicitly unavailable until the user omits it or constructs
a chemically compatible donor. The interface names the missing ligand role and never converts an
acceptor into a donor merely because both features contain oxygen or are spatially nearby.

The atom-level assignment is explicit: `LYS A11 NZ → D84 O3` targets the pyridone carbonyl and is
the acceptor hypothesis eligible for transfer; `D84 N3-H → HOH C307 O` is the pyridone donor
hypothesis that cyclohexanone removes. `SER A60 N → D84 O2` targets the molecule's other carbonyl,
the 2-oxopyrrolidone group, and is unchanged by this edit.

### Validation V-011 — hydrated 7KPA capture is not display-limited

The checked-in 7KPA PDB and D84 CCD fixtures are prepared with all crystallographic waters. The
viewer deliberately caps rendered interaction primitives, but reference-guided pose capture scans
the complete interaction set. The browser gate requires both `D84 N3-H → HOH C307 O` and the
longer `LYS A11 NZ-H → D84 O3` contact. Before this split, the full hydrated complex sorted all
H-bonds by distance and retained only 96; the water contact survived while the valid Lys–pyridone
contact was silently dropped. A rendering-performance limit must never alter scientific inputs.

### Decision D-027 — replacement boundaries accumulate across chemically complete commits

An unresolved contact proposal retains the live atom IDs of every connected replacement region
created or chemically changed after the originating deletion. Exact candidates are evaluated by
traversing that cumulative region back to the original scaffold boundary; the boundary IDs
themselves are always excluded from the movable region. Bond-order changes mark both surviving
endpoints as edited because a C–O to C=O transition creates a pharmacophore without changing atom
identity.

Reason: a valid medicinal-chemistry workflow may first saturate a pyridone, delete it, construct and
sanitize cyclohexanol, and only then assign the carbonyl bond. Looking only at the final C–O bond
edit sees the adjacent carbon/ring neighbors as its boundary and loses the true scaffold lineage.
Accumulating the exact graph-edit region preserves the original attachment evidence without using
coordinates, proximity, or pre-existing heteroatoms elsewhere in the ligand.

Every retained candidate is re-perceived and its boundary is recomputed from the live graph at
each commit. All originating boundary atoms must still exist. Only cumulative edit components that
remain covalently connected to that boundary are retained, so a detached former candidate or a
simultaneous edit elsewhere cannot inherit stale eligibility or contaminate provenance.

This historical behavior is `exact-feature-edit-boundary/v2` and advanced Pose Propagation to
`0.4.1`; Decision D-028 below supersedes its exact-feature exclusion in `0.5.0`.

### Validation V-012 — real 7KPA saturate/delete/build/carbonyl regression

The checked-in hydrated 7KPA browser fixture now captures all four D84 contacts, changes the two
pyridone C=C bonds to single, finishes that valid graph, deletes the complete pyridone ring and
finishes again, builds and sanitizes cyclohexanol, then assigns C=O in a final commit. The gate
requires automatic exact transfer of `LYS A11 NZ-H → D84 O3` to the newly identified carbonyl
oxygen. It simultaneously requires `D84 N3-H → HOH C307 O` to remain unavailable because the new
ring contains no compatible donor. The unit gate separately asserts that the final immediate
boundary is wrong and that only cumulative-region traversal recovers the original scaffold anchor.
Additional gates detach an ambiguous candidate, delete its originating anchor, and edit a
wrong-boundary carbonyl; all must remain unavailable with unpolluted cumulative provenance.

### Decision D-028 — interaction role and edit lineage define transfer eligibility

Decision D-027's exact-feature exclusion is superseded by `role-compatible-edit-boundary/v3` in
Pose Propagation `0.5.0`. A replacement hypothesis is eligible when the completed molecular graph
perceives it as the same ligand interaction role (donor or acceptor) and its connected cumulative
edit region reaches exactly the recorded originating boundary. Element, charge, aromaticity,
heavy-neighbor signature, and named functional-group type are recorded but do not exclude a
candidate. This admits carbonyl O→sulfone O, nitrile N, aromatic N, and other chemically perceived
bioisosteres without admitting atoms that cannot perform the required interaction role.

Multiple candidates no longer force a pre-refinement identity choice. They form one any-of
restraint. Each pose evaluates every alternative against the unchanged receptor participants; the
lowest H-bond penalty represents that single captured contact, and the complete receptor energy,
relative ligand strain, and remaining constraint terms rank the pose. The selected alternative and
all alternative audits are retained. A user may explicitly narrow or omit the set. Geometry is
never used to establish graph correspondence.

Reason: an interaction hypothesis is the transferable medicinal-chemistry intent, while a carbonyl
label is only one realization. Requiring exact feature identity made the intended R-group scan fail
for standard bioisosteric replacements and forced the user to pre-decide which atom should win
before the physical calculation. The broader rule defers that decision to constrained sampling and
transparent strain/interaction scoring while the recorded edit boundary prevents unrelated ligand
heteroatoms from inheriting the contact.

### Validation V-013 — cross-class role matrix and any-of scoring

The executable unit matrix requires successful transfer for carbonyl O→nitrile N, aromatic N, and
both sulfone oxygens; N–H donor→O–H and S–H donors; and the exact carbonyl control. Protonated
aromatic N is not accepted as an acceptor. The two sulfone oxygens remain two alternatives rather
than being selected by their starting coordinates. A grouped-restraint test proves that the viable
alternative is selected per pose, the contact contributes only once, and loss of one alternative
does not invalidate the group.

The hydrated 7KPA gate requires the cyclohexanol intermediate to carry both its OH-acceptor and
OH-donor hypotheses. After C–OH becomes C=O, the donor hypothesis must become unavailable and the
acceptor mapping chain must persist through both chemical states with stable atom IDs, immutable
receptor participants, topology hashes, and all three committed edit-lineage records.

The focused browser gate replaces a captured carbonyl acceptor with a sulfonamide group, retains
both sulfonyl oxygens as one unresolved any-of contact, executes reference-guided refinement without
a pre-geometry user choice, and requires the hash-linked labbook to record both alternative
evaluations and the alternative selected for the winning pose.

### Decision D-029 — required contacts generate poses before physical refinement

Pose Propagation `0.7.0` replaces the single blended search objective with two explicit stages. The
capture stage evaluates selected required-contact flat-bottom penalties during acyclic-torsion and
safe saturated-ring crankshaft proposals. Only registered excess-strain and excess-clash sanity
penalties accompany the contact objective. It is followed by an exhaustive best-improvement scan of
every eligible move, registered angle, and line fraction. The complete rigid-pocket and relative
Sage objective is allowed to act only after every required contact is feasible, and it may never
accept a move that loses feasibility. If capture fails, fixed-scaffold physical relaxation is
skipped and the closest audited contact geometry is returned as infeasible.

Reason: including a finite multiple of the restraint in a mixed objective is not sufficient. A large
physical term can suppress the very conformations that the interaction hypothesis is meant to
generate. A final feasibility filter then reports failure without having searched the relevant
region. The staged objective makes the medicinal-chemistry hypothesis an explicit generator and
keeps strain/interaction ranking downstream.

The design follows the public ICM principle that interaction restraints contribute a force during
flexible-ligand optimization, but it is an independent implementation. Molarium does not reproduce
ICM's proprietary grids, scoring function, BPMC implementation, source, or defaults.

### Validation V-014 — superseded pre-audit 7KPA diagnosis

The focused unit gate assigns a lower physical energy to a ring conformation that misses its
required H bond and a much higher energy to the contact-satisfying ring. The two-stage generator must
still create the feasible pose in capture, enter physical refinement, and reject loss of the
contact. Feasible line fractions must beat lower-energy infeasible fractions. Ring moves must retain
bitwise core coordinates and every molecular-graph bond length, and same-seed replay must be exact.

Before the stereochemistry/conjugation audit, the hydrated 7KPA pyridone-to-cyclohexanone diagnostic
ran 16 chains at each of three registered seeds and reached best D-A 4.195 Å, H-A 3.456 Å, and
D-H-A 131.58°. That trajectory used a ring move capable of repositioning the direct ring carbonyl by
distorting unguarded ring geometry. It is retained only as debugging provenance and is **withdrawn
as validation evidence**. It must not be quoted as v0.7 performance.

### Decision D-030 — reject chemically broken capture and misnamed Monte Carlo

An independent adversarial review found that the first ring-crankshaft implementation preserved
bond lengths and closure but could change tetrahedral handedness or distort a lactam/conjugated ring
while satisfying a required H bond. It also found that calling the four-fraction, objective-best
proposal kernel “Metropolis Monte Carlo” was mathematically inaccurate: selecting the best of four
state-dependent trial fractions makes the effective proposal asymmetric, and no Hastings correction
is applied.

Pose Propagation `0.7.0` therefore excludes every ring move whose axis or moving arc touches a
graph-perceived tetrahedral stereocenter, a ring multiple-bond atom, or a lactam C-N unit. Capture is
feasible only when all required contacts pass **and** relative Sage strain is at most 100 kcal/mol
above the best exact-core start **and** no more than two steric-clash diagnostics are added relative
to the least-clashing exact-core start. These are conservative sanity gates, not a binding score.
The search kernel is named an annealed stochastic line-search heuristic and explicitly not claimed
to be equilibrium Metropolis/Hastings or ICM BPMC.

Reason: restraint-driven generation must not manufacture success by violating covalent geometry or
stereochemical identity. Exact ICM behavior cannot be reproduced without its proprietary receptor
grids, score, BPMC implementation, and defaults; adopting the public restraint-during-search
principle while specifying an independent kernel is the reproducible boundary.

### Validation V-015 — stereochemistry, conjugation, chemical gate, and serialization invariance

Executable tests require a substituted cyclohexane's signed tetrahedral volume to remain unchanged,
exclude moves touching a direct ring carbonyl and a 2-piperidone lactam C-N-C=O unit, and retain a
positive pendant-carbonyl ring move that transports the complete carbonyl rigidly. A deliberately
contact-satisfying but chemically invalid score must remain capture-infeasible and may never enter
physical refinement. The same molecular graph with reversed bond-array order and swapped bond
endpoints must enumerate the same normalized torsions and replay identical coordinates from the
same seed. Zero physical proposals must report `captured-no-physical-proposals`, and top-level start
and best objective values must belong to the same named stage.

The safe v0.7 7KPA smoke gate exposes three eligible ring moves, none touching the direct ring
carbonyl. Eight stochastic proposals plus one 120-evaluation exhaustive polish sweep leave the
required Lys→cyclohexanone contact at its 6.706 Å D-A / 5.905 Å H-A start and report
`capture-infeasible`; physical refinement and OpenMM relaxation are skipped. The other selected
reference contact remains feasible, and the ligand passes the registered strain/clash sanity gate.

### Validation V-016 — 25-system end-to-end browser smoke

The v0.7 development smoke executes the actual browser preparation, OpenFF parameterization,
reference/contact mapping, restraint-driven generation, ranking, and hash-linked labbook path for
all 25 registered cases at reduced search effort. Outcomes are: 10 feasible poses, 5 explicit
preparation blockers, 3 no-feasible-pose results, 1 unavailable reference contact, 2 unsupported
parameterizations, and 4/5 successful infeasible negative controls (the fifth negative stops at the
same unsupported parameterization boundary). No runtime failure or geometry-sanity failure occurs.
The private development report SHA-256 is
`edc2e12d28912d5958fcc6830702584b7f57fec30e4ab9df16076ff6ccacba82`; it is not a release benchmark
and must not be interpreted as an accuracy rate.

### Decision D-031 — a changed ring is not an unchanged core

Pose Propagation `0.8.0` keeps exact edit lineage but distinguishes survival from structural
invariance. A committed element/formal-charge change on an existing ring atom or
order/aromaticity change on an existing ring bond releases the complete touched ring system,
directly multiply bonded exocyclic atoms, and attached hydrogens. External single-bond heavy-atom
boundaries remain hard reference coordinates. The changed atoms/bonds, released and boundary IDs,
edit ID, and commit time are appended to the molecule ledger and cumulative releases are excluded
from later hard-core maps.

Reason: saturating pyridone preserves all six heavy-atom identities but changes the appropriate
geometry from planar to puckered. Treating identity as a hard coordinate constraint forced an
unphysical planar lactam; changing N-H to CH2 then released only N and still could not make an
ordinary cyclohexanone. The whole transformed ring is the smallest chemically coherent movable
unit. Conversely, adding methyl to an unchanged ring is not a reason to discard trusted ring
coordinates, so new attachments alone do not trigger release.

### Decision D-032 — agent automation terminates at chemist actions

The versioned `molarium.chemist-actions/v1` browser API is the supported agent boundary. It exposes
only UI-equivalent inspection by persistent ID, connected selection, chemistry transactions,
history, reference/contact setup, pose refinement/application, and visible Build optimization.
Inputs are bounded plain JSON, commands are serialized, and recognized actions receive ordered
timestamped audit entries. Test fixture injection, arbitrary callbacks, coordinate replacement,
score access, module access, and network actions are absent.

The production entry point is module-scoped and does not install the privileged regression harness.
The harness is enabled only by an explicit `--test-api` local-server flag. This is defense in depth,
not a claim that an in-page API can sandbox a caller already granted arbitrary page JavaScript;
an agent host must expose only the JSON action dispatcher.

Reason: an agent test that calls a convenient internal mutation or scoring function does not prove
that a chemist can reproduce the workflow. Sharing one constrained route also prevents successful
tests from concealing broken UI transaction, identity, validation, or provenance behavior.

### Validation V-017 — public direct-edit route and future ring generator

The real hydrated 7KPA browser regression now performs C26=C27→single and C30=C29→single in one
pending batch, finishes the lactam, changes N3→C in a second batch, and finishes cyclohexanone using
only Chemist Actions. It requires valid RDKit sanitization, retained C28=O3, exact external C23,
measurable released-ring motion, complete registered ring/O3 release, retained Lys→O3 contact, and
explicit loss of the removed N3-H donor contact. The first run exposed commit-added hydrogens without
stable IDs; IDs are now assigned after Finish reconciliation and before provenance analysis.

A separate backend-neutral closed-ring generator test accepts a valid cyclohexanone chair, rejects
an out-of-plane carbonyl and a configured stereochemical inversion, keeps three external scaffold
atoms bitwise exact, and chooses the restraint-feasible conformer. This generator is future-facing
and is not yet wired into Pose Propagation's default search.
