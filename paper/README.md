# Molecular design software is now free

`main.tex` is a conventional single-column arXiv/bioRxiv-style Molarium draft. It is
deliberately simple: standard article typography, numbered sections, two
evidence-bearing figures, and no publisher-specific template.

## Build

Install TeX Live 2025 (full) or a smaller distribution containing the packages
used in `main.tex`, plus `latexmk`. Then run:

```sh
make -C paper
```

The PDF is written to `paper/build/main.pdf`. For continuous compilation while
editing:

```sh
make -C paper watch
```

The same directory can be uploaded to Overleaf. A local Tectonic build also
works with `tectonic main.tex --outdir build`. Generated files in `build/`
should not be uploaded.

`SYSTEM-PAPER.md` is the readable prose synopsis. `make_figures.py` regenerates
the benchmark plot from the measurements recorded in the manuscript. The
reviewed interface montage is versioned as a raster figure because it records a
specific product state.

`PROVENANCE-ARCHIVE.md` defines the private raw archive, public redaction, session
timeline, and release manifest required before making a controlled productivity
claim from the development record.

## Authoring conventions

- Keep one sentence per source line when practical; this makes review diffs much
  easier to read.
- Cite primary sources. The present short draft keeps its references inline
  so the arXiv bundle has no BibTeX dependency.
- Put plots and diagrams in `figures/`, preferably as vector PDFs. Generate them
  from versioned data and scripts rather than editing them by hand.
- Use semantic labels such as `fig:workflow` and `fig:performance`.
- Keep draft claims explicit and keep benchmark baselines visible in captions.
- Stay on the generic preprint style until a target venue is chosen.

## arXiv handoff

This source targets ordinary LaTeX. Upload `main.tex` and every used figure from
the root of the submission archive; do not include the local `build/` directory.
Use a fixed manuscript date rather than `\today`, because arXiv may rebuild the
PDF later.
