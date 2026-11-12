# LF-01 — runtime-sized folding and protein–ligand cofolding

Molarium previously exposed only template-free OpenFold ONNX exports at 64/128
residues. The new adapter imports LocalFold revision
`5ea3d42c911949700401b54003cb28c557fcf2a6` and exposes AF2 `model_1_ptm` plus
OpenBind-0 (OpenFold3 v0.5.0) through the existing folding panel and
`protein.predict` API. Source: https://github.com/sokrypton/localfold .

## Implementation

- [Upstream receipt](../vendor/localfold/UPSTREAM.json): 210 unmodified modules,
  7,298,352 source bytes, with per-file SHA-256. Existing upstream LICENSE and
  README retained. `scripts/import-localfold.mjs` reproduces the import from
  the exact clean upstream checkout. This is a module closure, not an iframe.
- [Request and chemistry boundary](../folding/request.mjs): one protein and an
  optional explicitly typed SMILES/CCD ligand. LocalFold tensors use runtime
  shapes, with the upstream device limits/memory budget. Legacy OpenFold stays
  selectable. No native CPU neural-network fallback is added to LocalFold.
- [Inference adapter](../folding/localfold.mjs): calls the actual AF2 driver or
  OpenBind featuriser/foldBatch. Preserves upstream model dialect, weights,
  feature building and confidence calculations. Weight bundles remain at their
  upstream immutable Hugging Face URLs, verified by upstream shard digests.
- Single sequence, provided A3M and explicit ColabFold search are selectable.
  Supplied alignment query must match. Original insertion syntax is retained;
  the legacy 128-residue feature normalizer is not used by the new path.
- Input component bond orders, aromaticity and charges replace any inferred
  ligand connectivity, using exact atom names/elements. The installed graph is
  hashed and becomes preparation's registered-graph input. PDB confidence is
  restored onto displayed atoms so a high-confidence fold is not painted as zero.
- Prediction records preserve source/model pins, manifest and component hashes,
  request, alignment, PDB and confidence arrays. Inference timing starts after
  model loading; total elapsed time includes setup/search/loading. Early smoke
  reports below predate that timing split and must not be read as pure inference.
- Cancellation bypasses the ordinary action queue so it can reach a running
  fold. Existing downloads may continue into the shared model cache. Local Lab
  blocks the external weight-loading route before dispatch.

## Observed checks (Apple M1 Pro, isolated Chrome, actual WebGPU)

The [initial smoke receipt](localfold-2026-11-12/smoke.json) records:

| Input | Result |
| --- | --- |
| Trp-cage sequence, AF2, query-only, 0 recycles | 153 atoms, finite coordinates |
| 129 alanines, AF2, query-only, 0 recycles | 645 atoms, finite coordinates; crosses old limit |
| Trp-cage + ethanol SMILES, OpenBind, 5 steps | 156 atoms; three ligand atoms, two explicit bonds |

The [chemistry receipt](localfold-2026-11-12/chemistry.json) uses the UI defaults
of two additional trunk passes and 25 diffusion steps:

| Ligand | Result |
| --- | --- |
| Benzoate SMILES | nine ligand atoms; aromatic bonds and formal charge −1 preserved |
| EOH CCD | three ligand atoms, dictionary atom names and both bonds preserved |

Both returned finite coordinates and a registered ligand graph; preparation
selected `registered`. These arbitrary pairs test integration, not known binding.
The 129-alanine case tests shape handling, not biological fold accuracy.

`scripts/localfold-release.browser.mjs --cofold` additionally runs the real Fold
button against a production build with its actual CSP/COEP headers, supplied A3M,
and a real prediction-record download. It checks the sequence, alignment hash,
confidence/PAE arrays, ligand atoms and visible selected model. Real model tests
download upstream weights and are manual hardware checks, not offline CI.

[Unit tests](../folding/integration.test.mjs) cover request bounds/modality,
independent-of-distance ligand chemistry, real all-atom featurisation, imported
source integrity, and cancellation ordering. An offline
[browser check](../scripts/localfold-ui.browser.test.mjs) covers model/alignment
controls and Local Lab's rejection boundary. Both are in CI.

## Remaining qualification and extensions

This release does **not** establish native-model parity, across-device numerical
agreement, structural accuracy, binding affinity or ligand pose accuracy. The
upstream bundles use quantized weights. Kernel source identity is not evidence
of full-model prediction parity; that needs matched inputs against original
native implementations, with quantization measured separately. Follow-up:

1. Pinned native AF2 and OpenBind references, including intermediate tensors and
   confidence heads, and a float32-versus-quantized comparison.
2. Known protein–ligand complexes with symmetry-aware ligand RMSD, pocket
   contacts, chirality, clashes and chemical geometry; no known-pose leakage
   into inputs. Negative/failed runs retained explicitly.
3. Physical GPU/browser matrix with cold downloads/compilation separated from
   warm inference, memory peaks and longer proteins.
4. More than one chain/ligand, templates, nucleic acids, covalent bonds, record
   import/replay and downloaded-weight support for Local Lab.

Practical first-adapter scope is one standard protein chain and one noncovalent
ligand of ≤150 heavy atoms; CCD names are 1–3 characters to match our PDB reader.
SMILES reference geometry is currently LocalFold's component builder; its
stereochemistry deserves independent RDKit/native-model checks. The submitted
September paper and historical appendices remain frozen release artifacts.
