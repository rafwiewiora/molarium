# Published structure assets

This directory pins public experimental structures used by Molarium's molecular
design-history movies. Raw coordinate files are retained unchanged; derived
views are generated reproducibly and record their source hashes.

| Entry | Role | Ligand | Source |
| --- | --- | --- | --- |
| 7GN8 | Moonshot starting complex, `(S)-x1` | RPZ | <https://www.rcsb.org/structure/7GN8> |
| 7GNR | optimized DNDI-6510 complex, `(S)-x38` | RZU | <https://www.rcsb.org/structure/7GNR> |
| 3SPF | BCL-xL fragment-linking starting complex | B50 | <https://www.rcsb.org/structure/3SPF> |
| 3SP7 | BCL-xL full linked-ligand structural constraint | 03B / BM903 | <https://www.rcsb.org/structure/3SP7> |

The coordinate files were downloaded from RCSB PDB. See `sources.json` for
download URLs and SHA-256 digests. Compound 4 is shown in its exact 3SPF
complex. Reconstructed BCL-xL trajectory states use the 3SP7 receptor
conformation and ligand scaffold aligned onto 3SPF; they remain explicitly
labeled visualization hypotheses, never deposited poses or docking predictions.
