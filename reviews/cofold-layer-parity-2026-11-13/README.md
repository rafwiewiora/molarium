# Fixed-input transition-layer precision

The [expanded precision-path audit](production/README.md) now covers 126 fused,
in-place/ranged and split configurations, plus actual GPU int5 upload. It retains
the failed diagnostic stages and a corrected component candidate. Production
deployment and full-model qualification remain outstanding.

This isolates one numerical component from the full-model and crystal-pose
experiments. The actual official OpenFold3 `SwiGLUTransition` runs on CPU with
nonzero random FP32 weights, fixed inputs and epsilon 1e-5. The pinned LocalFold
WebGPU transition receives exactly the same arrays. No trained checkpoint,
quantization, sampler, predicted structure or crystal coordinates are involved.

Official source: [OpenFold3 revision 795e45b](https://github.com/aqlaboratory/openfold-3/blob/795e45b03924a8f8ffc72ae50298bd113530b9d3/openfold3/core/model/layers/transition.py).
Browser source: [LocalFold revision 5ea3d42](https://github.com/sokrypton/localfold/blob/5ea3d42c911949700401b54003cb28c557fcf2a6/webgpu/af3/trunk/transition.js).
Exact source, fixture, shader, environment and output hashes are in the
[comparison](comparison.json) and [evidence receipt](evidence.json).

## Observed results

Five fixed cases cover MSA (31×64), pair (17×128), tiled pair (1761×128),
single (5×384), and a pair stress input near 100 with 0.005 Gaussian noise.
The widening factor is four. On Apple M1 Pro / Chrome, ordinary and tiled
inputs agree with the official FP32 output to relative RMS about 3e-7–5e-7
for both upstream variance modes. The predeclared ordinary gate is relative
RMS ≤1e-4 **and** maximum absolute error ≤2e-4; it is not relaxed for stress.

The near-constant input exposes a cancellation problem:

| Normalization | Finite? | Relative RMS vs official FP32 | Relative RMS vs official FP64 |
| --- | --- | ---: | ---: |
| Upstream fast `E[x²] − E[x]²` | No | undefined | undefined |
| Upstream two-pass | Yes | 1.001e-3 | 1.018e-3 |
| Diagnostic shifted fast | Yes | 7.063e-4 | 5.201e-7 |
| Diagnostic shifted two-pass | Yes | 7.063e-4 | 5.192e-7 |

**All four stress comparisons fail the original native-FP32 gate.** This remains
explicit in the report. The official FP32 result itself differs from the same
official module in FP64 by relative RMS 7.063e-4 on this ill-conditioned input.
The FP64 run casts the original FP32 values to double; it does not regenerate
inputs or parameters. Reconstructing the official FP32 module from the saved
arrays first reproduces every original output exactly.

The diagnostic candidate subtracts each row's first channel before the existing
normalization arithmetic. This translation leaves LayerNorm unchanged in exact
arithmetic and avoids cancellation for the tested input. Both candidate modes
are finite and satisfy the ordinary numerical gate **against FP64** in all five
cases. Their discrepancy from the official FP32 stress output remains reported;
agreement with a higher-precision reference is a separate question.

## Finding LCP-01 and remaining work

The fast variance failure is reproduced from exact input bytes, and row shifting
is a promising component-level correction. It is **not deployed**. The runner
transforms only its diagnostic shader, records both shader hashes, and leaves
vendored and production code unchanged. Full-model int5/f16 execution also uses
other normalization and split kernels; this one FP32 diagnostic does not qualify
them. A production correction needs equivalent coverage of those paths and
matched full-model controls, including throughput measurements. No causal link
to the recent-panel pose errors is established.

The real implementation failure and the native FP32 conditioning error must not
be hidden by dropping the stress case, clipping a negative variance to zero,
changing thresholds, or describing the finite candidate as full-model parity.

## Recompute without inference

[fixed-input-evidence.zip](fixed-input-evidence.zip) contains exact FP32 inputs,
weights and official outputs; official FP64 outputs; and raw IEEE754 WebGPU
output bytes, including the nonfinite values. The
[independent NumPy regression](../../folding/comparison/test_layer_precision.py)
checks hashes and recomputes every published error directly from those arrays.
It needs no GPU, weights download or PyTorch installation.

```sh
python -m unittest discover -s folding/comparison -p 'test_layer_precision.py'
```

To regenerate the official fixtures in an isolated environment with the pinned
OpenFold3 0.5.1 source and Torch 2.9.1 CPU, use a new output directory for each:

```sh
python folding/comparison/export_native_layers.py --output /tmp/new-fp32-fixtures
python folding/comparison/check_layer_precision.py --fixtures /tmp/new-fp32-fixtures --output /tmp/new-fp64-reference
bun scripts/cofold-native-layer.browser.mjs /tmp/new-fp32-fixtures /tmp/new-gpu-report.json /tmp/new-fp64-reference
```

The layer runner is diagnostic-only. It saves raw outputs and both reference
comparisons; its ordinary-case process gate does not turn the documented stress
failures into passes. These component runs are separate from the recorded
end-to-end prediction timings.
