# Direct transition implementation and standalone dispatch

This is component evidence on an Apple Metal WebGPU adapter. It extends the
[126-configuration precision audit](../production/README.md). No trained or
full-model prediction was repeated, and no cross-vendor or throughput claim is
made. The new normalization is experimental opt-in, with no UI/request switch
or default folding activation.

## LCP-04: direct implementation

The audited local patch adds `variance: 'shifted-fast'` directly to the transition
generators, removing the diagnostic shader-rewrite step. A source proof checks
126 default `fast`/`two-pass` configurations for identical WGSL and 105 generated
shader hashes against all 63 earlier GPU candidate configurations. Seven actual
FP32 calls through `Af3TransitionGpu.run` produce **byte-identical outputs** to
their earlier fused candidate measurements and pass the original FP32 component
gates. Those measurements used the intermediate normalizer-only source
`946ae66f…`, preserved with its exact receipt; they are not relabelled as runs
of the subsequent source.

## LCP-05: standalone runner leaves rows unwritten

The original runner used `transitionRowTile(rows)` for its dispatch while its
shader used `transitionRowTile(rows, channels)`. At 384 channels the mismatch
caused incomplete coverage. Five saved, independent native rows were repeated
to larger row counts; each transition row is mathematically independent.

| Rows × channels | Original unwritten rows | Original relative RMS | Corrected unwritten rows | Corrected fast relative RMS |
| --- | ---: | ---: | ---: | ---: |
| 1000 × 384 | 500 | 0.7071 | 0 | 9.2350 × 10⁻⁷ |
| 1761 × 384 | 1319 | 0.8654 | 0 | 9.2359 × 10⁻⁷ |

The intermediate normalizer-only source retained the same dispatch failure.
The correction passes channel width to the dispatch tile calculation. Both
default `fast` and opt-in `shifted-fast` now write every row and pass the
pre-existing FP32 gates; shifted-fast relative RMS is approximately 9.104 ×
10⁻⁷. Original failures remain in the archive. A recording-device API test also
checks tile coverage at widths 64, 128 and 384; that test is a dispatch contract
check, **not numerical GPU evidence**.

`Af3TransitionGpu.run` has no demonstrated caller in the production folding
path. This finding is limited to that standalone entrypoint. Neither it nor the
synthetic normalization stress test establishes the cause of model pose errors.

## Reproduction and source provenance

[evidence.json](evidence.json) hashes every member of
[integration-evidence.zip](integration-evidence.zip): exact reports, raw GPU
arrays, both source/receipt/patch stages, original source, license and runners.
The final source is `76764277…`; the unchanged base is `49c02501…`. Complete
hashes are in the patch manifest and reports. Historical measurements retain
their original source pins. References are reused from the preceding official
FP64 precision archive rather than regenerated.

```sh
node --test folding/comparison/transition-patch.test.mjs
python folding/comparison/analyze_transition_integration.py \
  reviews/cofold-layer-parity-2026-11-13/integration
```

The NumPy analysis verifies every archive/member/slice hash and recomputes all
**17** output metrics, gate decisions, direct-output identity and zero-row
counts. It expects seven direct passes, four failures before the dispatch fix,
and four corrected passes plus two retained original failures afterward.

The [portable patch instructions](../../../scripts/localfold-patches/README.md)
describe exact import reproduction. Predictions record the base revision,
complete current vendor-receipt hash, local patch IDs and original/patched/patch
hashes. Further normalization/factor/matrix paths, full-model matched tensors,
NVIDIA execution and throughput remain to be qualified before activation.
