# SOS1 live replay: contact declaration and aromatic depiction

Reported by the author after publication of submitted v1, against public
commit `f14950541711d2fd586ad43430530867b6a66418`. This is a software correction
record, not an amendment to the submitted manuscript or frozen scientific run.

## SR-01 — recomputation stops on an automatically captured contact

Observed UI: `47 / 202`, with `That H-bond hypothesis already exists as AWW
A1104 N7 → ASN A879 OD1`. The live contact list already contained that required
interaction alongside two water contacts. Inspection of the unmodified source
script and its interface expansion identifies move 47 as the N7–Asn879
declaration; OX3–Tyr884 is move 48.

Cause: automatic contact capture depends on the newly computed geometry. A
contact absent at the original frozen capture can be present on recomputation.
The explicit declaration then collided with an automatically captured
observation. This is not evidence that N7 and OX3 selectors resolved to the same
atom, and it must not be handled by skipping the action or relaxing a numerical
acceptance gate.

Fix: [manual-hbond.mjs](../docking/manual-hbond.mjs) plans promotion only when
the **exact donor, hydrogen, acceptor and receptor role** match one automatic
`reference-hbond-N` definition with no manual origin. [app.js](../app.js)
replaces that observation with the requested required `manual-hbond-N`
declaration, removes the superseded active selection/remap, and retains the
original and effective captured definitions plus superseded ID in provenance.
Only one physical restraint remains. Explicit declarations still reject
duplicates; ambiguous multiple matches fail closed. Manual numbering remains
deterministic, including the subsequent `manual-hbond-2` branch-alignment target.
Other contacts, graphs and coordinates are not modified by promotion.

This changes the documented [pose.addContact contract](../CHEMIST-ACTIONS-API.md):
callers must use its returned contact ID. It is deliberate explicit declaration,
not silent inference that an automatically detected interaction was intended.

Tests: [pure promotion tests](../docking/manual-hbond.test.mjs) cover new,
captured, explicit-duplicate, ambiguous, different-participant and remapped
cases. The `manual-hbond-api` scenario in [browser-test.js](../browser-test.js)
captures a real fixture, omits its requirement, explicitly redeclares it, and
checks one required contact, preserved provenance, unchanged atoms/coordinates,
and rejection of a second explicit declaration (59/59 checks passed locally).

## SR-02 — stopped story displays the next action's caption

The error correctly reported move 47, but the headline described move 48.
The stopped replay cursor had advanced to the following action. The failure
headline now resolves the actual failed step index at the failure frontier;
reviewing earlier completed states retains their own captions.

The [completed-review browser regression](../design-history/examples/designer-completed-review.browser.test.mjs)
now includes a three-action story whose second action fails, and requires the
second action's caption and move number, never the unexecuted third caption.

## SR-03 — unusual aromatic bonds remained in the deployed replay

The [a22 finding](../paper/review/ALIGNED-DEPICTION-REVIEW-2026-09-07.md) had been
fixed in a local figure-preparation build, not the deployed shared viewer.
Heavy-only depiction input lost AWT pyrazole N–H information; the bundled RDKit
could then fall back to unsanitized aromatic bond rendering.

The app now supplies attached explicit hydrogens without changing heavy-atom
order. [rdkit-worker.js](../rdkit-worker.js) strictly sanitizes that full graph
before removing H in the drawing copy and strictly reparsing it. It reports
the actual sanitization outcome and canonical SMILES. SVG bond-to-atom mapping
comes from the resulting drawing graph, not pre-removal bond ordinals. Both
recomputable and calculation-free checkpoint replays use this same path.
No forced aromatic repair, graph replacement or coordinate change is made.
The previously confirmed PDB-derived AWW graph remains as recorded.

[Seven-checkpoint regression](../rdkit-depiction-hydrogens.test.mjs): real
bundled RDKit WASM and worker, byte-checked frozen inputs, exact canonical
identity agreement with the a22 audit, heavy-atom/bond editing map agreement,
unchanged inputs, and ordinary AWT Kekule rendering with `[nH]` preserved.
All seven pass without the drawing-only fallback. The general 2D browser
editing suite also passes (19/19), including the LSD indolic N–H label hit.

During testing, naively retaining every old H broke staged C–C bond edits:
their old H count intentionally remains until Finish. The drawing now infers H
only at pending edited sites, preserving explicit H at unaffected atoms. This
is a preview-copy operation; Finish still owns graph/H reconciliation.

## SR-04 — candidate comparison overplays audit bookkeeping

The author found the repeated Phe890 trials cumbersome and required that the
demo show exactly the interface a person would use by hand, not an illustrative
substitute. The replay retains all 13 energy trials, applications, undo actions,
candidate-list regeneration, coordinate inspections, and review checkpoints.
Only presentation changes: a common candidate-number heading, shorter pauses
around repeated real controls/results, and no staged click or delay for
`session.inspect` (a read-only API audit snapshot, not a manual button).
Native calculation dialogs, their text and lifetime, the real candidate panel,
and the selected-rotamer presentation are unchanged. There is no new progress
modal, simulated calculation, skipped scientific action, or changed selection
policy. The raw step counter and checkpoint slider remain fully granular.

Implementation: [comparison presentation](../design-history/interface-story.mjs)
and [live presenter](../app.js). Tests in
[interface-story.test.mjs](../design-history/interface-story.test.mjs) require
13 trial groups, unmodified requests/guards/bindings, ordinary presentation for
the selected rotamer and precomputed review, and no compaction of relaxation.
The [browser regression](../design-history/examples/designer-completed-review.browser.test.mjs)
checks the candidate heading, the native Apply rotamer button cue, absence of
an invented audit-snapshot click, and the distinct selected-result caption.
These tests, renderer/caption invariants, frozen-publication preflight, and
production build passed locally. This is presentation validation, not a claim
that a new complete scientific rerun has finished.

## SR-05 — manual input can contaminate an active replay

Reported screenshot: move 59/202 fails the unchanged expectation
`molecule.atoms: expected 7935, received 7940`. The Components panel shows
an additional five-atom **Built molecule**, separate from the 7,844-atom
protein, 33 water atoms and 58-atom AWW ligand. This is evidence of an extra
component, not evidence that rotamer enumeration should allow a larger system.

Code inspection found that the Design canvas still scheduled Add/Move
operations while replay was running or paused. In ordinary Add mode, a click
on empty space adds a carbon and four hydrogens, exactly the reported excess.
This mechanism is reproduced by the browser regression; the precise input
event in the author's run is not confirmed without its exported action log.
Do not infer user intent from the screenshot alone. The ligand-pose lock does
not protect the earlier part of a replay before that lock is installed.

Fix: [manual-input policy](../design-history/designer-replay-review.mjs) guards
the shared manual Chemist Actions dispatcher during scheduled/running replay,
including pauses. Canvas input uses camera gestures instead of Add/Move, and
its hint explains this. Molecular mutations, manual undo, selection changes
and additional calculations through that dispatcher are rejected before
execution. Camera/display controls and replay transport remain available.
The replay's own API requests are not blocked or changed; this is UI input
protection, not an authentication boundary for external API callers.

The [browser regression](../design-history/examples/designer-completed-review.browser.test.mjs)
clicks the canvas during paused playback, attempts manual Clear, checks no
atom addition and unchanged atom count, then resumes to completion. It also
checks that normal Add mode remains available afterward and adds exactly five
atoms. [Policy tests](../design-history/designer-replay-review.test.mjs) cover
scheduled and running playback, inspection/transport exceptions and normal
manual editing. No count guard is relaxed; no atom is silently deleted from
the author's stopped run. The submitted paper and frozen scientific artifacts
remain unchanged.

## SR-06 — public Validation scope narrowed to numerical implementations

The author requested that the public Validation panel not yet present docking
pose accuracy. Previously its headline combined crystal-pose RMSD, docking
case/target counts, chemistry feasibility, and numerical parity. The link
existed in the initial August 19 release; the dashboard arrived August 24.

[dashboard.mjs](../validation/dashboard.mjs) now renders an explicit numerical
subset only: three matched-input energy/force comparisons, their one-system
fixture scope, and raw evidence links. It distinguishes same-interface
WASM/native parity from an independent native oracle, and links the broader
WebGPU/native OpenMM and STORMM reports with their precision/scope limitations.
Docking counts, RMSD headline, chemistry outcomes and the mixed-ledger download
are removed from the panel, not deleted from the repository. The versioned
registries, underlying artifacts and submitted manuscript are unchanged.

[Renderer tests](../validation/dashboard.test.mjs) enforce the allowlist,
units/values, no dependence on docking cases, safe evidence URLs and unchanged
registry input. [Browser checks](../validation/dashboard.browser.test.mjs)
verify the actual panel and that its three raw JSON links resolve. The existing
general browser suite assertions and README descriptions are updated too.

## Preservation and rerun commands

The submitted PDF/LaTeX/figures, all archived intermediates, the 159 scientific
actions, seven frozen checkpoints, and prerecorded MP4 are unchanged. The
scientific replay is not replaced by the precomputed replay. New recomputations
remain subject to the original scientific acceptance checks.

```sh
node docking/manual-hbond.test.mjs
npm run test:manual-hbond-browser
npm run test:depiction-hydrogens
npm run test:2d
npm run test:designer-replay-review-browser
npm run verify:sos1-publication
npm run test:paper-submission
```
