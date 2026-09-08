# Molarium — ChemRxiv-submitted v1

Rafal Wiewiora and Woody Sherman, September 8, 2026.

The author designated [Molarium.pdf](Molarium.pdf) as the submitted v1 and then
supplied the [final Prism main.tex](main.tex). Both are preserved byte-for-byte:
no manuscript edits, figure substitutions, or PDF recompilation were applied.
This records submission, not acceptance or a verified public ChemRxiv posting.
A ChemRxiv DOI/landing-page URL has not yet been supplied.

| Artifact | SHA-256 |
| --- | --- |
| Submitted PDF (40 pages, 5,961,246 bytes) | `caa49f6fa273387ce52d0f51e15bbfc6ad23518e25350e49b004cb1259740cad` |
| Final Prism LaTeX (158,252 bytes) | `6964b04e39738a985e521bd8dc05bd0fff4bfad1abe715be47593b2382f80804` |

[submission.json](submission.json) records the source and six figure hashes.
[figure-verification.json](figure-verification.json) records exact decoded RGB
pixel equality between every source PNG and its image in the submitted PDF.
The file names retain their authoring history; the final figure order is:

1. Interface (`fig1_molarium_interface.png`), including the original Connected features banner.
2. Architecture (`fig2_architecture.png`).
3. SOS1 whole-interface sequence (`fig2_sos1_designer_intent.png`).
4. Scientist–agent build loop (`fig3_build_loop_compact.png`).
5. Evidence ladder (`fig4_evidence_ladder_fixed.png`).
6. Value layers (`fig5_value_layers_fixed.png`).

## Source and reproducibility boundary

Copy `main.tex` and `figures/` together into Prism or a LaTeX project. The source
uses standard article packages and an inline bibliography; the submitted PDF
identifies pdfTeX 1.40.28. For a local TeX installation, run
`latexmk -pdf main.tex` in a scratch copy. Compiler/package versions can affect
pagination. We do not claim byte-identical local compiler reproduction. The
archived `Molarium.pdf`, not a local rebuild, remains the submitted artifact.

[The exact diff from a28](changes-from-a28.diff) includes the final manual Prism
edits, figure ordering/placement, and use of the PNG build-loop figure. It is a
comparison of recovered artifacts, not an attribution of each edit to a person.
The [history index](../../review/history-2026-09-08/README.md) preserves earlier
drafts, review findings, and rejected alternatives without making them current.

No frozen SOS1 calculation, checkpoint, replay, MP4, molecular graph, or release
fingerprint was changed. The older paper inside the frozen September 4 science
release remains untouched; [molarium.org/sos1](https://molarium.org/sos1) points
readers to this submitted manuscript.

Verify archive integrity with `node scripts/verify-paper-submission.mjs` from
the repository root. Independently repeat the image comparison with
`uv run --with pillow python paper/scripts/verify-submitted-v1-figures.py`
(Poppler `pdfimages` required). Verification reads the PDF without rewriting it.
