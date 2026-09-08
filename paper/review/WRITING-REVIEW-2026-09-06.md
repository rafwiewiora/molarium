# Minimal writing review — 6 September 2026

Status: suggestions for author selection; no manuscript text changed. The reviewed current source is the exact `main (2).tex` identified in [README](README.md), not a newly assembled preferred draft. Individual edits are not attributed to Woody solely from file differences.

## Overall assessment

The loss of flow is not simply a consequence of shortening. Some current passages expand lists of capabilities while removing the sentence that explains why those capabilities matter. The earlier polished draft often moves from a concrete implementation choice to its scientific consequence, then ends on the active question. A few of those transitions are worth offering back without reversing the broader revision.

The review therefore separates ten spelling/grammar proposals from four optional changes in emphasis. It does not impose a new voice, convert every passive construction, remove all repetition, or shorten the paper indiscriminately. Exact alternatives, source lines, and reasons are in [suggestions.json](suggestions.json) and the HTML's Optional suggestions tab.

## Five-pass review

| Pass | Finding and minimal response |
| --- | --- |
| Clutter | No global pruning proposed. “Advanced architectural capabilities” is less specific than the earlier browser-to-state contrast; MR-S11 offers that bridge back. |
| Voice | Preserve the current authorial voice and deliberate qualifications. MR-S12 offers the earlier active-question ending as a preference, not a correction. No blanket active-voice conversion. |
| Sentence and paragraph structure | Figure 2 interrupts the interface/state discussion. MR-S13 names the antecedent on resumption; MR-S14 offers the earlier “paths not taken” phrase without rebuilding the paragraph. |
| Terminology | Preserve technical terms unless they denote the wrong implemented behavior. OpenFold naming and the three design/relaxation policies are factual review items MR-T05/MR-T08, not stylistic synonym substitutions. |
| Numbers and units | Do not cosmetically harmonize values from different experiments. Figure 2, RMSDs, action counts, and timings must follow an explicit scientific-artifact choice in MR-T01–T03 and MR-T11–T12. |

Mechanical proposals MR-S01–MR-S10 cover spelling, singular agreement, the article before “HPC,” one missing space, and one tense mismatch. Correcting “trivial” or “resources” does not endorse the neighboring implementation claim. Historical quotations in Appendix C are not targets for typo correction.

## Figures and reading flow

Figure 1 is an interface illustration. Its caption must describe the image actually shown; the repository's newer Local Lab/excluded-glycerol claims are not established by the current image. MR-T04 offers retaining image-consistent wording or making a newly verified capture. Neither is preselected.

Figure 2 is both an interruption in the prose and a scientific-version decision. The supplied PDF's four-panel historical result and the repository's six-panel designer-intent story are different artifacts. A more elegant caption cannot reconcile different experiments. Choose the story first, then update only its dependent introduction, caption, results, and appendix. The optional MR-S13 transition remains useful whichever coherent package is selected.

## Author workflow

Start with the 40 complete source differences, not just these suggestions. Use the earlier polished-PDF shortcut to assess the cadence of whole paragraphs. Keep any preferred current passage unchanged; use custom wording when neither version sounds right. Suggestions and technical corrections remain independent proposals until the exported choices are reconciled deliberately. No single final rewrite is supplied or implied by this review.
