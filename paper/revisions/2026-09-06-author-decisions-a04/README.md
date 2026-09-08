# Molarium — Prism source handoff, September 6, 2026

Open `main.tex` as the root document. Keep the six PNGs in `figures/`. The bibliography and all three appendices are embedded in the source; no separate bibliography file is required. Standard pdfLaTeX packages include `newunicodechar`; the delivered PDF was compiled locally with Tectonic 0.17.0.

This package applies the author's exported source choices and explicit wording notes to the downloaded current manuscript. The author selected the earlier versions of D026, D034, and D038 and set the date to September 6. The integration manifest records every applied replacement, exact source/output hashes, and figure identities. No raw author decision export or browser history is included.

Figures 1 and 2 and the other unselected scientific/style proposals remain unchanged. D017/D018 were not decided; D035/D037 remained pending, with only their explicit notes applied. In particular, the old live-campaign-availability claim still needs the separate technical decision; this handoff must not be treated as approval of every scientific claim. Mechanical suggestions not requested in the notes were not silently accepted.

The audit-cap wording was removed from the live text and the additional B.10 table. The corresponding local application fix has regression coverage but was not deployed at handoff. The live narrative mentions SOS1 alone, without adding BCL-xL/CDK2 validations. Appendix C and the bibliography remain byte-for-byte historical source: obsolete numbers, wording, and source labels inside that editorial archive have deliberately not been rewritten.

Two typesetting accommodations make Unicode apostrophes visible with the local engine and permit long schema names to wrap. These do not change the scientific wording or historical quotations. Compilation has no missing-glyph, undefined-reference, or overfull-box diagnostics; ordinary underfull table-cell warnings remain.
