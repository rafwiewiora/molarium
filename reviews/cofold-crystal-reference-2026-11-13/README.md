# Cofolding against experimental ligand poses

This small retrospective reconstruction check asks whether sequence-and-SMILES
cofolding recovers a known crystal pose. The three structures and scoring rules
were fixed before prediction. All three may occur in training data; these results
are not a held-out accuracy estimate or a prospective binding benchmark.

| Case | Experimental structure | Protein residues / observed Cα | Ligand heavy atoms |
| --- | --- | --- | --- |
| BRD4–JQ1 | [3MXF](https://www.rcsb.org/structure/3MXF), 1.6 Å | 127 / 127 | 31 |
| FKBP12–FK506 | [1FKF](https://www.rcsb.org/structure/1FKF), 1.7 Å; exact deposited FK5 graph | 107 / 107 | 57 |
| T4 lysozyme–benzene | [181L](https://www.rcsb.org/structure/181L), 1.8 Å | 164 / 162 | 6 |

The [frozen panel](panel.json) contains exact sequences, stereochemical SMILES,
reference hashes, input seeds and source URLs. Original mmCIF/CCD files are in
[sources](sources/). One deposited protein chain and the selected ligand are
used; other chains, crystal mates, assembly partners, waters and additives are
excluded. This single-chain approximation also applies to 1FKF, whose RCSB
biological assembly is annotated as a dimer. JQ1 is used in its **deposited +1
chemical state**, including its aromatic N–H; no neutralization is applied.
The deposited 181L sequence is used directly, including any construct changes.

## Completed browser results

Both models ran in actual Chrome/WebGPU on Apple M1 Pro, with single-sequence
input, int5 weights, 25 sampling steps, two additional recycles and seeds 0, 1, 2.
Only sequence and SMILES enter inference: no crystal coordinates, template,
bound conformer or binding-site restriction is supplied.

Ligand heavy-atom RMSD is measured **after fitting all observed corresponding
protein Cα atoms**, with symmetry handling. There is no independent ligand fit,
binding-site fit, core refit or residue trimming. For 181L, the two unobserved
residues enter inference but not the reference alignment. The 2 Å column is a
geometric criterion, not a complete assessment of chemical or physical validity.

| Model | Case | Seed 0 RMSD | Median of 3 | Best of 3 (oracle) | Poses ≤2 Å | Median protein Cα RMSD |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Boltz-2 browser | BRD4–JQ1 | 0.66 Å | 0.66 Å | 0.56 Å | 3/3 | 0.24 Å |
| Boltz-2 browser | FKBP12–FK506 | 5.94 Å | 6.49 Å | 5.94 Å | 0/3 | 0.47 Å |
| Boltz-2 browser | T4 lysozyme–benzene | 0.76 Å | 0.76 Å | 0.40 Å | 3/3 | 0.33 Å |
| OpenBind-0 browser | BRD4–JQ1 | 15.61 Å | 15.61 Å | 10.63 Å | 0/3 | 13.31 Å |
| OpenBind-0 browser | FKBP12–FK506 | 11.30 Å | 12.37 Å | 11.30 Å | 0/3 | 13.59 Å |
| OpenBind-0 browser | T4 lysozyme–benzene | 16.87 Å | 16.87 Å | 6.91 Å | 0/3 | 14.02 Å |

Boltz reproduced the ligand placements in two of these three cases across all
three seeds. It missed FK506 despite recovering the protein backbone closely;
the predicted macrocycle also has tetrahedral stereochemistry disagreements.
OpenBind missed all three ligands and had large protein-fold errors in this
single-sequence protocol. Its low mean pLDDT values (approximately 36–49) agree
with the observed structural problems. The experiment does not isolate whether
the cause is the browser port, quantization, inputs or model/protocol limitations.
Native controls are required before attributing a cause.

The [complete per-seed scores](browser-scores.json) include contact overlap,
centroid displacement, severe-clash diagnostics, tetrahedral stereochemistry,
confidence values and coordinate/source hashes. Seed 0 is an unselected result.
Highest-ipTM selection uses model confidence; oracle best-of-three uses the
experimental answer and must not be presented as prospective selection.
Stereochemical diagnostics do not cover every bond-geometry or physical-validity
criterion. No pose is discarded for producing a poor result.

A post hoc [check of all 18 saved input conformers](browser-input-stereochemistry.json)
found no mismatched or unassigned specified tetrahedral centres, including all
14 centres of FK5. Thus the reported tetrahedral inversions occur in the output
predictions even though those centres were correct in the supplied conformers.
This localizes the change to the prediction path; it does not identify which
model, port or sampling operation caused it.

Raw libraries and timing/provenance records:

- [OpenBind-0](browser-openbind0/throughput.json): [BRD4](browser-openbind0/library-1.json), [FKBP12](browser-openbind0/library-2.json), [lysozyme](browser-openbind0/library-3.json).
- [Boltz-2](browser-boltz2/throughput.json): [BRD4](browser-boltz2/library-1.json), [FKBP12](browser-boltz2/library-2.json), [lysozyme](browser-boltz2/library-3.json).
- Foldarium inspection bundles: [BRD4](review/3mxf-jq1.library.json), [FKBP12](review/1fkf-fk5.library.json), [lysozyme](review/181l-bnz.library.json). Import into the Molarium-hosted Foldarium reviewer. Each contains one clearly labelled experimental reference and every browser prediction, with no saved preferences. The reference is never counted as a prediction.

## Native controls

Official unquantized OpenBind-0/OpenFold3 0.5.1 (FP32 dense PyTorch) and Boltz 2.2.1
(BF16 mixed) controls are queued on PSIgreen with 200 steps, three recycles,
single-sequence input and the same three seeds. This differs from the browser's
sampling effort and does not establish fixed-input numerical parity.
The CPU configuration/chemical-input preflight passed. Initial T4 allocations
failed before their batch scripts started; the unchanged, unconsumed tasks were
resubmitted to normal/L4 queues. Native predictions are **pending**, not included
in the completed table above.

## Reproduce without model inference

Install [analysis dependencies](../../folding/comparison/requirements-analysis.txt)
in an isolated environment, then run:

```sh
python folding/comparison/experimental_reference.py score \
  --panel reviews/cofold-crystal-reference-2026-11-13/panel.json \
  --library browser-boltz2=reviews/cofold-crystal-reference-2026-11-13/browser-boltz2/library-1.json \
  --library browser-boltz2=reviews/cofold-crystal-reference-2026-11-13/browser-boltz2/library-2.json \
  --library browser-boltz2=reviews/cofold-crystal-reference-2026-11-13/browser-boltz2/library-3.json \
  --library browser-openbind0=reviews/cofold-crystal-reference-2026-11-13/browser-openbind0/library-1.json \
  --library browser-openbind0=reviews/cofold-crystal-reference-2026-11-13/browser-openbind0/library-2.json \
  --library browser-openbind0=reviews/cofold-crystal-reference-2026-11-13/browser-openbind0/library-3.json \
  --output /tmp/crystal-scores.json
```

Reference extraction is implemented in `experimental_reference.py prepare`.
Native sequence/SMILES inputs use `prepare-experimental.mjs` and the same native
input writer as the previous comparison. To compute a new browser attempt:

```sh
MOLARIUM_LIBRARY_PANEL=reviews/cofold-crystal-reference-2026-11-13/panel.json \
MOLARIUM_LIBRARY_REPORT=/tmp/new-crystal-boltz-run \
bun scripts/cofold-library.browser.mjs --boltz2
```

Omit `--boltz2` for OpenBind. Existing results need no new inference to analyze
or review. Regression checks cover charged aromatic N–H, exact chemical-state
mapping, missing reference residues, reference identity, a displaced ligand,
and duplicate case/method rejection.
