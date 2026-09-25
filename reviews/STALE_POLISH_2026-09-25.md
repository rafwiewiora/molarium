# SR-13 — stale interactive polish after a graph edit

## Finding

PR #34's first [CI run](https://github.com/rafwiewiora/molarium/actions/runs/36168199397)
failed the existing exact coordinate-preservation assertion in
`scripts/calculation-readiness.browser.test.mjs`. The same failure reproduced
locally. Application and regression-test code were unchanged from main at the
time of the failure; the new link-preview metadata did not alter chemistry.

The fixture places a disconnected carbon component in a prepared protein,
then performs a staged attached-carbon edit before retyping. Disconnected atom
addition schedules delayed RDKit polishing with an atom-index mapping. A later
graph edit can retain the same molecule object while changing that mapping.
`invalidateEditedChemistry` invalidated numerical parameters but did not advance
the existing polish cancellation sequence. A queued or in-flight old-graph
polish could therefore apply stale coordinates during this later workflow.
This was not evidence that single-point energy evaluation should move atoms.

## Fix and evidence

`invalidateEditedChemistry` now advances `smallMoleculePolishSequence`. Existing
guards reject the old task both before dispatch and before applying its result.
Newly requested polish still uses a fresh sequence. No force-field, integrator,
minimization settings or scientific acceptance tolerances changed.

[Deterministic unit regressions](../scripts/stale-polish.test.mjs) execute the
actual application functions with controlled queued/in-flight worker completion:
old tasks cannot dispatch/apply after invalidation, while an unmodified-graph
control still applies and records its polish. The original browser regression
and its exact atom/bond comparison are retained unchanged, with no added sleep,
relaxed coordinate tolerance or disabled geometry check.

Scope: this fixes stale polish invalidation for the graph-mutation and Finish
paths that call `invalidateEditedChemistry`; it is not a complete concurrency
audit of every application operation. The fix accompanies the separately
documented [homepage preview update](LINK_PREVIEW_2026-09-25.md) because the
release gate exposed it before deployment. Frozen evidence remains untouched.
