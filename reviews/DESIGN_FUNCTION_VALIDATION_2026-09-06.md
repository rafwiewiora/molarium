# H-bond-constrained design: API and hands-on browser checks

Date: 2026-09-06. Application commit: `863aeba`. Host: Apple M1 Pro, macOS Chrome.
This is a development regression panel, not a new blind pose-accuracy or affinity benchmark.
The systems were selected using existing preparation results; no analogue crystal coordinates
were used for generation or consulted to choose a pose. The frozen 25-case cohort is unchanged.

This report preserves the **pre-fix observations** at `863aeba`, not a claim about every later
release. The public [finding-to-fix ledger](./DESIGN_FINDINGS_AND_FIXES_2026-09-06.md) tracks
DV-01–DV-07, replacement tests, and unresolved boundaries without overwriting these results.

## What actually moves

| Operation | Ligand | Receptor | Required H-bonds |
|---|---|---|---|
| Reference pose propagation | Protected core exact; edited regions and explicitly edit-associated torsions sampled | Fixed | Drive search; hard acceptance gate |
| Pocket relax | Entire ligand released | Side chains in the 5 Å pocket; backbone fixed | Not explicit restraint forces |
| Induced-fit pocket | Reference-retention islands fixed when active; other ligand atoms released | Whole residues entering the 6 Å shell, including backbone; eligible displaceable waters | Not docking H-bond restraint forces; registered pose/valence safeguards are separate |
| Side-chain rotamers | Fixed during branch application | One side chain moved discretely in chi space | Steric pre-ranking, not contact or affinity validation |

A rotamer move chooses another side-chain configuration; minimization settles coordinates locally.
Neither guarantees that the other has happened. After a receptor move, refresh its captured reference
and re-evaluate the ligand against the new receptor. A seed chi label is not a measurement of a
subsequently relaxed chi. These tests apply a branch and re-refine the ligand; they do **not** yet
establish exhaustive coupled rotamer/minimization convergence.

## Systems and observations

The first system comes from the NMS-P118 PARP-selectivity series: the starting structure is **PARP2**,
not PARP1, even though NMS-P118 was developed for PARP1 selectivity.
[Structure and primary citation](https://www.rcsb.org/structure/4ZZY).
The p38 starting complex is [3FLY](https://www.rcsb.org/structure/3FLY), and the CDK2 starting
complex is [1H1Q/NU6094](https://www.rcsb.org/structure/1H1Q).
Our PARP2 halogen and p38 thiocarbonyl edits are functional-test hypotheses, not claims about those
papers' exact designer intentions. CDK2 uses the existing registered graph-only chlorination step.

| Test | Feasible candidate chains | Protected atoms, measured displacement | Contact-policy result |
|---|---:|---|---|
| PARP2: distal aromatic F → Cl | 64/64 | 27; exactly 0 Å | Both carbonyl contacts retained |
| p38: carbonyl O → S | 64/64 | 23; exactly 0 Å | Backbone and water contacts retained/remapped |
| CDK2: meta chlorination | 23/64 | 19; exactly 0 Å | **Failed original-contact-set preservation**: required N7–water contact became unavailable and was automatically omitted |

These are candidate-chain counts, **not distinct poses**. All three searches report complete v5
seed-stratum coverage. The CDK2 feasibility number applies only to the reduced contact set; it is
not a pass for the originally asserted design intent.

The CDK2 search released five inherited ring atoms through an edit-associated attachment torsion
and selected its 180° seed. Their maximum displacement was 2.506 Å. This is declared affected-rotor
sampling, not a violation of the remaining 19-atom fixed core. However, inherited-atom counts and
the smaller actual hard core need distinct user-facing labels. p38 similarly releases the changed
chalcogen and adjacent carbonyl carbon. Stable atom identity alone does not imply a fixed coordinate.

Ordinary pocket relaxation moved ligand heavy atoms by at most 0.208 Å (PARP2), 0.291 Å (p38), and
0.582 Å (CDK2). Matched induced-fit maxima were 0.100, 0.171, and 0.036 Å; its protected atoms showed
only the documented float32 coordinate round-trip, with zero excess residual. Both lanes were
accepted by their valence/retention safeguards and Undo restored ligand coordinates exactly.
Live required-contact geometry remained within the registered ranges in these examples. That does
not establish H-bond preservation by either unrestrained minimizer.

Discrete branches were tested for SER470 (PARP2), MET109 (p38), and PHE80 (CDK2): 4, 16 retained
of 28 generated, and 13 candidates respectively. Applying a branch, updating the receptor reference,
and repeating constrained refinement completed. Pocket Undo comparisons were exact over inspected
atoms, but the public 500-atom inspection limit truncates the wider pocket; this is not an all-complex
coordinate proof.

Deleting PARP2 O28 or replacing p38's donor N12 with carbon produced chemically valid edited states
with unavailable **still-required** contacts; refinement correctly refused to run. CDK2 N3 → C was
blocked earlier by the aromatic-edit guard requiring explicit kekulization. That is a chemistry
guard observation, not a passed negative pose test.

A separate geometry-only negative leaves CDK2 chemistry intact and asserts an additional
LYS33 NZ → ligand N3 H-bond with an actual donor–acceptor separation of **8.627 Å**. None of the
eight candidates were feasible (**0/8**), and `pose.apply` rejected the selected candidate. Explicitly
omitting that extra contact restored **8/8** feasible candidates. This exercises manual contact
addition, geometric infeasibility, application rejection, and the required/optional switch without
confounding the test with missing chemistry. [Raw action record](./design-validation-2026-09-06/impossible-contact.json.gz).

## Confirmed gaps in the audited baseline

1. **Required-contact policy changes in the registered graph-edit path.** The CDK2 example loses
   a required contact without a separate `pose.setContact` decision. `stageBenchmarkPoseProduct`
   reconstructs the selected set from availability and target-feature status. Preserve the prior
   required set, or require and expose an explicit authored override; do not quietly claim success.
2. **Cached contact geometry after relaxation.** `session.inspect().contacts[].hydrogenBond`
   can still report the last candidate's geometry/satisfaction, and receptor participant coordinates
   are captured reference points. For example, PARP2's SER470 H–acceptor distance changes from
   1.777 to 1.873 Å after ordinary pocket relaxation, while the cached field remains 1.777 Å.
   Measure current `atoms[].coordinatesAngstrom` by participant ID; invalidate or clearly label
   cached metrics after any coordinate-changing operation.
3. **Intent vocabulary is inconsistent.** “Unchanged atoms fixed” overstates the hard core when
   edit-associated rotor sampling releases inherited atoms. Report persistent IDs for each set.
4. **Contact perception needs a chemistry review.** The PARP2 UI automatically calls an organic
   fluorine a required “fluorine acceptor.” This panel explicitly omitted that contact before editing
   and required only captured ligand N/O contacts. It is not silently counted as an ordinary strong
   carbonyl/amine pharmacophore anchor.

No production implementation was changed by this original validation pass. Subsequent fixes
and separately recorded verification belong in the linked finding-to-fix ledger.

## Hands-on production-browser lane

Using the browser-control skill, I loaded PDB identifiers and operated real UI controls, including
clicking the ligand's 2D fluorine, selecting Cl, finishing the edit, choosing the two carbonyl contacts,
running 64-chain refinement, applying its pose, and running ordinary Pocket relax.
PARP2 returned one distinct feasible edited pose, zero reported clashes, and a completed 120-step,
26-frame WebGPU minimization. [Applied-pose screenshot](./design-validation-2026-09-06/parp2-browser-applied.png)
and [relaxed screenshot](./design-validation-2026-09-06/parp2-browser-pocket-relaxed.png), with DOM
snapshots beside them, preserve the observed interface state.

This lane used the ordinary **crucial-water** default: 5,784 prepared atoms and 41 retained waters.
The API lane used the registered **retain-all-water** policy: 5,901 atoms. Therefore these are
independent workflow checks, not bitwise API/UI parity measurements. Browser-control calls sometimes
timed out during processing; subsequent inspection established the actual completed state.

The uncurated full CDK2 PDB loaded 9,325 atoms, four protein chains and two ligand copies. Preparation
stopped at a reported modeled-atom 0.098 Å clash. This failed preparation is retained as a UI result;
the curated registered CDK2 complex's success does not erase it. Resolving the clash's underlying
modified-residue/assembly cause remains follow-up work.

## Evidence and reproduction

[Machine-readable summary](./design-validation-2026-09-06/summary.json), its hashed protocol and
three losslessly compressed raw action/coordinate records are stored together. The summary's
`allPropagationContractsPass` is **false**, intentionally. Frozen-evidence tests independently
remeasure post-relaxation geometry and verify hashes; they do not rerun today's GPU.

```sh
bun docking/benchmark/design-function-validation.mjs --output outputs/a-new-exclusive-attempt
node docking/benchmark/summarize-design-validation.mjs outputs/a-new-exclusive-attempt outputs/a-new-summary
node --test docking/benchmark/design-function-validation.test.mjs
bun docking/benchmark/design-impossible-contact.mjs outputs/a-new-impossible-contact.json
```

Local attempts a01–a03 remain in ignored `outputs/`: a01 lacked an explicit return to Design before
rotamer enumeration; a03 likewise missed it between relaxation lanes. They are not counted as
completed matched comparisons. a04 is the archived panel. The public action guard exposed these
harness errors; the test did not bypass it. The final runner is source-hashed in the protocol.
The geometry-only negative's a01 attempt used a residue code where the portable selector expects
a component ID and failed before adding a contact. Its a02 retry resolved persistent IDs from the
public inspection response; it is the archived result.

Next priorities: preserve required-contact decisions across every graph-edit path; expose live versus
captured geometry explicitly; validate a separately named H-bond-restrained, reference-preserving
pocket minimizer; then expand to additional target families, manual replacement contacts, and matched
serial/worker and cross-browser repetitions. Neither this panel nor its timings establish pose
accuracy, affinity ranking, or GPU speed superiority.
