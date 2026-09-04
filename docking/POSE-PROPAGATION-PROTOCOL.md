# Molarium Pose Propagation-1

## Normative protocol

Protocol ID: `molarium-pose-propagation-1`
Protocol version: `0.9.0`
Status: experimental pose-preparation and pose-ranking method
Canonical machine-readable definition: `MOLARIUM_POSE_PROPAGATION_PROTOCOL` in
[`protocol.mjs`](./protocol.mjs)

The protocol object embedded in each completed labbook, its SHA-256, the input SHA-256 values, and
the run-event values are the reproduction lock. If this document and the protocol object ever
disagree, a run must be interpreted using its embedded protocol object. Any change to an
algorithmically significant default requires a protocol version change and a new validation record.

This protocol is not global docking, induced-fit docking, an affinity score, or a free-energy
calculation. It propagates a trusted reference pose through a ligand graph edit, explores only the
changed graph, and ranks the resulting local alternatives with a rigid receptor.

## Scientific claim

The ingredients are established: reference/MCS placement, constrained analogue posing, torsional
Monte Carlo, hydrogen-bond restraints, and force-field relaxation. Molarium does **not** currently
claim that those ingredients are individually new or that the combined method is legally novel.

The independent Molarium contribution is the following precisely defined composition:

1. For an in-app edit, recorded atom lineage replaces a chemically inferred MCS.
2. Every surviving reference heavy atom is fixed, not merely a selected substructure, except a
   complete ring whose existing atom identity or bond order was changed by the committed edit.
   Such a transformed ring is released as one unit behind an exact external scaffold boundary.
3. Only graph branches containing no inherited atom are sampled by acyclic-torsion and safe
   saturated-ring crankshaft moves. Moves touching a perceived stereocenter, ring carbonyl/multiple
   bond, or lactam geometry are excluded.
4. Required contacts actively generate the pose in a pharmacophore-capture stage; they are not
   evaluated only after conformer generation.
5. Required contacts are lexicographic feasibility states: a favorable energy cannot compensate
   for losing one.
6. Ligand-only force-field relaxation is accepted only after a receptor-aware feasibility and
   complete-score audit.
7. A contact affected by an R-group edit can transfer to any complementary donor or acceptor
   created at the same recorded edit boundary; physical refinement ranks the resulting hypotheses.
8. Inputs, protocol, atom lineage, contact-feature decisions, settings, and results are recorded in a hash-linked
   browser-local labbook.

This should be described as an **independent experimental protocol**. A stronger novelty claim
requires a systematic literature and patent search plus comparative validation.

## Applicability

### Required

- A prepared, parameterized protein-ligand complex with explicit ligand hydrogens.
- A trusted reference pose.
- A ligand modified through Molarium graph-edit operations after reference capture.
- At least three surviving, non-collinear reference heavy atoms.
- The original receptor site unchanged after capture.

### Appropriate use

- Congeneric medicinal-chemistry edits.
- FEP/RBFE pose *preparation* where the binding mode is expected to be conserved.
- Local replacement-group exploration around a trusted crystallographic or otherwise justified pose.

### Inappropriate or unsupported use

- Scaffold hopping with little surviving structure.
- Unknown or alternative binding modes requiring global search.
- Independently imported analogues: automatic symmetry-aware MCS/MCES mapping is not implemented.
- Tautomer, protomer, stereoisomer, macrocycle, or fused-ring concerted enumeration.
- Receptor or crystallographic-water rearrangement.
- Binding-affinity or free-energy estimation.

## Exact inputs and identity

Coordinates are in ångström and energies are in kcal/mol unless otherwise stated. Atom indices are
zero-based internally.

At reference capture, every ligand atom receives a unique `designAtomId`. PDB-derived IDs encode
namespace, record, chain, residue, atom name, and serial; design atoms without those fields receive a
namespace-local ordinal. Graph editing must preserve this ID on an atom that survives an edit and
must create a new ID for an added atom. Every allocated ID is retained in an append-only molecule
ledger. Deleting an atom does not release its ID, so a replacement at the same array position can
never masquerade as the deleted reference atom.

An atom is inherited if and only if:

- it existed in the captured reference ligand;
- it exists in the edited ligand with the same `designAtomId`;
- its element is unchanged; and
- it is not hydrogen.

There is one explicit edit-lineage exception. When a committed edit changes the element or formal
charge of an existing ring atom, or changes the order/aromaticity of an existing ring bond, the
complete touched ring system is excluded from the inherited set. Directly multiply bonded
exocyclic atoms (for example a carbonyl oxygen) and ring-attached hydrogens move with it. Heavy
atoms connected to that ring only through an external single bond remain inherited and exact.
Attaching a new substituent to an otherwise unchanged reference ring does not release the ring.

Each exception is an auditable graph fact, not a geometric guess. The molecule ledger records the
changed atom IDs and bond keys, touched-ring IDs, released heavy/all-atom IDs, fixed boundary IDs,
committed edit ID, and time. Releases accumulate across a multi-step chemical transformation. Thus
pyridone C=C saturation releases its six-membered lactam ring, and a later N→C edit retains the
same ring release while the external reference scaffold stays fixed.

Deleted atoms are recorded as removed. Same-ID atoms with a changed element are recorded as changed
and are not inherited. Heavy atoms with new IDs are recorded as added. Hydrogens are never fixed by
lineage, so proton geometry may relax.

The mapping is rejected if fewer than three inherited atoms survive or if the largest triangle
formed by inherited reference coordinates has a doubled area below `1e-3 Å²`. Rejection is terminal;
the implementation must not silently switch to global docking.

The reference and edited ligand coordinate/topology JSON texts are serialized in atom order and
SHA-256 hashed. Exact replay requires coordinate inputs whose hashes match the labbook.

## Reference receptor site

At capture, the rigid receptor site contains every protein `ATOM` record within `8 Å` of any
reference-ligand heavy atom. Ligand atoms, waters, and other `HETATM` records are not receptor-site
atoms. The captured numeric nonbonded parameters and coordinates are retained.

Before a run, every captured receptor atom must still exist with the same element and must be within
`1e-6 Å` of its captured coordinate. Otherwise the run fails and a new reference must be captured.

## Required hydrogen bonds

Reference-contact detection uses explicit hydrogens and the same typed graph function used by
display, capture, remapping, UI availability, and run-time validation. A donor is a typed N, O, or
S with the specific explicit bonded H. Acceptor typing distinguishes charge, aromaticity, local
bond order, amide-like N, acid versus alcohol O, and F. An untypable ligand feature is not captured.
Covalently near pairs within two bonds are excluded. A displayed reference H bond must have:

- H–A distance from `1.2` through `2.6 Å`; and
- D–H–A angle at least `135°`.

Contacts are ordered by H–A distance, and every receptor-ligand cross contact is captured for this
protocol. The viewer may render only a bounded subset, but that graphics limit is never applied to
reference capture. Captured contacts are selected as required by default. The user may
explicitly disable one before the run.

During sampling and ranking, a required contact is satisfied only when all are true:

- D–A distance is from `2.4` through `3.5 Å`;
- H–A distance is from `1.2` through `2.7 Å`; and
- D–H–A angle is at least `120°`.

For a measured value `x`, let `d(x,l,u)` be zero inside `[l,u]` and the distance to the nearest
boundary outside it. The contact penalty is

```text
15 * (d(D-A,2.4,3.5)^2 + d(H-A,1.2,2.7)^2 + (max(0,120-angle)/30)^2)
```

A required contact outside any allowed range makes the pose infeasible regardless of its score.

### Contact-feature transfer after an R-group edit

The receptor-side participant, identity, and captured coordinate are immutable. Ligand contact
identity is evaluated only after the complete staged edit passes RDKit sanitization and local edit
polish. A surviving ligand participant remains usable whenever the live graph still perceives the
required donor or acceptor role; a feature-class change is audited rather than rejected.

If the original ligand feature was removed or changed, `role-compatible-edit-boundary/v3` considers
every chemically perceived complementary donor or acceptor in the newly added or chemically changed
region. Eligibility requires only:

- the same interaction role (ligand donor or ligand acceptor); and
- the same nonempty set of surviving `designAtomId` boundary anchors connecting the removed and
  replacement edit regions.

Element, formal charge, aromaticity, heavy-neighbor signature, and perceived feature class remain
in the audit record but are not exclusion criteria. Carbonyl O to sulfone O, nitrile N, aromatic N,
or another acceptor bioisostere can therefore inherit an acceptor contact. Donor replacements work
the same way, with donor heavy atom and explicit hydrogen treated as one feature tuple.

Exactly one candidate is mapped automatically. If two or more candidates are plausible, every
candidate is evaluated as an alternative within one any-of restraint and the candidate with the
lowest H-bond penalty is used for that pose. The complete receptor interaction, ligand strain, and
physical score still rank poses. A user may optionally narrow the alternatives, but ambiguity no
longer blocks refinement. Zero candidates leave the contact unavailable. Current coordinates and
apparent H-bond geometry are recorded as evidence but never establish eligibility.

The originating feature signature, surviving boundary IDs, ordered committed-edit IDs and topology
hashes, cumulative live edit region, and exact candidate identities persist with an unresolved
proposal. A replacement ring may
therefore be completed and sanitized before a later bond-order edit creates its final pharmacophore.
Candidate boundary traversal uses the cumulative connected edit region but explicitly excludes the
immutable originating scaffold anchors. A later edit re-perceives retained candidates against the
live graph and recomputes their role and boundary. Every originating anchor must remain present, and
only edit-region components still covalently connected to those anchors persist. Removing one of two
ambiguous features can therefore deterministically resolve the proposal, but detaching the survivor
cannot. A later edit never replaces the origin with a nearer or newly convenient heteroatom.

A ligand-donor feature consists of the donor and one explicit bonded hydrogen as a tuple. A newly
mapped hydrogen has no captured reference coordinate and therefore cannot use captured-hydrogen
restoration; subsequent torsion search and constrained relaxation must establish its geometry.
Every decision records original and replacement IDs and signatures, unchanged receptor IDs,
boundary IDs, the complete candidate set, before/after topology SHA-256 values, the decision method,
and time in the hash-linked labbook. If a mapped feature is replaced again, the complete mapping
chain is retained. Undo and redo restore the graph, selected-contact set, applied mappings, and
unresolved proposals as one history state.

## Interactive edit cleanup

Reference capture changes the Design cleanup default to `Preserve reference`. Automatic edit cleanup
and the explicit ligand MMFF94/UFF action then fix every surviving same-element reference heavy atom
outside a registered transformed ring and move only hydrogens, non-inherited atoms, and the complete
registered transformed ring. This preprocessing is upstream of the pose protocol:
its output coordinates are hashed as the live edited-ligand input, and every cleanup is copied into
the run labbook from `source.interactivePolishHistory`.

The user may explicitly select `Free local cleanup`. That older isolated-molecule rule moves the
edited two-bond neighborhood, expands any touched fused ring into one movable unit, and includes
attached hydrogens. It is retained for intentional local re-equilibration, but is not the analogue
default. Regardless of preprocessing choice, the protocol boundary below realigns and exactly snaps
every inherited heavy atom to the captured reference before sampling.

## Candidate initialization

The default is 16 candidates and feature-seeding protocol `v5`. The first seed is a
`Float64Array` copy of the live edited-ligand coordinates. Additional deterministic seeds cover
three kinds of local hypotheses:

- selected contacts with a captured ligand-feature reference point, sampled by aligning the
  anchor-to-feature vector and rotating the complete single-anchor edit region through
  `[0,60,-60,120,-120,180]°`;
- eligible pre-existing non-ring single-bond rotors in the declared edit environment, sampled by
  the registered edit-region angle grid; and
- every registered spatial-feature atom-map variant, placed from its reference coordinates as a
  seed-only hypothesis.

A seed-only spatial feature in this stage is neither a hard coordinate correspondence nor a required
scoring restraint. A required soft spatial feature must instead be declared by the route under
`molarium.registered-soft-spatial-feature-restraint/v1`; its tolerance and weight are then applied
to every candidate and coupled-relaxation continuity check. The parameter-decision record identifies
the human actor, immutable pre-holdout diagnostic, observed RMSD, selected tolerance, and confirms
that no holdout coordinates were used. These features broaden initial placement hypotheses while
remaining distinct from atom identity. Likewise, an affected pre-existing rotor can release only the mapped core
atoms on its movable side for seeding. All other inherited heavy atoms remain exact. Every seeding
operation is an internal-coordinate rotation or rigid feature placement followed by ordinary local
geometry repair; it does not stretch a bond to force a match.

`v5` treats every spatial-feature map and every affected-rotor hypothesis as a required coverage
stratum. After retaining the unaltered first seed, it deterministically chooses candidates until all
required strata are represented, then allocates the remaining candidate budget breadth-first and
round-robin across the available strata. Coordinates are deduplicated after rounding to
`1e-6 Å`. If the requested candidate count cannot represent every required stratum, initialization
fails rather than silently omitting one. Only after unique selected seeds are exhausted may the
ordered list repeat to fill the requested count.

The result records the coverage policy, requested and unique counts, every stratum, which seed
ordinals cover it, and whether all required strata were covered. A prospective workflow must require
`coverageComplete: true` and retain this table in its action audit. Compatibility protocols `v3`
and `v4` remain explicit: `v3` scans single-anchor edit regions while affected pre-existing rotors
remain fixed; `v4` adds those affected rotors but retains the older generated-order allocation and
does not guarantee spatial-feature-map coverage.

Pose propagation does not run ETKDG, MMFF, UFF, rigid-body randomization, or shape alignment. Regions
with zero or multiple inherited anchors do not receive feature-axis seeds. Subsequent candidate
diversity comes from the deterministic restraint-driven internal-coordinate chains.

Before search, a Horn-quaternion least-squares rigid transform aligns inherited candidate atoms to
their reference coordinates. The quaternion eigenvector uses 64 shifted power iterations. After
transforming the complete ligand, every inherited coordinate is overwritten with the corresponding
reference coordinate. This hard snap is repeated at the workflow boundary.

For each selected required contact in which the ligand is the donor, a surviving explicit ligand
donor hydrogen is restored to its exact captured reference coordinate. No heavy atom moves and no
new D-H-A direction is invented. Restoration is skipped and audited when the captured hydrogen
coordinate is unavailable or an earlier selected contact already restored the same hydrogen. This
is only deterministic recovery of trusted input geometry; the ordinary H-bond feasibility audit
still decides whether the contact is met.

The default base seed is `20260819`. Candidate `i`, with `i=0` for the first candidate, uses:

```text
candidateSeed = uint32(baseSeed XOR imul(i + 1, 0x9e3779b9))
```

Random numbers come from the exact `mulberry32` implementation in `stormm/core.mjs`. For base seed
`20260819`, its first six values are:

```text
0.27264824602752924
0.39473715308122337
0.95869635115377605
0.34869390120729804
0.68163805175572634
0.096266938373446465
```

The first four candidate seeds are `2667732586`, `1029428385`, `3683863288`, and `2045296951`.

## Eligible internal-coordinate moves

### Acyclic torsions

A bond is eligible only if it is:

- single;
- non-aromatic;
- not in a ring, determined by requiring bond removal to split the graph;
- between two non-hydrogen atoms; and
- not amide-like: a C–N bond whose carbon has a double bond to O or S.

Removing the bond defines two graph components. A rotor is excluded when both components contain an
inherited atom. Otherwise the component containing no inherited atom moves. If neither side contains
an inherited atom, the smaller component moves; ties use a canonical numeric atom-index order. The
complete move list is canonically sorted, so permuting the bond-array serialization cannot change a
same-seed run. A moving component
containing an inherited atom or containing only the rotating bond atom is excluded.

### Saturated-ring crankshafts

The molecular graph is searched for shortest-path cycles of 3–12 atoms. A cycle is flexible only
when every cycle edge is a non-aromatic single bond and it shares no atom with another perceived
cycle; fused, bridged, and spiro systems are excluded. For every pair of nonadjacent ring atoms, each
of the two paths between the pair is a candidate moving arc. The axis is the line through the path
endpoints. The path interior and every non-ring branch attached to that interior rotate together.
A move is rejected if its moving set contains an inherited atom or if any moving/fixed bond crosses
the boundary anywhere except an axis endpoint. A move is also rejected when its axis or ring arc
touches a graph-perceived tetrahedral stereocenter, a ring atom with a multiple/aromatic bond, or a
lactam C-N unit. A pendant carbonyl attached through a saturated ring substituent can move rigidly
with that substituent; a carbonyl whose carbon is itself a ring atom cannot. Rotation preserves every
bond length exactly but is not assumed to preserve unguarded valence angles or stereochemistry.

The registered angles are
`[-60,-45,-30,-20,-15,15,20,30,45,60]°`. This is a local saturated-ring move family, not complete
ring-conformer enumeration. Fused-ring concerted moves, lactam/conjugated-ring moves, direct ring-
carbonyl repositioning, macrocycle closure, bond-angle moves,
bond-length moves, and rigid-body moves are absent.

## Restraint-driven generation and physical refinement

Pose generation is deliberately staged. A required contact is not a post-generation filter and a
favorable physical score cannot prevent the generator from attempting to capture it.

### Stage 1: pharmacophore capture

Each candidate receives 96 capture proposals by default. The dominant capture objective is the sum
of the selected required-contact flat-bottom penalties defined above. Ordinary receptor
Lennard-Jones/Coulomb and ligand-strain ranking cannot outweigh capture. Two registered sanity gates
also participate: relative OpenFF Sage ligand strain may not exceed `100 kcal/mol` above the lowest
exact-core starting seed, and the pose may introduce at most two steric-clash diagnostics beyond
the least-clashing exact-core start. Lennard-Jones repulsion may also rise by at most `100 kcal/mol`
above the least-repulsive exact-core start; this severity gate prevents one catastrophic overlap
from passing a count-only clash limit. Squared gate excesses guide the search away from invalid
geometry; a contact that meets D-H-A geometry but fails any gate is not feasible.

At each proposal:

1. Draw one eligible acyclic-torsion or saturated-ring crankshaft move uniformly.
2. Draw one angle uniformly from the registered list for that move kind. The torsion list is
   `[-180,-120,-90,-60,-30,-15,15,30,60,90,120,180]°`.
3. Evaluate four rotations from the current state using angle fractions
   `[0.5,0.75,1,1.25]`.
4. Select a feasible fraction before an infeasible fraction, then the lower capture objective,
   then the lower fraction for an exact tie.
5. Apply the annealed acceptance heuristic below to the selected fraction.

Temperature follows a geometric schedule:

```text
t = step / (steps - 1)
T = 900 * (150 / 900)^t kelvin
```

For one proposal, `t=1`. The Boltzmann constant is
`0.00198720425864083 kcal mol^-1 K^-1`.

Acceptance is lexicographic:

- infeasible → feasible: always accept;
- feasible → infeasible: always reject;
- unchanged feasibility with `delta <= 0`: accept;
- unchanged feasibility with `delta > 0`: accept when
  `random() < exp(-delta/(kB*T))`.

The retained best state is feasible before infeasible, then lowest current-stage objective.

Because each random proposal is replaced by the objective-best of four deterministic fractions,
this kernel is an annealed stochastic line-search heuristic. It is **not** a symmetric proposal and
therefore is not claimed to be equilibrium Metropolis/Hastings sampling or ICM Biased Probability
Monte Carlo. Temperature only controls acceptance of uphill line-search results.

After the stochastic proposals, up to three deterministic best-improvement sweeps are performed.
One sweep evaluates every eligible move, every registered angle for that move, and all four line
fractions from the current state. The single feasible-first, lowest-penalty candidate is accepted
only if it improves the current state. Polishing stops immediately when a sweep finds no
improvement. Every evaluated geometry and count is audited.

If all required contacts remain infeasible after capture and polish, the closest audited capture
geometry is returned as infeasible. Physical stochastic line search and OpenMM relaxation are skipped so they
cannot hide the failed pharmacophore hypothesis behind a lower-energy nonbinding geometry.

### Stage 2: physical refinement

Physical refinement starts only from a contact- and sanity-feasible geometry and receives 96
proposals by default. It uses the same move families, angle fractions, PRNG stream, temperature
schedule, and annealed acceptance heuristic. Its objective is the complete physical-plus-restraint
objective below. A move from
feasible to infeasible is always rejected, including when an infeasible line fraction has lower
energy than a feasible fraction. Input order breaks an exact final ranking tie.

## Parameterization and score

The edited ligand is freshly parameterized with the bundled OpenFF Sage 2.1.0 valence and vdW
parameters, source SHA-256
`694df155d76d06baf7f4c9603e092798f11b6c758e08bbd86571de03350178ea`.
Partial charges are deterministic RDKit Gasteiger charges with 12 iterations. This is not the
official Sage AM1-BCC charge assignment and must be named explicitly.

The receptor uses its already captured numeric System. For every ligand-receptor-site atom pair at
distance `r <= 8 Å`:

```text
sigma_ij   = (sigma_i + sigma_j) / 2
epsilon_ij = sqrt(epsilon_i * epsilon_j)
LJ_ij      = 4 * epsilon_ij * ((sigma_ij/r)^12 - (sigma_ij/r)^6)
Coulomb_ij = 332.063713299 * q_i*q_j / (4*r)
```

Epsilon is converted from kJ/mol to kcal/mol. An individual LJ repulsion is capped at
`1e6 kcal/mol`. `r < 0.72*sigma_ij` is reported as a steric clash. It is not a separate physical-
stage energy term. Both clash count and LJ increase beyond their registered capture-sanity
allowances contribute capture-stage excess penalties and feasibility failure.

For candidate `p`, ligand strain is:

```text
strain(p) = SageVacuumEnergy(p) - min(SageVacuumEnergy(each hard-snapped and H-restored starting candidate))
```

with weight 1. The reported physical score is cross LJ + cross Coulomb minus the lowest inherited
fixed-core starting interaction, plus relative strain. The subtracted interaction is one run-wide
constant, so it cannot change proposal acceptance or pose ranking. Absolute LJ, Coulomb, interaction
reference, relative interaction, and strain are all retained in the labbook. The complete objective
is the physical score plus the core and H-bond penalties. In pose propagation the hard
coordinate snap makes the inherited-core RMSD and its penalty exactly zero. The legacy core
flat-bottom settings remain audited but are not a substitute for hard snapping.

Final ranking is feasible before infeasible, then complete objective ascending, then original
candidate index ascending. This is a pose-ranking score and has no binding-affinity interpretation.

## Fixed-scaffold relaxation

After successful contact capture and physical refinement, each captured candidate receives 60
ligand-only iterations by default using OpenMM
8.2 Reference compiled to WebAssembly, the fresh Sage/Gasteiger ligand System, vacuum, and no added
dynamics constraints. The receptor is not present in this minimizer.

For each iteration, OpenMM forces are converted to kcal/mol/Å. Every movable atom receives a
force-directed displacement with scale `1e-4`, capped at `0.01 Å` per iteration. All inherited heavy
atoms are restored to their pre-relaxation coordinates after every iteration and are restored once
more at the worker boundary. Their returned coordinates must therefore be bit-for-bit identical.

The relaxed pose is rescored against the rigid receptor. It replaces the torsion-search pose only
if:

- feasibility changes from false to true; or
- feasibility is unchanged and the complete objective strictly decreases.

It is rejected if feasibility is lost, or when feasibility is unchanged and the objective is equal
or worse. This receptor-aware *acceptance gate* must not be described as receptor-aware force-field
minimization: only ligand-internal forces act during relaxation.

## Required output and audit

Every run records:

- protocol ID, version, complete protocol snapshot, and protocol SHA-256;
- SHA-256 and atom count for exact receptor and edited-ligand coordinate inputs;
- reference-ligand hash;
- inherited, added, removed, and changed-element IDs;
- selected and omitted reference contacts;
- actual candidate count, base seed, per-candidate seed, capture/refinement settings, and complete
  internal-coordinate move definitions;
- parameter identities and source hashes;
- per-candidate capture line-search, exhaustive-polish, physical-refinement, and relaxation statistics;
- feasibility, geometry, score components, ranking, and selected pose;
- ordered events carrying the previous event hash; and
- a final SHA-256 over the complete coordinate-free labbook.

The coordinate-free labbook alone cannot recreate proprietary coordinates. Strict replay requires
the coordinate files whose hashes match it.

## Failure conditions

The run must stop rather than guess when:

- fewer than three non-collinear inherited heavy atoms survive;
- the ligand is no longer a separate connected molecular component;
- the receptor site changed after capture;
- ligand parameterization is incomplete or non-finite;
- a selected contact cannot be mapped consistently;
- a coordinate, force-field energy, or score is non-finite; or
- a refinement returns the wrong atom or candidate count.

## Relationship to earlier procedures

| Procedure | Shared idea | Molarium difference |
| --- | --- | --- |
| Conventional MCS alignment | Preserve a common reference substructure | Recorded edit lineage is exact and fixes every surviving heavy atom; no MCS inference is run |
| TEMPL | Hard reference coordinates for mapped atoms | No template search, ETKDG, shape ranking, or receptor-free final selection; only the edited graph is searched and candidates are receptor-scored |
| Ohadi et al. FEP+ benchmark | Reference-pose information and H-bond information can improve pose preparation | Molarium adopts the pose-preparation lesson only; it does not reproduce FEP+, water protocols, or reported affinity calculations |
| Practical RBFE setup guidance | Preserve the common region and sample modified substituents | Molarium specifies exact graph identity, rotor moves, scoring, acceptance, and audit rules |
| Glide/ICM constraints | Staged torsional search and explicit interaction restraints | No proprietary grids, scores, defaults, source code, or claimed product equivalence |
| ConstraintDock-1 | Rigid receptor, exact core placement, torsion MC, explicit H-bond feasibility | ConstraintDock starts from ETKDG and a user-selected core; Pose Propagation starts from an edit and automatically fixes all survivors |

## Validation contract

The protocol is not release-valid unless tests establish:

- stable same-seed replay;
- the published PRNG vector and candidate seeds above;
- inherited/added/removed/changed-element mapping;
- rejection of underdetermined maps;
- exclusion of amide/inherited-core torsions and exact bond/core preservation by ring crankshafts;
- a generation test in which a misleading physical score favors the missed contact but the
  pharmacophore-capture stage still creates and retains the feasible geometry;
- deterministic exhaustive capture-polish replay and honest termination when the registered move
  family cannot reach the restraint;
- bit-for-bit inherited coordinates after relaxation;
- feasible-first ranking even when an infeasible pose has lower energy;
- correct H-bond boundary behavior;
- valid protocol and event hash chains;
- explicit omission of deleted contact atoms; and
- a complete browser execution through fresh parameterization, search, relaxation, ranking, and pose application.

These are implementation and reproducibility gates. Accuracy claims additionally require cognate
redocking, analogue-pose recovery, seed sensitivity, and comparison against native published
baselines on held-out series.
