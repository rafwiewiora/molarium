# Transition precision paths: qualification evidence

This extends the [first fixed-input audit](../README.md) to the pinned production
shader generators, weight packer and actual GPU int5 upload. It evaluates an
experimental normalization candidate; **the candidate is not deployed**. No
trained model, full prediction or crystal coordinates are used.

## What runs

Five cases come from the original immutable fixture without regenerating their
inputs: MSA 31×64, pair 17×128, tiled pair 1761×128,
single 5×384 and near-constant pair. Two additional stress inputs are
`float32(100 + 0.005 * original_input)` for the MSA and single tracks. The
original weights and the widening factor of four are retained.

Each of these **seven cases** runs with three resident-weight representations:
FP32, FP16, and int5 matrices decoded into FP16. LayerNorm scales/offsets remain
unquantized in the encoded source and are narrowed with the resident buffer.
The actual pinned LocalFold [quantizer](https://github.com/sokrypton/localfold/blob/5ea3d42c911949700401b54003cb28c557fcf2a6/tools/quantize_af3.py)
encodes the matrices with asymmetric five-bit groups of 32 and FP16 scales/zeros.

The **actual official OpenFold3 SwiGLU module** runs in FP64 with exactly those
resident values, at the identical input. Its LayerNorm output is saved too.
This reference separates arithmetic/storage error from changing the weights.
Independent NumPy LayerNorm/SwiGLU calculations agree with all 21 official
references to maximum relative RMS 2.58e-12.

For every representation, the GPU runs both original fast variance and the
candidate through three paths:

- Fused transition, with precision-matched staged values and FP32 accumulation.
- Fused in-place residual transition with row ranges and 256-row chunks.
- Three-pass split transition, capturing normalization before the two GEMMs,
  using FP16 scratch/arithmetic where the stock chooser requests it.

That is **126 configurations: 63 original and 63 candidate**. Ragged rows,
offset bindings and the final chunk are exercised. The stock chooser's returned
geometry is recorded; where it declines splitting, a forced vector control is
labelled. `selectedByProduction` means the chooser selects that geometry for
the supplied width/precision. It does not claim every forced variant runs in
the current trained cofolding models.

The test uses the shipped `planBlockUpload` and `runBlockUpload`, not a copied
GPU decoder. In **42 int5 checks**, the complete resident buffer matches the
independent CPU-decoded FP16 values byte for byte. Both source matrices use
nonzero offsets in the packed buffer.

## Results on Apple M1 Pro / Chrome

| Resident weights | Candidate checks passing | Worst full-update relative RMS | Worst absolute error | Original fast failures |
| --- | ---: | ---: | ---: | ---: |
| FP32 | 21 / 21 | 5.45e-6 | 5.52e-6 | 9 / 21 |
| FP16 | 21 / 21 | 1.61e-3 | 5.60e-3 | 9 / 21 |
| int5 → FP16 | 21 / 21 | 1.61e-3 | 5.99e-3 | 9 / 21 |

The 27 original failures are the three stress cases across precisions and
paths; all produce nonfinite full updates. Every ordinary original case passes.
The candidate is finite and passes the declared matched-precision component
checks in all 63 configurations. Full-update errors include the FP32 rounding
of an in-place residual; reference error is measured on the update, so a large
constant residual cannot hide an inaccurate update.

Gates were written before the first run. The FP32 full-update gate remains
relative RMS ≤1e-4 and maximum absolute error ≤2e-4. For FP16 scratch/arithmetic
the full-update gates are ≤1e-2 and ≤2e-2; the relative bound follows the pinned
upstream [split checker](https://github.com/sokrypton/localfold/blob/5ea3d42c911949700401b54003cb28c557fcf2a6/tools/gpu/check-transition-split.js).
Normalization has separate FP32 gates of 1e-5 / 2e-5 and FP16 gates of 1e-3 /
1e-2. All require finite values. These are implementation engineering bounds,
not a pose-accuracy criterion. The earlier stress discrepancy against official
FP32 remains recorded in the first audit; these matched-weight FP64 checks do
not turn it into an FP32 parity pass.

Changing resident weights alone changes this synthetic transition output by
relative RMS 0.047–0.049% for FP16 and **6.62–6.73% for int5 → FP16**, even when
both are evaluated in official FP64 arithmetic. That is separate from the
roughly 0.16% GPU arithmetic/storage error at matched half-precision weights.
These are random, nonzero component fixtures, not trained-weight distributions;
they do not quantify a trained model's structural error or explain the observed
browser/native pose disagreement.

## Findings and failed stages retained

**LCP-02 — residual-write coverage.** The first diagnostic text transformation
rewrote a residual write target as an arithmetic expression. The in-place shader
failed compilation. This was a defect in our diagnostic candidate, not in the
unchanged production code. The transformation now preserves the write address;
an actual-generator unit regression covers scalar/vector and FP32/FP16 forms.
Both original failed attempts and their exact source/output bytes remain in
[qualification-history.zip](qualification-history.zip).

**LCP-03 — MSA stress failure of the simple candidate.** After the write-target
correction, the first complete run still failed two FP32 candidate checks: MSA
stress, fused and fused residual. Relative RMS was about 5.59e-4. Merely chaining
the row shift and shifted-mean subtraction at the scalar branch's reload was
insufficient on the tested driver. Materializing the translated input in
existing FP32 workgroup scratch before subtracting the mean resolves these
tested failures. No extra workgroup array is allocated. This observation does
not identify a specific compiler optimization or prove behavior on other GPUs.

The history archive preserves the original 126-record report and its source.
Its exact raw output can be reconstructed from unchanged final bytes plus a
95,232-byte delta; the original complete-output SHA-256 is checked. Neither the
failed measurements nor the gates were edited. The earlier 15-reference export
is also preserved as the exact prefix of the expanded reference blob, with its
original manifest/exporter. [Independent analysis](analysis.json) verifies all
of this and recomputes every GPU error.

## Scope and remaining work

The probe invokes production generators, packer and GPU upload, but changes
only diagnostic shader strings. The vendored code and deployed runtime remain
unchanged. The corrected candidate still needs a direct implementation in the
actual generators, coverage of other normalization kernels and factors, NVIDIA
subgroup-matrix testing, and matched full-model/throughput qualification before
default deployment. Stock M1 vector kernels do not establish matrix-unit
behavior. Recorded dispatch/readback timings are single component observations;
they are not an end-to-end speed comparison.

Full native GPU model comparisons remain outstanding separately. Nothing here
establishes accurate ligand binding poses or full-model numerical parity.

## Recompute from exact bytes

The [reference archive](reference-evidence.zip), [GPU archive](gpu-evidence.zip)
and [history archive](qualification-history.zip) contain exact arrays and source
snapshots. [Hashes and contents](evidence.json), [reference manifest](reference-manifest.json),
[all measurements](comparison.json) and [recomputed results](analysis.json) are
also directly inspectable. Each archive fits the deployment's 25 MiB file limit.

```sh
python folding/comparison/analyze_transition_precision.py \
  --publication reviews/cofold-layer-parity-2026-11-13/production \
  --output /tmp/recomputed-production-precision.json
python -m unittest discover -s folding/comparison -p 'test_transition_precision.py'
```

These commands require NumPy, no GPU or PyTorch. For a new hardware measurement,
extract the original audit's `fp32` fixture and this reference archive into new
directories, then use an unused output file:

```sh
bun scripts/cofold-transition-precision.browser.mjs \
  /tmp/original-fp32 /tmp/production-reference /tmp/new-hardware-report.json
```

This runs only component kernels; it does not download trained weights or
repeat any saved cofold prediction.
