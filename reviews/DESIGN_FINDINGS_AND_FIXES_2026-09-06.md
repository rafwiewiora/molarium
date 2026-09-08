# Design findings, fixes, and remaining boundaries

This ledger links the [original 6 September functional audit](./DESIGN_FUNCTION_VALIDATION_2026-09-06.md)
to implementation changes and regression evidence. The original application was `863aeba`;
its source-hashed results remain unchanged, including the failed CDK2 required-contact-set gate.
Later passing checks must be recorded as separate attempts, not substituted into that audit.

This is functional validation of design operations, not a blinded reproduction benchmark,
binding-affinity validation, or general certification of the simulation engine.

## Operation contracts

| Operation | What moves? | What does a required H-bond mean here? |
|---|---|---|
| Constrained ligand search / reference propagation | Edited ligand regions and declared edit-associated torsions; the remaining protected core and receptor stay fixed | A search potential and a hard pose-acceptance condition |
| Pocket relax | Entire ligand and nearby receptor side chains in the 5 Å pocket; receptor backbone stays fixed | No H-bond force or preservation guarantee |
| Induced-fit pocket relax | Unprotected ligand atoms and complete receptor residues entering the 6 Å shell, including local backbone; an active ligand-retention plan excludes protected atoms | No H-bond force or preservation guarantee; retention and valence safeguards are different checks |
| Side-chain rotamer branch | One receptor side chain moves to a discrete canonical chi-angle candidate | Steric pre-ranking only; apply the branch, update the receptor reference, and recheck contacts |

“Inherited” denotes atom identity, not necessarily a fixed coordinate. Edit-associated torsion
sampling can release inherited atoms; only the remaining protected set is the hard search core.
The induced-fit retention plan is a separate policy and need not protect exactly the same set.
A minimizer settles coordinates locally; it does not prove that relevant rotamer barriers were crossed.

## Finding ledger

The IDs below are stable references for code, tests, changes, and follow-up work. An observed
failure is not marked resolved until its corresponding replacement behavior has been tested.

### DV-01 — Required-contact intent changes without a designer decision

**Observed defect.** Registered CDK2 chlorination made the previously required N7–water contact
unavailable and automatically omitted it. The resulting 23/64 feasible chains therefore answered
a weaker question than the one originally specified. Ordinary atom-edit negative controls correctly
kept their missing contacts required, revealing an inconsistency between editing paths.

**Additional source finding.** Rendering the selected-core contact list can remove unavailable
contacts from the selected set. A display refresh must not make a design-intent decision.

**Required fix.** Preserve previous required/optional decisions independently of feature availability.
An explicit authored requirement may override the prior decision, but availability alone may not.
An unavailable required contact must remain visible and block refinement until the user edits,
remaps, or explicitly omits it.

**Baseline evidence.** [CDK2 raw action record](./design-validation-2026-09-06/cdk2-meta-chloro.json.gz),
[frozen summary](./design-validation-2026-09-06/summary.json), and
[frozen-evidence tests](../docking/benchmark/design-function-validation.test.mjs).

**Implementation and regression.** [Required-contact policy](../docking/contact-state.mjs)
separates the selected set from availability. Registered staging and selected-core rendering in
[the application](../app.js) preserve those decisions; changing a decision invalidates prior candidate
feasibility. [Focused regressions](../docking/contact-state.test.mjs) cover preservation of required
and omitted contacts, explicit authored overrides, invalid declarations, and application wiring.

**Deeper cause identified during remediation.** The source-stable
[a03 record and source bundle](./design-remediation-2026-09-06/api-a03/manifest.json) show that
CDK2 N7 retained its aromatic N–H chemistry, heavy neighbors C5/C8, and heavy-atom coordinates.
Staging nevertheless replaced the captured H18 identity with a newly named HNEW43, so the contact
appeared unavailable even though an N–H remained. Fail-closed contact selection is necessary but
does not by itself repair that identity loss. Preserve an unambiguous single donor-H identity only
when the mapped donor's local chemistry and H count are unchanged; do not infer equivalence across
changed donor chemistry or multiple-H ambiguity. This is tracked as part of DV-01, not described
as a physical loss of the original water interaction.

[The donor-H lineage fix](../docking/registered-donor-hydrogen.mjs) now implements that
restricted mapping. [Positive and adversarial tests](../docking/registered-donor-hydrogen.test.mjs)
reject changed role/charge, bond order, mapped neighbors, local heavy-atom geometry, missing H,
and multiple-H ambiguity. In the separate [a04 attempt](./design-remediation-2026-09-06/api-a04/manifest.json),
both original CDK2 contacts remain required, available, and satisfied after applying the pose:
**23/64 feasible chains without omitting the water contact**. H18 keeps its persistent identity
and current precursor coordinates exactly; 19 protected heavy atoms and five affected-rotor
releases remain separately reported. Real PARP2 O28 deletion still leaves both lost carbonyl
contacts required/unavailable and refinement correctly refuses.

### DV-02 — Inspection mixes live atoms with cached contact geometry

**Observed defect.** After PARP2 pocket relaxation, the live SER470 hydrogen–acceptor separation
changed from 1.777 to 1.873 Å, but `contacts[].hydrogenBond` still reported the old candidate value.
Receptor participants likewise exposed captured reference points rather than their current positions.

**Required fix.** Measure both ligand and receptor participants from current persistent atom IDs.
Keep candidate predictions and captured reference coordinates explicitly separate from live geometry;
missing participants must not inherit an old satisfied result. Generating a candidate is not applying it.

**Baseline evidence.** [PARP2 raw action record](./design-validation-2026-09-06/parp2-distal-halogen.json.gz)
and [independent coordinate-based frozen checks](../docking/benchmark/design-function-validation.test.mjs).

**Implementation and regression.** [Live contact state](../docking/contact-state.mjs) resolves
both sides against current atom IDs and rejects unavailable/incompatible/missing participants as
satisfied contacts. Public inspection separately names `hydrogenBond`, `candidateHydrogenBond`,
and `referenceHydrogenBond`. Applying a winning alternative commits its feature remap along with
the pose, including ordinary Undo/Redo restoration. [Focused tests](../docking/contact-state.test.mjs)
include moved receptor/ligand atoms, invalid coordinates, role changes, and the actual apply/history
functions; [the API contract](../CHEMIST-ACTIONS-API.md) describes the result fields.

### DV-03 — Weak covalent-fluorine hypotheses become required automatically

**Observed defect.** PARP2 capture automatically selected a covalent fluorine contact as a required
“fluorine acceptor.” The functional panel explicitly omitted it and required only its captured N/O
contacts; that protocol choice is recorded, not retrospectively hidden.

**Scientific boundary.** Carbon-bound fluorine (C–F) must not be treated as an ordinary strong carbonyl/amine
anchor by default. This is not a claim that organic fluorine can never accept a hydrogen bond.
The RDKit feature definition uses a restricted C–F acceptor heuristic that excludes carbon bonded
to another halogen; Molarium's existing broad F feature label does not encode that distinction.
[RDKit primary feature definition, pinned revision](https://github.com/rdkit/rdkit/blob/a31fcbf1abb323d56d2638c0e39d631fcb318aee/Data/BaseFeatures.fdef),
[Dunitz and Taylor, 1997](https://doi.org/10.1002/chem.19970030115).

**Required fix.** Record a versioned capture policy that leaves carbon-bound F hypotheses optional,
labels their weak/chemistry-dependent interpretation, and preserves the ability to make an explicit
designer requirement. Keep historical feature identities and recorded hypotheses legible. This
changes default selection, not the physical force field or the frozen scoring protocol.

**Baseline evidence.** [PARP2 UI snapshot](./design-validation-2026-09-06/parp2-browser-applied.txt)
and [panel protocol](./design-validation-2026-09-06/protocol.json).

**Implementation and regression.** [Capture policy](../docking/contact-capture-policy.mjs)
records `ordinary-anchors-with-optional-covalent-fluorine/v1` and pinned primary-source provenance.
[Capture and mapping](../docking/browser-adapter.mjs) retain the feature signature, default it to
optional, and honor explicit requirement even for an alternative feature. The labbook distinguishes
capture defaults from selected requirements; an optional default is not falsely called a user
omission. [Focused tests](../docking/contact-state.test.mjs) cover monofluoro, geminal/polyhalogen,
CF3, unbound fluoride, and an explicit designer override. The remaining broad feature typer is not
claimed to be a complete new fluorine interaction model.

### DV-04 — Options do not clearly distinguish motion and contact policies

**Observed defect.** “Unchanged atoms fixed” overstates the protected core when inherited atoms
are released on affected torsions. Pocket and induced-fit help do not clearly state that selected
H-bonds are not enforced by those minimizers. “Relax” also obscures the difference between ligand
search cleanup, local complex minimization, and a discrete side-chain rotamer move.

**Required fix.** Give Design options concise, accessible **i** help, including the differences
between alternative values. Expose actual protected/released sets where available, and make the
protein-motion and contact-enforcement policy visible at the relevant operation. Help text must
describe implemented behavior, not promise a planned restrained minimizer.

**Baseline evidence.** [Original operation comparison](./DESIGN_FUNCTION_VALIDATION_2026-09-06.md#what-actually-moves),
[applied-pose UI snapshot](./design-validation-2026-09-06/parp2-browser-applied.txt), and
[relaxation UI snapshot](./design-validation-2026-09-06/parp2-browser-pocket-relaxed.txt).

**Implementation and regression.** [Option-specific help](../design-help.mjs) uses a native,
keyboard-accessible dialog, with descriptions of alternative values and unavailable optimizer
choices. [Shared workspace help](../workspace-help.mjs) extends the same mechanism to loading,
folding, display, simulation, and result controls. [Help coverage tests](../design-help.test.mjs) inventory the scoped controls and choices;
the existing [browser regression](../browser-test.js) checks actual help association and tool state.
`pose.refine().refinement.motionPolicy` exposes persistent protected, released-inherited,
affected-rotor-release subset, and added atom IDs; the two release lists are not disjoint.
The search control states that protein coordinates are
fixed and required H-bonds are enforced; minimizer help explicitly states the different policies.
API-only replay protocol and execution overrides are not silently advertised as visible selectors;
the interface's default search behavior and those advanced API controls remain distinct.
[Final UI evidence and scope](./design-remediation-2026-09-06/ui/README.md) cover 143 static
parameter/action controls plus dynamic Design options: 6 source tests, 10 dedicated browser checks,
and 79 docking-browser checks pass. Hands-on desktop and automated mobile checks verify focus,
disabled-control help, unchanged checkbox/molecule state, and layout. Eleven navigation/disclosure
buttons, hidden file-picker plumbing, and separate website-page widgets are explicitly outside this
parameter-help inventory; no all-page audit is claimed.

**Presentation follow-up, 7 September (EH-01).** The user found the ubiquitous icons
too intrusive. [EH-01](./ESSENTIAL_HELP_REVIEW_2026-09-07.md) retains the authored
catalogue but limits separate dialogs to 24 crucial decisions; routine/repeated
controls use native descriptions without wrappers or icons. The counts and images
above describe the original DV-04 implementation, not this revised presentation.

### DV-05 — Full-assembly 1H1Q preparation fails a severe-clash guard

**Open observed failure.** The uncurated PDB loaded 9,325 atoms, four protein chains and two ligand
copies; preparation stopped on a modeled-atom 0.098 Å clash in its 18,482-atom preview.
The underlying modified-residue/assembly cause is not yet diagnosed. The curated registered CDK2
system passing preparation is not evidence that this full-assembly failure has been fixed.

**Follow-up.** Preserve the preparation report, identify the exact atom pair and modeling step,
then add a preparation regression before changing chemistry or clash acceptance. Do not weaken
the clash guard merely to obtain a pass. [Original browser observation](./DESIGN_FUNCTION_VALIDATION_2026-09-06.md#hands-on-production-browser-lane).

### DV-06 — H-bond-restrained pocket relaxation is not implemented

**Open capability boundary, not a newly observed numerical bug.** The two existing pocket
minimizers do not include selected docking H-bonds as force terms. In the panel their final live
contacts remained within bounds, but that does not establish contact preservation in other cases.

**Follow-up.** Implement and independently validate a separately named reference-preserving,
H-bond-restrained pocket action if that workflow is desired. Do not relabel the existing induced-fit
action as restrained. Coupled rotamer/minimization convergence remains unestablished by this panel.

### DV-07 — Validation scope limits remain part of the result

**Documented limits, not claimed fixes.** The public 500-atom inspection cap truncates the wider
pocket, so exact pocket Undo checks cover inspected atoms, not the full complex. The API retained
all waters while the hands-on PARP2 lane used the ordinary crucial-water default; these are workflow
checks, not bitwise API/UI parity. CDK2 N3→C was blocked by aromatic chemistry validation before
pose testing; the separate unchanged-chemistry 8.627 Å contact is the geometric negative control.
Candidate-chain counts are not counts of distinct poses. No additional blind accuracy cohort is
created by this three-system development panel.

## Remediation and release evidence

The separate [SOS1 AWW source-graph discrepancy and author decision](./SOS1-AWW-SOURCE-GRAPH-DISCREPANCY-2026-09-07.md)
records a later paper-review finding: the frozen run matches the deposited CCD
graph, which differs from the original medicinal-chemistry drawing. The author
chose to retain that input and its results, remove the misleading aromaticity-edit
description, and preserve the discovery trail. This is an example of auditable
reproducibility, not proof of input correctness or a claim of a corrected rerun.

Implementation, regression, UI, and publication links are appended here when verified. The
historical failures above remain visible after their software causes are corrected.

The implementation for **DV-01–DV-04** is
[commit `56f717c`](https://github.com/rafwiewiora/molarium/commit/56f717c89925a7d78088407e1649b18e4a6bdabd).
The [integration record](./design-remediation-2026-09-06/integration.json) links that commit to
the exact API/UI evidence and final local checks: 26 Design regressions, 86 simulation-evidence
tests, the broad scientific suite, 14 Local Lab checks with zero intercepted external requests,
and the 323-file production build. Remote CI and deployment status are separate release checks.
DV-05 remains an undiagnosed preparation failure; DV-06/07 remain explicit capability and
validation boundaries, not closed bugs.

- [Intermediate API a03](./design-remediation-2026-09-06/api-a03/manifest.json): source-stable
  fail-closed contact policy, explicit-omission recovery (23/64), independently measured live
  geometry after pocket relaxation and receptor motion, stale-candidate rejection, and optional
  PARP2 C–F with an explicit override. [Frozen checks](../docking/benchmark/design-contact-remediation.test.mjs)
  verify every artifact/source hash and independently remeasure the inspected contact geometry.
  This is not the later full-contact identity-preservation result.
- [Full-contact API a04](./design-remediation-2026-09-06/api-a04/manifest.json): the donor-H
  lineage correction restores the full original CDK2 question (23/64 feasible chains), while a
  genuine PARP2 acceptor deletion remains blocked. Both live measurable CDK2 contacts are audited
  after pocket relaxation; the maximum H–acceptor distance change is 0.017915 Å. That observation
  is not a guarantee that an unrestrained minimizer preserves every required contact.
- [Final scientific API a05](./design-remediation-2026-09-06/api-a05/manifest.json) additionally
  refreshes the donor H's derived incident-bond distance after preserving its coordinates.
  The full-contact, fail-closed deletion, geometry, candidate-invalidation, and weak-F tests all
  pass with identical source hashes at start and completion. Earlier successful runs are retained,
  not overwritten by this final source-matching verification.
