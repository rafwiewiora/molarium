# Molarium Pose Propagation-1

## Normative protocol

Protocol ID: `molarium-pose-propagation-1`  
Protocol version: `0.2.0`  
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
2. Every surviving reference heavy atom is fixed, not merely a selected substructure.
3. Only graph branches containing no inherited atom are torsionally sampled.
4. Required contacts are lexicographic feasibility states: a favorable energy cannot compensate
   for losing one.
5. Ligand-only force-field relaxation is accepted only after a receptor-aware feasibility and
   complete-score audit.
6. Inputs, protocol, atom lineage, settings, decisions, and results are recorded in a hash-linked
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
- Tautomer, protomer, stereoisomer, ring-pucker, or macrocycle enumeration.
- Receptor or crystallographic-water rearrangement.
- Binding-affinity or free-energy estimation.

## Exact inputs and identity

Coordinates are in ångström and energies are in kcal/mol unless otherwise stated. Atom indices are
zero-based internally.

At reference capture, every ligand atom receives a unique `designAtomId`. PDB-derived IDs encode
namespace, record, chain, residue, atom name, and serial; design atoms without those fields receive a
namespace-local ordinal. Graph editing must preserve this ID on an atom that survives an edit and
must create a new ID for an added atom.

An atom is inherited if and only if:

- it existed in the captured reference ligand;
- it exists in the edited ligand with the same `designAtomId`;
- its element is unchanged; and
- it is not hydrogen.

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

Reference-contact detection uses explicit hydrogens. A donor is N, O, or S with a bonded H. An
acceptor is nonpositive O/S/F, or nonpositive N with degree below four and no bonded H. Covalently
near pairs within two bonds are excluded. A displayed reference H bond must have:

- H–A distance from `1.2` through `2.6 Å`; and
- D–H–A angle at least `135°`.

Contacts are ordered by H–A distance, limited to 96, and only receptor-ligand cross contacts are
captured for this protocol. Captured contacts are selected as required by default. The user may
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
If an edit deletes a ligand participant, the contact is disabled and recorded as
`ligand-atom-removed`; it is never silently mapped to a new donor or acceptor.

## Candidate initialization

The default is 16 candidates. Each begins as a `Float64Array` copy of the live edited-ligand
coordinates. Pose propagation does not run ETKDG, MMFF, UFF, rigid-body randomization, or shape
alignment. Candidate diversity comes only from independent deterministic torsion chains.

Before search, a Horn-quaternion least-squares rigid transform aligns inherited candidate atoms to
their reference coordinates. The quaternion eigenvector uses 64 shifted power iterations. After
transforming the complete ligand, every inherited coordinate is overwritten with the corresponding
reference coordinate. This hard snap is repeated at the workflow boundary.

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

## Eligible torsions

A bond is eligible only if it is:

- single;
- non-aromatic;
- not in a ring, determined by requiring bond removal to split the graph;
- between two non-hydrogen atoms; and
- not amide-like: a C–N bond whose carbon has a double bond to O or S.

Removing the bond defines two graph components. A rotor is excluded when both components contain an
inherited atom. Otherwise the component containing no inherited atom moves. If neither side contains
an inherited atom, the smaller component moves; ties follow bond orientation. A moving component
containing an inherited atom or containing only the rotating bond atom is excluded.

Ring flips, macrocycle moves, bond-angle moves, bond-length moves, and rigid-body moves are absent.

## Torsion Monte Carlo

Each candidate receives 96 proposals by default. At each step:

1. Draw one eligible rotor uniformly.
2. Draw one angle uniformly from
   `[-180,-120,-90,-60,-30,-15,15,30,60,90,120,180]°`.
3. Rotate the complete moving graph component about the selected bond.
4. Evaluate feasibility and the complete objective below.

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

The retained best state is feasible before infeasible, then lowest complete objective. Input order
breaks an exact final score tie.

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
`1e6 kcal/mol`. `r < 0.72*sigma_ij` is reported as a steric clash but is not a separate penalty.

For candidate `p`, ligand strain is:

```text
strain(p) = SageVacuumEnergy(p) - min(SageVacuumEnergy(each hard-snapped starting candidate))
```

with weight 1. The physical score is cross LJ + cross Coulomb + relative strain. The complete
objective is the physical score plus the core and H-bond penalties. In pose propagation the hard
coordinate snap makes the inherited-core RMSD and its penalty exactly zero. The legacy core
flat-bottom settings remain audited but are not a substitute for hard snapping.

Final ranking is feasible before infeasible, then complete objective ascending, then original
candidate index ascending. This is a pose-ranking score and has no binding-affinity interpretation.

## Fixed-scaffold relaxation

After torsion search, every candidate receives 60 ligand-only iterations by default using OpenMM
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
- actual candidate count, base seed, per-candidate seed, torsion settings, and rotor definitions;
- parameter identities and source hashes;
- per-candidate Monte Carlo and relaxation statistics;
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
- exclusion of ring, amide, and inherited-core torsions;
- bit-for-bit inherited coordinates after relaxation;
- feasible-first ranking even when an infeasible pose has lower energy;
- correct H-bond boundary behavior;
- valid protocol and event hash chains;
- explicit omission of deleted contact atoms; and
- a complete browser execution through fresh parameterization, search, relaxation, ranking, and pose application.

These are implementation and reproducibility gates. Accuracy claims additionally require cognate
redocking, analogue-pose recovery, seed sensitivity, and comparison against native published
baselines on held-out series.

