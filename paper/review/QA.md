# Independent review-workspace QA — 2026-09-06

This is a technical audit of the recovery and review interface, not an editorial approval, attribution of individual edits, scientific endorsement, or authorization to compile or publish a revised manuscript. No manuscript source was edited by this QA task. Raw collaborator DOCX files and comments were not read into this document or included in the public artifact archive.

Run the read-only checks from the repository root:

```sh
node --test paper/review/review.test.mjs
```

The checks use Node's built-in test runner and Python 3 only to reproduce the documented JSON fingerprint serialization. They do not import or execute either writing builder. At final coordinator verification, **21 tests pass**. The final recovery contains 127 unique artifact identities, 458 source occurrences, 61 Git paper commits, 66 archived text sources, and 33 PDFs. PDF counts include six standalone figure PDFs; they are not counts of complete manuscript drafts. The three DOCX entries retain identities and structural counts only, leaving 124 included original files. Tests reconcile every manifest entry rather than silently ignoring additions beyond the initial 120-artifact recovery. A QA-only decision export caught by the broad initial filename scan was excluded from the final recovery; the earlier exploratory archive remains local and was not published.

## Source preservation and complete comparison

| Source | SHA-256 | What was verified |
| --- | --- | --- |
| Exact current `main (2).tex` | `3de523cc745279a9962cae7d1afb90ccb8867f8d4d086e449e5f146f84fc24ff` | Archived bytes and the available Downloads original match; Appendix C remains intact. |
| Recovered September 2 complete source | `d098f3738d0e07df1b915761abc5f6576a7df91ad4d4455269ec12b7c184e2a9` | Exact archived source and its directory/ZIP aliases agree. |
| Derived pre-Appendix-C view | `61e57f2d6944b25becb1c033e97c098d1848fa35d90027485f838c8baca6cc8f` | Removing only the editorial-archive insertion and restoring its recorded boundary reconstructs Prism's recorded pre-C hash. Scientific text before C and the complete bibliography suffix are preserved. |

The 40 default comparison hunks are **not selected from Appendix C's curated alternatives**. An independent checker verifies each hunk's exact before/after line ranges and requires every gap and tail between hunks to be byte-identical. Applying all hunks reconstructs the derived current source exactly; reversing them reconstructs the recovered baseline exactly. This proves complete coverage of this particular source pair, including insertions, deletions, preamble changes, and changes without Appendix C record IDs. Deliberately omitting a hunk or modifying its expected source text makes the checker fail.

All 228 Appendix C record IDs are present. All 38 changed-record groups retain every printed LaTeX alternative and its evidence statements; each `CURRENT` alternative matches its indexed current-source text. The other 190 records are indexed rather than dismissed as never edited. Exact full source remains accessible alongside the convenience reading view.

The named Source B identity in Appendix C, `bb47e79e91b413c1b81ceb1047de0ba7aff0ca03e4987d9e853c75654ec486f6`, remains absent from the recovered set. A same-named September 2 ZIP member has the distinct `d098f373…` identity. The review must not call them the same source, infer that Prism's hash is wrong, or claim that the recovered baseline is necessarily the exact manuscript sent to Woody. A separately recovered September 3 ZIP has another same-named source again; filenames alone are not identities.

## Decision safeguards and fixes found during QA

| Finding | Resolution / evidence |
| --- | --- |
| Import originally checked manuscript hashes but not the complete review dataset. Reusing a suggestion ID after changing its wording could restore a stale proposal. | Import and local persistence now bind to `DATA.dataId`, covering the entire review payload. Tests reject a missing or different dataset identity, changed manuscript identity, and altered exact hunk preconditions. |
| Main figure alternatives originally referenced mutable repository paths without their own decision fingerprint. | Both alternatives for Figures 1 and 2 now use content-addressed PNG paths included in the review dataset. Tests rehash all four image files. |
| The gallery initially made only PNG coverage apparent. | The figure view explicitly directs readers to the six vector/PDF figure artifacts in History & evidence; the complete PDF archive is verified separately. |
| PDF-only drafts were originally linked but absent from the comparison selectors. | All 33 complete PDF extractions are now selectable, bringing the total to 100 text views. Tests bind each extraction to its exact PDF, text digest, page count, and aliases. A polished/current PDF shortcut is available. |
| A broad Downloads scan included a QA decision export as manuscript history. | Fresh recovery explicitly excludes decision-export filenames; the final manifest contains neither QA nor author decision exports. A regression assertion protects this boundary. |
| Private extraction output could be placed inside the public tree on a future rerun. | Recovery now fails before output creation if the private path is inside the repository or overlaps the public output tree. |
| Checkbox sizing and rerendering impaired keyboard/layout continuity. | Checkbox heights are now 13 pixels in the verified browser; the coordinator confirmed focus remains on Leave undecided after its rerender. |
| A source comparison's bounded diff could otherwise be mistaken for a filtered comparison. | The actual rendering function is tested with ordinary cases, insertions, deletions, repeated lines, the complete manuscript pair, and a forced coarse fallback. Every input character survives in the appropriate side. A coarse block is less precise alignment, not omitted text. |

Matching imports preserve explicit `current`, `earlier`, `custom`, and `pending` choices. Fabricated IDs, unsupported actions, non-text custom content, and malformed history arrays are rejected. Validation itself does not modify existing decisions. Pending suggestions, figures, and technical findings do not become approved merely by being loaded or exported.

The generated HTML is also checked against the complete current `review-data.json` and the exact template. Embedded source text cannot introduce a new script tag through the JSON payload. These tests are separate from browser interaction; they do not pretend that an isolated validator test exercises the operating system's file chooser.

## Hands-on browser checks

The independent QA tab used the local review page at `http://127.0.0.1:8874/paper/review/`, with the normal 1512-pixel desktop viewport. Interactions used visible controls; DOM inspection was read-only. Browser storage was not read or modified directly.

- The fresh review showed 0 of 40 changes decided, with no approval buttons selected.
- **Keep current**, **Use earlier**, **Write my version**, and **Leave undecided** worked. Current/custom decisions survived a reload through the visible UI. A literal `<script>` string in custom wording remained text, not markup. The test choice was returned to pending.
- An optional suggestion's proposal survived reload and was returned to pending. The 15 scientific-finding cards started undecided; a discussion choice survived reload and was returned to pending.
- Both source selectors exposed all 67 then-available archived/derived text views. The rendered default full diff reconstructed both inputs exactly from its DOM text. Choosing the exact current source also exposed Appendix C and the bibliography. Preamble filtering exposed the seven preamble hunks, including a pure insertion and pure deletion.
- Appendix C exposed all 228 record choices, including the final one-version record; the first changed record showed both retained alternatives.
- All four principal comparison images loaded. Enter opened figure zoom, focus moved to its close button, Escape closed it, and focus returned to the originating image.
- The ordinary desktop review, figure, source-history, and scientific-check layouts had no horizontal page overflow. This is not a claim of comprehensive mobile or assistive-technology validation.
- **Export decisions** downloaded parseable JSON containing the source identities, complete dataset identity, exact hunk preconditions, pending choices, and the explicit no-manuscript-mutation policy. The download was QA-only, not an author decision or publication artifact. Import rejection and acceptance were exercised independently against the actual validator, not through the native file chooser.

## Scope limits that must remain visible

The lossless 40-hunk proof concerns the selected default pair, not an assertion that every artifact directly descended from another. Full recovered text-source comparison provides access to other pairs; it does not establish chronology or individual authorship. Filesystem dates, ZIP timestamps, Git commits, and similarity-based Appendix C correspondences are evidence with different meanings.

PDF extraction is a convenience view: full PDFs and full extracted-text digests are preserved, while paragraph records normalize layout and exclude headers/footers. The final coordinator browser check verified 100 selector choices and opened the earlier polished PDF text (12 pages, 45,920 characters) beside the current PDF text (70 pages, 263,042 characters). Both original-PDF links and extraction provenance were visible. All four main figure images loaded; desktop overflow was absent. The final review remained 0 of 40 source changes decided. Extraction comparisons cannot establish exact original LaTeX, recover image pixels, or prove source lineage.

Unseen Prism versions, unavailable Source B bytes, unrecovered private conversations, and individual sentence authorship remain unknown. No test or UI choice should turn those gaps into an invented history. All proposed wording, figure changes, and scientific corrections still require the author's deliberate decisions and subsequent reconciliation; this workspace does not automatically rewrite, compile, approve, merge, or publish a final paper.
