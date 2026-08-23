# Debugging episode: a restraint becomes a generator

Date: 2026-08-22

Branch: `feature/constraint-guided-conformers`

Protocol: `molarium-pose-propagation-1` version `0.7.0`

Status: implementation and focused validation in progress

## Trigger

The user rejected a generate-then-filter interpretation of required pharmacophores:

> “do we only filter for the H-bond/pharmacophore match after conformation generation? no the
> generation itself has to be biased towards that H-bond!!”

That correction was scientifically important. A final feasibility filter cannot rescue a generator
that never visits the constrained region, especially when a physical score favors the unbound local
minimum.

## Literature decision

Public ICM descriptions establish the relevant behavior: flexible-ligand internal-coordinate Monte
Carlo is interleaved with local minimization, and interaction/distance restraints act as force
potentials during optimization rather than only as final filters. The proprietary source,
receptor-grid construction, scoring function, tuned weights, and commercial defaults are not public.
An exact ICM reproduction is therefore neither supportable nor claimed.

Molarium independently implements the narrower requirement needed for reference-guided medicinal
chemistry: exact surviving-atom lineage, explicit flat-bottom D-H-A hypotheses, restraint-driven
acyclic-torsion and saturated-ring crankshaft generation, then transparent physical refinement.

Primary method references:

- Totrov M, Abagyan R. *Flexible protein-ligand docking by global energy optimization in internal
  coordinates*. Proteins. 1997. https://pubmed.ncbi.nlm.nih.gov/9485515/
- MolSoft public ligand-tether documentation.
  https://molsoft.com/~eugene/icmpro/ligand-tether.html
- MolSoft public small-molecule docking tutorial.
  https://molsoft.com/~jack/icmpro/start-dock.html

## Defect exposed by the first implementation

The first revision used one blended objective: rigid-pocket energy, relative Sage strain, and an
eightfold H-bond penalty. It did evaluate the contact at every move, but physical energy could still
outweigh capture before a feasible geometry existed. In the hydrated 7KPA
pyridone-to-cyclohexanone regression, 16 chains each made 96 ring-aware proposals, yet the selected
pose backed away to a D-A distance of 5.555 Å.

This was not accepted as restraint-driven generation.

## Implemented algorithm

The replacement is explicitly staged:

1. **Pharmacophore capture.** Ninety-six annealed stochastic line-search proposals are driven by
   selected flat-bottom required-contact penalties. Acyclic torsions and chemically protected ring
   crankshafts are eligible; every proposal evaluates four deterministic angle fractions. Explicit
   excess-strain and excess-clash terms act only as chemical-sanity gates.
2. **Exhaustive capture polish.** Up to three best-improvement sweeps enumerate every eligible move,
   registered angle, and line fraction. Failure after this stage is an audited move-family failure,
   not a missed final filter.
3. **Physical refinement.** Only a capture-feasible pose advances. The complete rigid-pocket,
   relative Sage strain, core, and H-bond objective is optimized while every feasible-to-infeasible
   move is rejected.
4. **Fixed-scaffold Sage relaxation.** Only captured poses are relaxed. Infeasible capture poses are
   returned at their closest contact geometry and are not allowed to drift toward a cosmetically
   lower-energy miss.

All surviving reference heavy atoms remain bitwise fixed. Ring crankshafts rotate one ring arc and
its attached substituents about two ring endpoints, preserving every bond length. The method does
not yet perform fused-ring concerted moves, macrocycle closure, bond-angle or bond-length moves, or
soft/tethered movement of the surviving scaffold.

## Independent safety audit and discarded apparent success

The first ring implementation had a deeper defect: bond-length and closure preservation did not
guarantee stereochemical or valence-geometry preservation. Rotating an arc about a nonbonded endpoint
chord could invert a substituted cyclohexane's signed tetrahedral volume, and 2-piperidone/lactam
moves could distort the C-N-C=O region. A required H bond reachable only through such a move could
have been labeled feasible. That behavior was rejected rather than hidden in a favorable benchmark.

The safe v0.7 boundary excludes ring moves touching graph-perceived tetrahedral stereocenters, ring
multiple-bond atoms, or lactam C-N units. It also requires a captured pose to remain within 100
kcal/mol of the lowest exact-core Sage starting energy and to introduce no more than two steric-
clash diagnostics relative to the least-clashing exact-core start. Direct cyclohexanone-carbonyl
repositioning is consequently outside the present move family; a pendant carbonyl may still travel
rigidly with a saturated substituent.

The review also corrected the method name. Choosing the objective-best of four deterministic angle
fractions creates an asymmetric, state-dependent proposal. Applying `exp(-delta/kT)` afterward does
not make it equilibrium Metropolis/Hastings and does not reproduce ICM BPMC. The implementation and
labbook now call it an annealed stochastic line-search heuristic. The public ICM principle adopted
is restraint-during-search, not the proprietary search kernel.

## Focused validation

The unit suite includes a deliberately adversarial score in which the physical term strongly favors
the planar, contact-missing ring. Capture still generates the H-bonded ring pose first, and physical
refinement cannot leave it. Additional gates cover ring perception, aromatic exclusion, exocyclic
substituent movement, bitwise core preservation, exact bond-length preservation over five angles,
acyclic torsions, feasibility-first line selection, deterministic replay, exhaustive polish, an
impossible restraint, zero-move behavior, and invalid settings.

The pre-audit 48-chain 7KPA diagnostic moved the replacement carbonyl from D-A 6.706 Å to 4.195 Å.
The safety review showed that this progress came from an unsafe direct-ring-carbonyl crankshaft. It
is retained as a debugging observation but withdrawn as validation evidence.

The safe v0.7 browser smoke exposes three ring moves, none touching that carbonyl. Eight stochastic
proposals plus one 120-evaluation exhaustive polish sweep leave the Lys→carbonyl contact at D-A
6.706 Å / H-A 5.905 Å and report `capture-infeasible`; ordinary physical refinement and OpenMM
relaxation do not run. The ligand remains inside the strain/clash sanity gate. A future protocol arm
must use a stereochemistry- and valence-preserving concerted ring generator, a softly tethered common
scaffold, or explicit constrained bond-angle relaxation. That is a material method change and must
not be slipped into v0.7 as a success-oriented exception.

## Twenty-five-system browser smoke

The registered 25-case set was then executed end to end at reduced effort. Ten cases reached feasible
poses; five stopped at explicit protein-preparation blockers; three reported no feasible pose; one
reported an unavailable reference contact; two stopped at unsupported parameterization; and four
adversarial negatives correctly remained infeasible (the fifth shared an unsupported parameterization
boundary). There were no runtime or geometry-sanity failures. The development report SHA-256 is
`edc2e12d28912d5958fcc6830702584b7f57fec30e4ab9df16076ff6ccacba82`. It is private development
evidence, not a release accuracy benchmark.

## Verification matrix at handoff

- `npm run test:docking`: pass; constraint/labbook plus restraint-driven-search unit suites.
- `npm run test:docking-browser`: 68/68 focused browser checks pass.
- `npm run test:7kpa-contacts`: 3/3 real-fixture contact-capture checks pass.
- The 25-case curation, fixture, atom-map, interaction-hypothesis, and manifest validators all pass.
- `npm run test:development-log`: session-exporter test passes.
- The complete unrelated `npm test` browser sweep aborts before its assertions with the existing
  ONNX Runtime message `energy: no available backend found ... previous call to initWasm() failed`.
  This is recorded as an open whole-app harness/backend issue; it is not represented as a passing
  gate and did not occur in the focused docking browser suite or the 25-case smoke.

## Reproducibility boundary

The curated episode records decisions and observed evidence. The private lossless Codex rollout
remains outside Git because it can contain credentials, internal context, and embedded images. A
redacted transcript may be exported separately under the documented development-log workflow; it is
not a substitute for the executable protocol snapshot and hash-linked per-run labbook.

## 2026-08-23 — the 33,000 kcal/mol lactam was a presentation failure

The chemist saturated the two pyridone double bonds and received one infeasible pose labeled around
33,000 kcal/mol. We reproduced that exact public action route with eight chains. A deterministic
rerun produced 89,354.97 kcal/mol because the displayed number was an unlabelled mixed objective,
not a ligand energy or binding energy. Its decomposition was decisive: +1.43 kcal/mol relative Sage
ligand strain, +0.38 kcal/mol restraint penalty, and 89,353.17 kcal/mol absolute Lennard-Jones
repulsion. Eight clash diagnostics were present, seven inherited from the fixed-scaffold starting
pose. Three contacts passed, while Lys→lactam O missed the D-A cutoff by 0.158 Å.

The decision was not to tune away an embarrassing value. We retained every absolute term in the
labbook, subtracted the inherited fixed-core interaction baseline as a run-wide constant, and changed
infeasible pose rows to report failed contacts and added clashes first. Constant subtraction cannot
alter search acceptance or ranking. A dedicated real-7KPA browser gate now protects the decomposition
and UI semantics. The decomposition also invalidated a count-only safety assumption: one extra clash
can be catastrophically worse than two mild contacts. A second gate now rejects capture states whose
Lennard-Jones repulsion rises more than 100 kcal/mol over the least-repulsive inherited start. The
corrected deterministic rerun selected the inherited baseline (Δphysical 0.00, restraint 1.3215
kcal/mol, seven inherited and zero added clashes). It retained the honest Lys-contact miss instead
of manufacturing a nominal capture through the receptor.
