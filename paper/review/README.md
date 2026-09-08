# Manuscript review and recovered history

**Current paper:** [ChemRxiv-submitted v1, September 8](../submissions/chemrxiv-v1-2026-09-08/README.md).
The [September 8 history index](history-2026-09-08/README.md) continues this
original review through a01–a28 and the final manual Prism edits. “Current”
below and inside the review application means its frozen September 6 baseline,
not the submitted manuscript. Appendix C survives here as historical evidence;
it is not in submitted v1.

This is an author-controlled editorial workspace, not a replacement manuscript. **Every choice starts undecided.** No review action rewrites LaTeX, replaces a figure, compiles a PDF, or publishes a decision.

## Open and review

Open [index.html](index.html) locally, or serve the repository root:

```sh
python3 -m http.server 8874 --bind 127.0.0.1
```

Then visit `http://127.0.0.1:8874/paper/review/`. The page uses no external libraries or remote services. Browser storage is origin-specific: switching between a file URL, localhost, and a published host does not transfer decisions. Export regularly; browser storage is not a durable backup.

Suggested review order:

1. **All edits:** keep the current text, restore the earlier text, write custom wording, or leave each of the 40 source-change blocks undecided. Context, exact LaTeX, and related Appendix C alternatives are available without leaving the change.
2. **Figures 1 & 2:** compare the supplied PDF's images with the repository alternatives. The newer repository caption is not automatically authoritative. Figure choices and notes remain separate from text decisions.
3. **Optional suggestions:** 10 mechanical corrections and four optional flow/clarity changes, each independently selectable. These are proposals from this review, not historical edits attributed to Woody.
4. **Scientific checks:** 15 evidence-linked findings, with propose/keep/discuss/pending choices. Choosing a numerical update does not silently update dependent captions or experiments.
5. **Compare any version:** compare any two of the 100 recovered/derived text views. A shortcut opens the earlier polished PDF beside the current PDF's text. Full PDF originals remain linked; extraction differences are not necessarily writing changes. Record notes for other version pairs without implying a proven editing sequence.
6. **Export decisions:** retain the JSON and return it for deliberate integration. Nothing is applied automatically. Custom plain text and overlapping choices require reconciliation before LaTeX compilation and visual verification.

Imports and browser persistence are bound to the complete dataset fingerprint, the current source, and the comparison baseline. Each source-change decision also carries its exact before/after preconditions. An export from a different review cannot silently approve newly changed suggestions or figures. Keep older exports if the evidence set expands; they require deliberate migration, not automatic import.

## What “all edits” means

The default comparison contains **every source-line difference in one explicitly identified pair**: the actual recovered September 2 complete source versus the current manuscript with only editorial Appendix C omitted. It has 26 main-text, seven appendix, and seven preamble changes. The bibliography is unchanged in this pair. Independent tests reconstruct both complete inputs in opposite directions, requiring every unlisted region to be identical.

This does **not** prove that the earlier file is exactly what Woody received or that he personally authored every difference. Other versions are available for full comparison, and all 228 Appendix C record IDs are indexed, including its 38 groups with multiple recovered versions. The remaining 190 records are not evidence that those passages were never edited.

| Source | SHA-256 / interpretation |
| --- | --- |
| Exact current `main (2).tex` | `3de523cc745279a9962cae7d1afb90ccb8867f8d4d086e449e5f146f84fc24ff`; Appendix C retained verbatim. |
| Current source before Appendix C | `61e57f2d6944b25becb1c033e97c098d1848fa35d90027485f838c8baca6cc8f`; derived view exactly matches Prism's recorded hash. |
| Actual local September 2 source | `d098f3738d0e07df1b915761abc5f6576a7df91ad4d4455269ec12b7c184e2a9`; default baseline, not the unmatched Source B below. |
| Appendix C's claimed Source B | `bb47e79e91b413c1b81ceb1047de0ba7aff0ca03e4987d9e853c75654ec486f6`; exact bytes not recovered. The same-named local ZIP member is a different snapshot, not proof that Prism's claim was wrong. |

Sources C–E in Appendix C survive as excerpts, not complete recovered drafts. “CURRENT” inside that frozen archive refers to its original baseline. Filesystem dates, ZIP timestamps, Git identities, and similarity are evidence, not a complete chronology or individual authorship attribution.

## Evidence and preservation

The [manifest](history-2026-09-06/manifest.json) records content hashes and source aliases. Exact originals are deduplicated by hash. The inventory includes Git source/figure snapshots, local paper drafts, separately downloaded current files, and historical PDFs. PDF counts include standalone figures and appendices, not just full papers.

The earlier [human-provided lineage account](history-2026-09-06/artifacts/a8ded8360dbd054c9b13c0d8008e40b7aa5ded398bceb1371b712bfb3e1d7f8c.md) and its [manifest](history-2026-09-06/artifacts/81b2cf22f178e3235805e967bc2ad328cef5978f53ca0b59f81a8da0c4f10fa7.json) are preserved as historical evidence, not silently updated. They distinguish generated drafts, supplied critique, author selection, and subsequent human-led revision. Their old publication status describes that earlier point in time.

Raw collaborator DOCX files and comment text are **not** in this bundle; only their hashes and structural counts are recorded. Review decision exports, including QA downloads, are excluded from recovery. No private conversations are reconstructed or published. Historical scientific failures and discarded wording remain historical evidence, not restored recommendations.

Read the [minimal writing review](WRITING-REVIEW-2026-09-06.md), [technical findings](TECHNICAL-REVIEW-2026-09-06.md), and [independent QA](QA.md). Source/code evidence in the technical audit is pinned to its stated repository base; it is not a claim to track all subsequent deployment changes.

## Rebuild and verify

From a checkout containing this frozen archive:

```sh
python3 paper/review/build-review.py
node --test paper/review/review.test.mjs
```

The builder derives the complete source diff, Appendix C alternatives, PDF-text views, suggestions, technical findings, and hashed figure choices, then regenerates the self-contained HTML and JSON. It does not edit the manuscript. The two `current-pdf-*.png` images are embedded-image extractions from the archived current PDF; the selected repository images are copied into content-addressed review assets.

`recover-history.py --help` describes optional fresh recovery. Use a **new, nonexistent output directory** and put `--private-output` outside the repository and outside the public output tree. Originals are read-only. Pass separately downloaded bibliography/README/figure basenames through repeated `--additional-download` arguments. New Downloads or reachable Git objects can change the inventory; a fresh recovery is a new evidence set, not a byte-for-byte reconstruction of this frozen one. Preserve the prior archive and exports. Do not run recovery into an existing frozen archive or commit private extraction outputs.

The review is intentionally not a manuscript merge engine. Author decisions come first; integration, dependent factual updates, compilation, figure/caption checking, and final publication are separate steps.
