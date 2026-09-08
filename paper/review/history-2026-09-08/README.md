# Manuscript history through submitted v1

Start with the [submitted PDF, final Prism source, and matching figures](../../submissions/chemrxiv-v1-2026-09-08/README.md).
This directory continues the [September 6 recovery](../history-2026-09-06/manifest.json),
whose original Git commit `baf18d4` is retained in ancestry. Earlier record IDs,
source aliases, and exact artifact bytes have not been rewritten.

## What is preserved

The [manifest](manifest.json) inventories 564 additional original artifacts:
28 intermediate revision directories, review findings, exact-edit manifests,
source diffs, historical PDFs, figure builders, and screenshot/capture evidence,
plus the final submitted PDF/source and its six figures. Identical content is
deduplicated by Git. The archive is not a claim to recover every private Prism
edit or every historical chat; unrecovered states remain unrecovered.

| Revisions in [paper/revisions](../../revisions/) | Main work recorded |
| --- | --- |
| a01–a04 | Integration of individual author review decisions. |
| a05–a11 | Current SOS1/API account, Appendix C removal, approved wording, acknowledgments, AI appendix disclosure, parity scope. |
| a12–a18 | Executable-protocol presentation, readable JSON excerpts, appendix currency and listing refinements. |
| a19 | Whole-movie pseudocode and checkpoint-by-checkpoint human account. |
| a20–a21 | Figure clarity and restoration of actual whole-interface screenshots. |
| a22–a23 | Common 2D scaffold alignment, chemically meaningful highlighting, and source-graph clarification. |
| a24 | Evidence-ladder arrow/label placement. |
| a25 | Readable annotated protocol tied to the SOS1 figure, explicit state/provenance relationship. |
| a26–a27 | Figure font matching and value-diagram cleanup. |
| a28 | Appendices reconciled against the deployed code/API; findings, boundaries, and exact replacement records. |
| [main-10](downloads/main-10.pdf), [main-11](downloads/main-11.pdf), [main-12](downloads/main-12.pdf) | Later downloaded Prism PDFs, preserved as intermediates, not submitted v1. |
| [Submitted v1](../../submissions/chemrxiv-v1-2026-09-08/README.md) | Author-supplied PDF and subsequent final Prism source; [complete source diff from a28](../../submissions/chemrxiv-v1-2026-09-08/changes-from-a28.diff). |

Revision READMEs intentionally retain their original statements, including
outdated “current” labels and carried-forward caveats. Consult their exact edit
manifests and the final submission record, not an old README in isolation.
The final PDF is not replaced by a recompilation of an earlier source.

## Review findings and linked corrections

- [Initial technical review](../TECHNICAL-REVIEW-2026-09-06.md) and [writing review](../WRITING-REVIEW-2026-09-06.md): author-selectable findings, not silently applied edits.
- [Aligned depictions](../ALIGNED-DEPICTION-REVIEW-2026-09-07.md) and [chemical-difference highlighting](../CHEMICAL-DIFFERENCE-REVIEW-2026-09-07.md): a22/a23 evidence and tests distinguish equivalent Kekule drawings from chemical changes.
- [AWW source-graph discussion](../SOS1-AWW-SOURCE-GRAPH-DISCREPANCY-2026-09-07.md): the author confirmed the PDB-derived discrepancy and chose to preserve the frozen graph. The unsupported “restore aromaticity” explanation was removed, not the underlying evidence. This records how discussion exposed a reproducibility boundary.
- [Readable protocol](../READABLE-PROTOCOL-REVIEW-2026-09-08.md): shorthand is a human/agent-readable explanation of the recorded operations, not an independently executable replacement for the full action JSON.
- [Appendix A](../DEPLOYED-AUDIT-APPENDIX-A-2026-09-08.md), [Appendix B](../DEPLOYED-AUDIT-APPENDIX-B-2026-09-08.md), and [SOS1 deployment audit](../DEPLOYED-AUDIT-SOS1-2026-09-08.md): a28 corrections are pinned to public commit `6d2f620d7d26e3dfd270c018f0a9be7a414f2163`, not a guarantee about future code.
- [Figure 1 badge attempt](../FIGURE1-LOCAL-LAB-BADGE-2026-09-08.md) and [nonselected image](not-selected/fig1_molarium_interface_local_lab.png): cosmetic alternative explicitly rejected for submission; v1 retains the original banner.

## Application and privacy boundaries

[local-figure-preparation-and-audit-draft.patch](local-figure-preparation-and-audit-draft.patch)
preserves the unmerged application draft relative to `baf18d4`, including local
figure-display preparation. Its two [draft tests](application-draft-tests/) are
archival evidence, not runnable production regression claims from that location.
This publication does **not** apply that patch, deploy its UI/scientific changes,
or rerun molecular calculations. Actual frozen SOS1 science/replays are unchanged.

Raw collaborator DOCX/comments, decision exports, credentials, unrelated
Downloads, and private session transcripts are excluded. Historical artifact
paths and manuscript author contact details remain in original bytes. Original
file timestamps, named aliases, and textual similarities do not by themselves
prove individual authorship or a complete edit chronology.

To check all 564 original artifact hashes, run
`node scripts/verify-paper-submission.mjs` from the repository root. The original
September 6 archive has its own manifest. Generated verification/index files
are maintained in Git separately from the original-artifact manifest.
