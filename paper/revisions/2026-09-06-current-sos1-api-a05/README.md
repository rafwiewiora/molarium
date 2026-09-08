# Molarium — author-reviewed manuscript, current SOS1 and API reconciliation

Import this directory into Prism and compile `main.tex` with XeLaTeX. The six figures are included; no external bibliography file is required. Tectonic successfully compiled the supplied source to 71 pages.

This revision starts from the author's exported editorial decisions (a04), then applies the requested current-state corrections. Figure 2 is the six-panel designer-intent SOS1 figure. The main text and Appendix A explain the recomputable replay, exact precomputed checkpoints, and checkpoint-review MP4. Appendices A and B are reconciled against public code commit `2ab30383d6160349aa3b1e980f7239d6854b329d` and the separately identified local audit-history fix.

`reconciliation-manifest.json` records every before/after replacement and figure hash. Appendix C and the bibliography remain verbatim historical records, not current API documentation. Other author-selected prose is preserved; unselected stylistic suggestions have not been silently applied. No additional medicinal-chemistry case studies were added.

Validation: 52 API example envelopes spanning 35 action names match current action names and argument keys. This is a contract check, not execution of every example or a new scientific validation campaign. The SOS1 publication preflight confirms 159 actions, seven exact checkpoints, and the 62.75-second movie with five one-second recorded-status popups. Movie timing is not calculation performance.

Deployment caveat: the default unbounded in-memory action history is a tested local code fix, not yet represented by the public commit above. The paper's corresponding history statements describe that intended release. Do not treat this source bundle as evidence that the fix has already deployed.
