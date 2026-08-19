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

The same directory can be uploaded to Overleaf. Generated files in `build/`
should not be uploaded.

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

## arXiv handoff

This source targets pdfLaTeX and uses the widely portable BibTeX workflow. Upload `main.tex`,
`references.bib`, and every used figure from the root of the submission archive;
do not include the local `build/` directory. Use a fixed manuscript date rather
than `\today`, because arXiv may rebuild the PDF later.
