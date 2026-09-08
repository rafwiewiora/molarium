# Appendix B reconciliation against the public release

Scope: Appendix B.1–B.11 in `paper/revisions/2026-09-08-value-figure-cleanup-a27/main.tex`.
All implementation evidence below comes from Git object
`6d2f620d7d26e3dfd270c018f0a9be7a414f2163`, read with `git show`; the dirty paper
worktree's application files were not treated as deployed code. Live served-file
verification is a separate parent audit. This review changes neither application
code nor the manuscript and starts no scientific calculations.

The machine-applicable companion
`DEPLOYED-APPENDIX-B-REPLACEMENTS-2026-09-08.json` contains 16 unique exact
`before`/`after` replacements against a27, with evidence for each. These are narrow
contract corrections, not a general prose rewrite.

## Confirmed corrections

### B01 — Local loading and MOL support (a27 line 772)

The MOL warning is obsolete. Paste and Upload both call `session.loadStructure`
with automatic format detection; V2000 input reaches `parseMolBlock`. SMILES
embedding is local; only PDB identifier retrieval in this path requires connected
mode. Replace the old enumeration/warning with the supported format and network
distinction. Do not claim general V3000 support.

Evidence: pinned `app.js:1406`, `9743–9800`, `17099–17162`.

### B03 — Protonation target is a standalone SMILES molecule (a27 lines 871–874)

The visible pH panel does not enumerate an arbitrarily selected component in a
protein complex. `ligandProtonationInput` requires `source.format === 'smiles'`
and no prediction; the UI additionally requires at most 256 total atoms.
Application embeds the selected SMILES and calls `loadMolecule`, replacing the
entire scene molecule, not just a bound component. The API can supply explicit
SMILES for enumeration but that does not turn application into an in-place
complex edit. Replace the component-selection instruction and make whole-molecule
replacement explicit.

Evidence: pinned `app.js:13981–14020`, `14044–14090`, `10270–10304`.

### B04 — State the staged policy and use the actual button label (a27 lines 914–917 and API example)

The described grouped transaction is valid with immediate finishing disabled.
The UI also offers **Finish and refine after every edit**, and the API exposes
`chemistry.setEditPolicy`. Explicitly select staged policy in the example and
tell the human to leave the immediate option off for this procedure. The commit
button is **Finish changes**, not **Finish chemistry**.

Evidence: pinned `index.html:428,434,622`; `app.js:7264–7266,7281–7292`;
`chemist-actions.mjs:89–91`.

### B06 — OpenMM has an API-only calculation route (a27 lines 1037 and 1078)

The assertion that OpenMM is absent from the Simulate menu is correct, but
describing it solely as an internal subsystem hides an installed public route.
`calculation.run` accepts `method:'openmm'`, and `runCalculation` dispatches that
method to `runOpenMMJob`. Do not imply that the menu and API expose identical
engine choices. The replacement keeps the UI limitation and names the API route.

Evidence: pinned `index.html:461–466`; `chemist-actions.mjs:232–235`;
`app.js:11403–11433,16110–16159`.

### B07 — Correct the conformer effort value (a27 line 1124)

Use `conformerEffort:"balanced"`, not `"standard"`. The UI vocabulary is
`quick | balanced | thorough`. The current protocol accepts an unknown string
and falls back numerically to the balanced defaults, so the old example may run
while carrying a misleading effort name. That fallback is not an additional
documented choice.

Evidence: pinned `index.html:520–524`; `openff/conformer-protocol.js:6–12`.

### B08 — Cancellation cannot interrupt the serialized prediction (a27 lines 1140 and 1160–1167)

This is an implementation defect, not merely a label mismatch. `protein.predict`
awaits `runProteinFold` inside the same public action queue used by
`protein.cancelPrediction`. The human Fold and Cancel buttons use these routes.
Consequently, cancellation queues behind prediction. `runProteinFold` clears its
abort controller in `finally` before the queued cancel normally runs. The example
also explicitly awaits prediction before issuing its purported active cancel.

Minimal paper correction: say cancellation is not reliable in this inspected
release, explain the shared queue in the agent paragraph, and remove the
ineffective `// while active` call. A later software correction requires its own
regression and deployed release; no such correction is claimed here.

Evidence: pinned `app.js:10197–10215,12056–12058,13389–13429,16912–16916,16955–16957`;
`chemist-actions.mjs:481–484`.

A read-only diagnostic imported the actual pinned `createChemistActionsApi`
module and used two stub routes with a deferred prediction promise. Results:

```json
{"predictionStarted":true,"cancelDispatchedWhilePredictionPending":false}
{"cancelDispatchedAfterPredictionSettled":true}
```

This verifies actual queue ordering; it is not a live MSA, OpenFold, or browser
cancellation experiment. The production route/UI source establishes the wiring.

### B09 — Match the visible mode names (a27 line 1176)

Use **Constrained pose propagation** and **Expert selected-core search**.
The serialized values remain `propagate` and `selected-core`.

Evidence: pinned `index.html:313–315`.

### B10 — Bounded audits and partial commit scripts (a27 lines 1239 and 1265)

Both the public API history and the scene-attached replay/export audit retain at
most 500 entries in this release. These are separate buffers: the scene buffer
resets during scene replacement/Clear; the API object's history is not thereby
cleared. Loading may populate the scene buffer from source metadata. Exporting a
script is not an export of all failed/raw audit records.

A campaign commit has a complete graph-and-coordinate snapshot but only retained
completed public actions since the previous commit. Its script coverage is
explicitly `complete:false`; `auditTruncated` is recorded when the retained
sequence indicates a gap. Replace the unqualified “completed public actions since
the prior commit” claim and make the retention cap visible. Do not infer complete
action coverage from an intact molecular snapshot.

Evidence: pinned `chemist-actions.mjs:419–420,454–457,486`;
`app.js:3396,9305–9316,17798`;
`design-history/live-campaign.mjs:192–233`.

### B10 — Supported scripts can carry coordinate-bearing input (a27 line 1287)

The claim that action-script JSON does not carry “direct coordinates” is too
broad. Supported structure loaders can contain PDB/XYZ/MOL coordinates; public
geometry/placement actions also have bounded coordinate arguments. The actual
boundary is no arbitrary code or unguarded state injection, not no coordinate
data. The replacement distinguishes supported loader input from a complete
workbench snapshot.

Evidence: pinned `chemist-actions.mjs:6–9,97–100`;
`app.js:9743–9774`.

## Verified distinctions and remaining qualifications

| Section | Reconciliation result |
| --- | --- |
| B.1 | View/Design/Simulate serialization and graph-versus-camera distinction agree. Save/share are not full session persistence. Loading corrections above are necessary. |
| B.2 | Preview blockers, immediate parameterization/application of a clean preview, one undo snapshot, and experimental preparation status agree with `app.js:13554–13608`; `readyForProductionSimulation:false` remains explicit at `app.js:3355`. No second Apply step should be added. |
| B.3 | pH/state enumeration and intentional application remain distinct; the target/replacement scope needed correction. |
| B.4 | Guarded graph transactions, separate coordinate operations and protein-atom protection agree; make the staged policy explicit. |
| B.5 | `fragment.stage`/`fragment.attach` and registered route actions exist with the stated vocabulary (`chemist-actions.mjs:150–158`). They are not general combinatorial enumeration or automatic MCS transfer. |
| B.6 | Nonperiodic model limitations, immediate application of successful coordinate jobs, and explicit frame selection agree (`app.js:16110–16230`). OpenMM UI/API distinction needed correction. No fresh GPU/accuracy benchmark was run. |
| B.7 | RDKit seed cap 256 (`rdkit-worker.js:285`), annealing temperatures 600/450/300 K (`openff/conformer-protocol.js:17–19`), and non-Boltzmann interpretation agree. Effort spelling needed correction. |
| B.8 | Single-chain, local OpenFold after remote MSA, WebGPU/WASM selection, three recycles and approximate 540 MB asset disclosure agree (`openfold/predictor.js:48–102,118–124,171–175`). Cancellation does not meet the prose claim. |
| B.9 | Fixed-receptor propagation, released inherited atoms versus protected core, required-contact search checks, separate pocket/induced-fit minimization, and separate discrete rotamers agree. Details below. |
| B.10 | IndexedDB campaign persistence, explicit Resume, authoritative graph/coordinate snapshots rather than whole sessions, and nonautomatic two-parent merge agree. Bounded partial action coverage needed explicit qualification. |
| B.11 | Narrative skill contracts are correctly distinguished from installed executable authority; one serialized queue is real (and is the cancellation defect's cause). Hash integrity is correctly not equated with scientific validity or authorship. The illustrative geometry/commit pattern assumes Design mode and an already active campaign; it is not a blank-start script. |

### Motion, H-bond and essential-help checks

- Constrained propagation keeps the receptor fixed, moves edited/released parts,
  and preserves its remaining protected core (`app.js:5852,5930`;
  `design-help.mjs:7–14`). Do not simplify this to “all inherited atoms fixed.”
- Pocket relaxation moves the entire ligand and side chains in the selected 5 Å
  pocket, excluding backbone; induced-fit uses 6 Å whole nearby residues,
  including backbone, eligible waters and ligand atoms outside the registered
  fixed set (`app.js:3753–3800,16703–16739`). Neither installs docking H-bond
  restraints. Contacts therefore need post-relaxation inspection.
- Discrete receptor rotamer enumeration is not minimization, does not itself
  apply coordinates, and does not imply an H-bond guarantee. Application followed
  by `pose.updateReceptorReference` before renewed ligand search is the documented
  order (`design-help.mjs:48–50`; public rotamer actions at
  `chemist-actions.mjs:213–225`).
- EH-01 is present: only 24 crucial decision controls receive separate info
  buttons; routine/repeated controls retain native titles without wrappers
  (`design-help.mjs:131–153,218–223`). B.9's existing sentence about adjacent
  information buttons is true for pose mode and optimizer choices. An optional
  clarification is “Information buttons beside crucial choices explain these
  policies; routine controls retain unobtrusive descriptions.” Do not restore an
  “every option has an i button” claim.
- The normal pose-application guard rejects infeasible candidates, but the API
  exposes an explicit, recorded `allowInfeasible:true` override
  (`chemist-actions.mjs:201–210`; `app.js:11250–11282`). The narrative skill's
  stricter acceptance policy may forbid using it, but is not proof the API lacks
  it. Optional clarification: “The normal interface and default API path reject
  infeasible poses; an explicit API override is recorded and is outside this
  acceptance contract.”

No application fix, manuscript edit, deployed UI change, numerical rerun, or new
physical-validation claim results from this audit note.
