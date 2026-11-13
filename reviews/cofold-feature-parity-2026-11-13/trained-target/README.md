# Matched trained atom-feature encoder: native / CPU / WebGPU

**The trained atom/input-feature stage agrees at matched inputs and FP32 weights.**
This checks one STARD4 (9T51 / A1JTM) fixture: 238 tokens and 1,679 active atoms.
It does not establish complete input-embedder, trunk, denoiser, confidence-head,
trajectory, quantized-model or pose-accuracy agreement.

| Actual path | Relative RMS, 384 learned channels only | Maximum absolute feature error |
| --- | ---: | ---: |
| Molarium production CPU vs stock native | 1.49 × 10⁻⁷ | 6.68 × 10⁻⁶ |
| Molarium production WebGPU vs stock native | 1.55 × 10⁻⁷ | 6.68 × 10⁻⁶ |

All 91,392 learned-channel values are finite. Their native RMS is 0.474, so
agreement is not a degenerate zero-output check. The other 63 channels copy
residue type, MSA profile and deletion mean; those match exactly and are reported
separately. These are numerical **feature values**, not structural RMSD in ångströms.
Gates declared before execution were relative RMS ≤10⁻⁴, absolute error ≤10⁻³,
and finite values. Both paths pass; the raw results and stricter observed errors
are retained in [analysis.json](analysis.json) and the
[original browser report](browser-comparison.json).

## What actually ran

The official OpenFold3 0.5.1 CLI loaded the OpenBind-0 checkpoint on an NVIDIA L4.
It reproduced the [processed-SMILES control](../comparison-9t51-a1jtm-processed-smiles.json)
feature blob byte for byte before one actual stock `input_embedder` call.
Parameters and arithmetic were FP32, with CUDA/CUDNN TF32 disabled. The whole-model
forward remained guarded: no trunk, denoiser, confidence calculation or predicted
pose ran. The [native receipt](native-receipt.json) records one module call and
zero whole-model calls, source hashes, checkpoint hash, exact outputs and precision.
The captured installed module sources match the pinned
[official implementation](https://github.com/aqlaboratory/openfold-3/tree/795e45b03924a8f8ffc72ae50298bd113530b9d3).

The measured browser was Chrome 157 on Apple M1 Pro / Metal. It ran the production
`buildTargetFeat` CPU and WebGPU implementations from public Molarium commit
`f505c883d147acb93b21cdf42116f151f52d5a8c`, using exactly the native generated
reference positions, atom-name/element/charge features and full-precision trained
atom-encoder weights. The [fixture](fixture/receipt.json) and raw arrays preserve
these inputs. No experimental bound coordinates or fitting to expected outputs
were used. Original browser/native pose predictions are unchanged.

Weights were mapped with the pinned upstream
[OpenFold3 layout converter](https://github.com/sokrypton/alphafold3/blob/e68d628df1d815cccb48bb1118d8763a594bfa23/converters/openfold3.py),
using its actual transpose/reshape/stack/alphabet mappings. No neural forward was
rewritten as an oracle. All 44 converted tensors are checked against the captured
native state. The native 449-channel target becomes the browser's 447-channel
layout; the two omitted native unknown-DNA channels are verified zero in this
protein/ligand fixture. This does not test nucleic-acid category handling.

The native stock module also exported projected single/pair tensors and relative
position features. They are preserved but **were not compared to browser outputs
in this experiment**. The 257-row alignment supplies input profiles; the learned
MSA attention stack was not executed. Production int5 weights and the full
sampling trajectory remain separate tests.

## Timing boundaries

The browser CPU/GPU calls took 4.717 s / 0.256 s for `buildTargetFeat`, including
its host conditioning and, for WebGPU, compile/upload/compute/readback. The native
0.765 s interval covers its full input embedder, including projected single/pair
outputs. These boundaries differ; this record does not assert a native/browser
speedup or library-screening throughput.

## Preserved evidence and replay

The [native evidence index](native-evidence.json) describes a 32,975,803-byte ZIP,
SHA-256 `4445e9b6ef901408a10132a490c18ca52d381be937b329dea521c30567013dce`.
Concatenate its two listed parts in order to recover the ZIP. Each part is at
most 16 MiB, within the static hosting file limit. It contains complete exposed
native arrays, exact trained weights, consumed producers, CLI settings and the
first-run converter/browser scripts. It excludes the full checkpoint and caches.
[Production source snapshot](production-sources.json) preserves all 164 imported
production/helper files at the stated Git base, including modules not executed
by this particular test. OpenFold3/OpenBind-0 attribution and checkpoint sources
remain attached to the native receipt; the
[release announcement](https://openbind.uk/news/blog-openbind-0-advancing-open-molecular-structure-prediction/)
identifies the model, code and weights as openly released under Apache 2.0.

The [offline checker](../../../folding/comparison/check_trained_target.py) reconstructs
the multipart archive, validates every file and array, checks the actual generated
inputs and all mapped learned weights, verifies the native channel correspondence,
and recomputes both errors from raw bytes. No model, GPU, PyTorch, JAX or pickle
is needed for this replay:

```sh
python folding/comparison/check_trained_target.py \
  reviews/cofold-feature-parity-2026-11-13/trained-target
```

To run a new browser measurement against the preserved fixture:

```sh
bun scripts/cofold-trained-target.browser.mjs \
  reviews/cofold-feature-parity-2026-11-13/trained-target/fixture \
  /tmp/new-trained-target-result.json
```

The tool rejects overwriting a previous measurement. The
[portable-source certificate](portable-source-adaptations.json) records the exact
import/root-path substitutions from the consumed prototypes to these repository
locations; numerical operations, data and gates are unchanged. First-run source
bytes remain preserved. For the identical production implementation, use the
stated Git base or the source snapshot; a later Molarium version is a new control.
[Tests](../../../folding/comparison/test_trained_target.py) replay complete evidence
and reject missing measured paths, altered raw outputs and changed source identities.
