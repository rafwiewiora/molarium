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
