# Preprint source

The manuscript starts as a standard `article` rather than a publisher template.
That keeps drafting pleasant, diffs readable, and later journal restyling
contained to the preamble.

## Build

Install TeX Live 2025 (full) or a smaller distribution containing the packages
used in `main.tex`, plus `latexmk` and BibTeX. Then run:

```sh
make -C paper
```

The PDF is written to `paper/build/main.pdf`. For continuous compilation while
editing:

```sh
make -C paper watch
```

The checked-in Figure 2 and measurement macros reproduce the frozen
reference-informed designer-intent results. The finished PDF is included in
`design-history/publications/sos1/designer-intent-2026-09-04/` and linked from
[the movie page](https://molarium.org/sos1). Ordinary compilation requires no
new scientific run. `npm run verify:sos1-publication` checks the released evidence.

To regenerate Figure 2 from the original, complete native checkpoint render
(including its hash-pinned QA images), use explicit run and render paths:

```sh
python3 paper/scripts/build-sos1-intent-figure.py \
  --run outputs/design-history/sos1-aww-receptor-only-intent-v5-a021 \
  --render-dir outputs/design-history/sos1-hit-to-bay293-intent-interface-m003 \
  --output paper/figures/fig2_sos1_designer_intent.png
```

For Overleaf or submission, `node paper/scripts/build-self-contained-source.mjs`
creates `paper/build/Molarium_paper_source/` with one editable LaTeX source and
all six figures. It inlines the verified measurement macros and Appendix B;
the manuscript bibliography is already embedded. Upload that source directory,
not compilation intermediates. The ordinary multi-file source is also usable
with its `generated/` and `figures/` directories included.

## Authoring conventions

- Keep one sentence per source line when practical; this makes review diffs much
  easier to read.
- Put bibliography metadata in `references.bib` and cite stable DOIs or primary
  sources.
- Put plots and diagrams in `figures/`, preferably as vector PDFs. Generate them
  from versioned data and scripts rather than editing them by hand.
- Use semantic labels such as `sec:evaluation`, `fig:architecture`, and
  `tab:benchmarks`.
- Keep draft claims explicit. A highlighted `\draftnote{...}` is better than an
  unsupported number that looks final. Set `\drafttrue` near the top of
  `main.tex` to show these notes; clean builds hide them.
- Stay on the generic preprint style until a target venue is chosen.

## Development provenance

The implementation conversation is part of the evidence for this paper. See
[`development-log/README.md`](development-log/README.md) for the private raw
rollout, redacted transcript, and curated debugging-episode workflow. Never add
a raw Codex rollout or an unreviewed transcript export to Git.

## arXiv handoff

This source targets pdfLaTeX and uses the widely portable BibTeX workflow. Upload `main.tex`,
`references.bib`, and every used figure from the root of the submission archive;
do not include the local `build/` directory. Use a fixed manuscript date rather
than `\today`, because arXiv may rebuild the PDF later.
