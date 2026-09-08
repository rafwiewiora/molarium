# Molarium — author-approved revision

Import this directory into Prism and compile main.tex with XeLaTeX. All six figures and the inline bibliography are included.

The edit manifest records the exact changes in this revision, its preserved base revision and source hashes. All earlier approved changes remain in place, including removal of Appendix C. Earlier sources and editorial history remain archived separately.

Release caveat carried forward: removal of the default 500-action audit-history limit is tested locally but was not yet deployed at public code commit 2ab30383d6160349aa3b1e980f7239d6854b329d.

This revision replaces the four-action JSON excerpt with one whole-movie pseudocode listing and replaces the dense results subsection with a checkpoint-by-checkpoint human account. The full 159-action executable JSON and seven-checkpoint review JSON are bundled. The pseudocode is not executable; its evidence map identifies the condensed source ranges and distinguishes replay from publication verification. Figure assets and all text outside the two edit-manifest replacements are unchanged. No molecular calculations were rerun.

## Figure-clarity follow-up

This revision updates Figure 2 to show all five ligand graphs, marks lineage-defined rewritten regions, and separates three frozen-coordinate geometric operations. Its graph depictions and stereo come from the saved states; no molecular calculation or interpolation was performed. Figure 4 (the scientist-agent loop) is reconstructed as a vector diagram with the same text and stage order and a single clean feedback arrowhead; the PDF is used for typesetting and a PNG is supplied for convenience. Four other figure assets remain byte-identical. The new figure provenance files record input hashes and generation details. The appendix AI-authorship disclosure now also appears at Appendix A, with a reminder at Appendix B, and the pseudocode comment/instruction convention is explicit. Earlier revisions are preserved.

## Whole-interface Figure 2 restoration (a21)

Figure 2 again consists of six genuine whole-tool screenshots. The app now offers an enlarged, sidebar-docked 2D panel and persistent-ID highlights in that panel. All five chemical graphs are shown, plus the AWW receptor-only response. The actual display-only replay and capture plan are registered separately as sos1-chemical-edits; no frozen scientific source was changed. All text except the Figure 2 caption and one inherited typo (Thia to This), and every other figure, remains byte-identical to a20. This preserves its appendix AI-authorship disclosure, pseudocode notation convention, and clean vector Figure 4. Source screenshots and their checks are retained in the repository capture archive.

## Shared-scaffold Figure 2 alignment (a22)

The six panels remain genuine, unaltered full-tool screenshots. Native RDKit
2D coordinates now align the eight shared scaffold atoms across all ligands.
Step B retains its correct AWT graph; the depiction path now preserves explicit
hydrogens through sanitization before removing them for drawing, preventing the
pyrazole N-H information from being lost. The molecular graph, stereochemistry,
saved 3D coordinates, and scientific checkpoint files are unchanged.

main.tex is byte-identical to a21, including its Figure 2 caption, appendix
disclosures, and pseudocode. Every other figure is unchanged. The original
a21 revision and screenshots remain available. See the public repository's
paper/review/ALIGNED-DEPICTION-REVIEW-2026-09-07.md for the findings, checks,
and exact capture/rebuild commands.

## Chemical-difference Figure 2 correction (a23)

The six panels remain native whole-tool screenshots with their shared 2D
scaffold alignment. Orange highlights now describe added atoms and local
chemical differences, not differences in persistent atom identifiers alone.
Equivalent aromatic Kekule representations do not count as chemical edits.
The depicted structures remain those of the frozen PDB-derived run. They are
not silently substituted with the source paper's aromatic AWW structure.

Two sentences in the Figure 2 caption change: the highlight description is
corrected, and the unsupported claim of a designer-driven restoration of the
aromatic core is removed from step F. All other manuscript text and figures remain
byte-identical to a22. The prior revisions and their captures remain archived.
The edit manifest records both exact replacements and both source hashes.
No frozen graph, scientific checkpoint, stereochemistry, or saved 3D coordinate
is changed. See paper/review/CHEMICAL-DIFFERENCE-REVIEW-2026-09-07.md in the
repository for the mapping evidence, limitations, and reproduction checks.

The source-graph discrepancy and the author's explicit decision to retain the
existing model without recomputation are documented in the public repository:
https://github.com/rafwiewiora/molarium/blob/main/reviews/SOS1-AWW-SOURCE-GRAPH-DISCREPANCY-2026-09-07.md. This provenance
discussion is not a new manuscript appendix or a claim that the deposited
chemical dictionary and the published medicinal-chemistry drawing agree.

## Evidence-ladder arrow correction (a24)

Only the evidence-ladder figure image (figures/fig4_evidence_ladder_fixed.png)
has been replaced to correct its arrow. The supplied raster was edited with
image_gen to place the grey label on the arrow axis and clear the shaft from
the text. The wording and box layout were visually checked; the raster was
resampled, so pixel-identical preservation elsewhere is not claimed.
main.tex is byte-identical to a23,
and every other figure and supporting source file is unchanged. The edit
manifest records the exact source image and old/new image hashes. All earlier
revisions remain archived. No scientific input or result has changed.

## Readable protocol and molecular-state trace (a25)

The SOS1 listing uses colored, lettered headings linked to Figure 2,
change/fixed-state descriptions, and selected readouts. A native-LaTeX trace
shows the same AWW graph through ligand placement and receptor response.
Its provenance annotation distinguishes parent-linked snapshots, explicitly
partial public-action segments, and separate numerical audits. The main text
frames the contribution as readable design intent linked to operations and
evidence, not scripting alone or guaranteed scientific correctness.
All operational pseudocode, figure bytes and executable scripts are unchanged.
Exact text replacements are retained in edit-manifest.json and the diff.
No previous revision is overwritten and no science is rerun.

## Figure 4 font matching (a26)

The build-loop Figure 4 uses native vector geometry and Latin Modern text to
match the manuscript typography. The PDF, PNG backup, and figure provenance
are replaced together. Extracted figure wording is unchanged. main.tex is
byte-identical to a25, and all other source files and figures are preserved.
The edit manifest records both old and new hashes. No scientific operation,
input, result, or previous revision is changed.

## Figure 6 cleanup (a27)

Only figures/fig5_value_layers_fixed.png (Figure 6's historical filename) is
replaced. The image edit repairs a white edge gap in the middle box and keeps
the word rationale unhyphenated in the upper box. The wording is retained;
only its wrapping and the border are intentionally corrected. This AI raster
edit also resampled the image and added outer whitespace; pixel-identical
preservation elsewhere is not claimed.

main.tex is byte-identical to a26. Every other source and figure is unchanged.
The edit manifest records the input image and old/new hashes. All previous
revisions are preserved, and no scientific input or result is changed.

## Deployed-release reconciliation (a28)

This revision corrects technical/operating descriptions against public commit
6d2f620d7d26e3dfd270c018f0a9be7a414f2163 and 80 live served-file checks.
Exact edits and evidence are recorded in edit-manifest.json and the a27 diff.
The independent Appendix A, Appendix B and SOS1 audit notes are included.
All figure images, executable SOS1 scripts, pseudocode operations, benchmark
numbers and frozen scientific results are unchanged. No application fix or
new scientific calculation is implied. The paper now acknowledges unreliable
queued prediction cancellation and the deployed bounded/partial action history.
Figure 2's local display-only enhancements are distinguished from the public UI.
The source runtime configuration differs from production by the documented
build transformation; each inspected live file matches the production manifest.
The code-audit metadata replaces the stale assertion of an unchanged public
commit. BAY checkpoint hash scope is explicitly decoded JSON, not gzip bytes.

Review categories: technical contradictions and terminology are corrected in
the exact-edit manifest; figure and listing references were checked against
their content. Author names, affiliations, acknowledgments and identifying
project/repository links remain intentionally present; this is not an anonymized
submission. No anonymization edits were made.
