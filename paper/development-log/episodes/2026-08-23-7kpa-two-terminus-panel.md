# Debugging episode: a preregistered 7KPA two-terminus analogue panel

- **Date:** 2026-08-23
- **Area:** Chemist Actions, reference-guided pose generation, independent engine validation
- **Status:** local browser and native-CPU lanes complete; independent ANI-2x/GPU lane pending

## Question

After a single difficult pyridone-to-cyclohexanone edit began to work, the user asked whether the
method generalized. The requested stress test was deliberately medicinal-chemistry-like: propose
acceptor and donor/acceptor replacements at both polar ends of the crystallographic 7KPA D84
ligand, perform the edits through the same public actions a chemist or agent can use, propagate the
reference pose, and test whether the selected pharmacophore constraints could actually be met.

The exercise is a pose-generation validation. It is not an affinity benchmark, a claim that a
bioisostere is synthetically accessible, or evidence that cross-analogue absolute energies are
comparable.

## Preregistration and public-action boundary

The panel manifest fixes 20 transformations before generation: nine pyridone cases, eight
pyrrolidone cases, and three dual-end cases. Each transformation is an atom-name-resolved sequence
of public `MolariumChemistActions` calls, including explicit `build.finishChemistry` boundaries.
Every case also fixes the expected product atom/bond/charge/hydrogen contract and SHA-256 graph
identity. A result cannot be called a pose success if browser RDKit sanitization fails or the
observed product graph differs from that contract.

The two-replay protocol uses eight independent search chains per case. It records every public
action, product graph, contact remap, required-contact geometry, relative Sage strain and clash
term, applied coordinates, and the verified docking-labbook hash chain.

## Local result

The complete run produced:

- 20/20 deterministic replay agreements;
- 15 cases with at least one browser-feasible pose;
- four honest `no-feasible-pose` cases;
- one `required-contact-unavailable` chemistry;
- 304 exported pose instances across 19 runnable chemistries;
- 238 browser-feasible and 66 browser-infeasible pose instances; and
- 79 exact-coordinate-unique review poses after deterministic shortlisting.

The cyclohexanone case produced eight distinct poses, seven of which satisfied all three retained
contacts. The cyclic amidine recipe did not reach pose generation because its required contact had
no compatible feature after the committed chemistry. These outcomes are retained rather than
silently repairing the protocol after seeing the results.

## Independent numeric-System boundary

Pose coordinates are exported by public `pose.apply` followed by public read-only
`session.inspect`. The test harness adds one read-only attachment: the exact ligand numeric Sage
System used by that refinement. It exposes no hidden mutation, scoring, or alternate pose path.

The first converter assumed the public inspection atom order equalled the numeric-System order.
The real panel disproved that assumption. The safe correction requires identical unique stable-ID
sets and performs one explicit reorder into numeric-System order, recording both order hashes.

The first cross-language hash also used ordinary JSON numbers, which serialized differently in
JavaScript and Python. Numeric integrity now hashes every floating-point value as tagged IEEE-754
binary64 big-endian hex in both languages. This is an encoding correction, not a tolerance.

All 304 packets then passed local native OpenMM Reference reconstruction and RDKit MMFF94
execution. There were no identity, topology, numeric-System, force-class, or engine failures.
These calculations are same-graph pose diagnostics. Absolute OpenMM/MMFF energies are not compared
between analogues.

## Determinism bugs found by the panel

Two false nondeterminisms were exposed and fixed narrowly:

1. contact-remap timestamps and random committed-edit IDs were included in replay hashes even when
   the scientific atom mapping and feature semantics were identical; and
2. exported pose IDs included replay ordinals even when the coordinate and System hashes were
   identical.

The stable payload removes only those run identities. Tests prove that changed contact semantics,
coordinates, topology, or numeric-System hashes still change the replay hash.

The shortlist itself exposed another deterministic tie bug: assigning duplicate coordinate hashes
into a `Map` retained the later replay. The rule now explicitly keeps the lexically first pose and
has a regression test.

## Mol* review artifact

A separate read-only pose-review site uses a pinned locally vendored Mol* 5.11.0 setup: raw PDB/MOL
builders, hidden controls, axis removal, and resize observation. It makes
no external request and never rescales or refines a pose.

The prepared reference ligand aligns to the crystallographic 7KPA frame through a translation
derived from 41 matched heavy atoms; alignment RMS is approximately `1.1e-14 Å`. The first rendered
test exposed two presentation failures. Mol* auto-framed the entire TNF trimer, and a 6 Å all-atom
shell showed 40 residues. A deterministic ligand-centered camera and a 3.5 Å immediate contact
shell (16 residues) made the candidate/reference overlay judgeable. Both corrections are visual
only and leave coordinates unchanged.

## Artifact digests for this run

- complete browser results: `d71dae031247ffa03b0f30dfca5c3f73ece05bd5cfc2b00e860cf4415e908fa2`
- 304-pose independent packet: `4fd3f5cc91fe9da014e9ae69c46f3ee4c6bd3bb7b8e0b454cea1219b05e5b6a8`
- 79-pose shortlist: `af40c1a70cd50da65163d20e63b52cd79766cc5110e4d5cb2be4d949afc5b56c`
- local native validation: `40723ae8fc8d83bae1467a28ce7508aee970aba7044900d8412ba2509f70cd79`
- generated pose-review data: `8c475d99deb8f2c6cfec43281ff7b11d18f5f2d16fc0eab2e21bd6b80d31f24c`

The raw artifacts live outside git because they are generated and collectively large. The manifest,
builders, validators, tests, exact commands, schemas, and digests are version controlled.

## Remaining claim boundary

The local result establishes reproducible execution of the browser method and independent native
CPU readability of every exported pose/System. It does not yet establish ANI-2x strain ranking,
OpenMM CUDA parity, experimental pose recovery, affinity prediction, or prospective design value.
The pinned PsiBlue lane is designed to test ANI-2x and OpenMM CUDA on the 79-pose shortlist after
the external environment install is explicitly approved.
