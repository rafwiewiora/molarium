# Native relative-position encoding agrees with the port's CPU reference

The port's unchanged CPU reference reproduces every captured native one-hot
relative-position value in both diagnostic systems. This holds for the original
browser indices as well as the separately controlled native indices.

| System | Tokens | Token pairs | Encoded values | Mismatched values |
|---|---:|---:|---:|---:|
| STARD4, 9T51 | 238 | 56,644 | 7,873,516 | 0 |
| YTHDF2, 32QY | 185 | 34,225 | 4,757,275 | 0 |

Each pair has 139 channels. All protein–protein, protein–ligand and
ligand–ligand groups agree exactly. The [case-level report](analysis.json)
records both input variants, group counts, original index differences and
source/archive hashes. The two variants reuse the same native outputs; they
are not four independent systems.

The earlier input audit found different token/entity numbering. Those numerical
labels preserve the relationships encoded here. For these two cases, this
comparison rules out a difference in the *CPU reference's encoded relationships*
as an explanation of the original pose disagreement. It does not verify the
fused WebGPU gather/projection kernel, learned pair embedding, quantization,
recycling, denoising, confidence or complete predictions. Native and browser
reference conformers still differ. No general accuracy or whole-model parity
claim follows from this limited check.

The expected arrays are actual saved outputs from the completed strict-FP32
native input-embedder captures. They remain in the existing
[STARD4](../trained-target/native-evidence.json) and
[YTHDF2](../trained-target-ythdf2-cpu/native-evidence.json) archives; no native
inference or capture was repeated. The comparator validates each archive and
its captured-output receipts, then calls the existing port
[`relativeEncoding`](../../../vendor/localfold/cpu/af3/trunk/embedder.js)
function. This is non-learned feature arithmetic, with zero neural forwards,
GPU requests or network calls.

Replay from the repository root:

```sh
python folding/comparison/check_relative_encoding.py \
  reviews/cofold-feature-parity-2026-11-13
```

The [tests](../../../folding/comparison/test_relative_encoding.py) reproduce the
complete public report and deliberately corrupt an actual ligand token index
or entity assignment. Both changes produce mismatches in the affected ligand
pair groups while leaving protein–protein pairs unchanged. Source code,
native receipts and all fixture bytes remain attached for independent review.
