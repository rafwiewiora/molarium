# Four-cycle trained trunk: measured precision controls

**The strict-FP32 control passes 14 of 32 unchanged boundary gates. All 32 pass
the relative-error gate, but 18 fail the absolute-error gate.** No complete-trunk
parity pass is claimed. This is one matched OpenBind-0 STARD4 (9T51/A1JTM)
component fixture, separate from the 480-prediction stock Boltz-2 pose study.
The existing native MSA pose control gave <2 Å ligand RMSD for all three seeds.
These measurements reuse exact target features, actual sampled MSA values,
full-FP32 trained weights and native observations. No native capture,
conversion, denoising, confidence or pose prediction was repeated.

## Precision finding and correction

**TRUNK-PRECISION-01:** the original producer requested FP32 staging, weights,
accumulation and pair weights, but omitted `pairMatrixKernels:false`. The pinned
MSA/pair code independently enables half-arithmetic outer-product and triangle
contractions under that switch. Thus the original measurement uses FP32 resident
weights with default pair arithmetic; it is **not strict FP32**. Its original
receipt, plan and raw arrays remain unchanged.

The [corrected control](strict-fp32/measurement-receipt.json) uses the existing
precision switch and observes every shader creation. All 56 generated shaders
contain no FP16 type. The [public producer fix](precision-fix.json) transfers
this switch and observation gate into
[`cofold-trained-trunk.browser.mjs`](../../../scripts/cofold-trained-trunk.browser.mjs).
Production folding kernels and default folding precision are unchanged.

| Control | Both gates passing | Relative gate passing | Worst relative RMS | Worst absolute error |
|---|---:|---:|---:|---:|
| Original FP32 requests, default pair arithmetic | 8 / 32 | 15 / 32 | 2.12e-3 | 59.3984 |
| Two-pass variance, default pair arithmetic | 8 / 32 | 12 / 32 | 2.38e-3 | 69.0625 |
| Strict FP32, observed shader gate | 14 / 32 | 32 / 32 | 3.49e-6 | 0.1875 |

All outputs are finite. The [exact comparison](precision-comparison.json) links
the [original](analysis.json), [two-pass](two-pass/analysis.json), and
[strict-FP32](strict-fp32/analysis.json) analyses. The two-pass control did not
resolve the discrepancy and is not promoted as a fix.

| Cycle 0 boundary | Original relative RMS | Strict relative RMS | Original max absolute error | Strict max absolute error |
|---|---:|---:|---:|---:|
| Pair after MSA | 1.57e-4 | 2.20e-7 | 0.7583 | 0.001953 |
| Final pair | 1.56e-3 | 1.81e-6 | 11.8616 | 0.011719 |
| Final single | 9.27e-5 | 2.99e-7 | 23.0204 | 0.09375 |

**TRUNK-FP32-01:** strict precision reduces cycle-0 MSA relative error about
712-fold and final-pair relative error about 860-fold, identifying precision
configuration as a material confound in this component comparison. Remaining
absolute discrepancies are retained. Acceptance remains relative RMS ≤1e-4,
maximum absolute error ≤1e-3, and finite values, as declared in the original
[audit plan](../trunk-audit-plan.json). No tolerance was relaxed. Feature values
are not energies or ångströms. This does not establish the cause of complete
pose disagreement, quantized-model agreement or performance equivalence.

## Exact arrays and offline replay

The [public evidence release](https://github.com/rafwiewiora/molarium/releases/tag/cofold-trained-trunk-2026-11-17)
contains exact native and original Apple output arrays, inputs, receipts and
consumed source snapshots. The first archive is 1,204,453,502 bytes and expands
to 1,301,703,719 bytes in 264 regular files. Its [receipt](archive-receipt.json)
and [verified upload](release-upload-verification.json) record SHA-256
`b9387cf17b671b993a2b1e8f2eca66f3d3bd057c59ca6f4a439d42a8151c2046`.
The trained-weights binary is omitted because offline error replay does not use
it; its hash and metadata remain attached. New GPU recomputation requires
separately obtaining that exact binary.

The [second archive receipt](control-archive-receipt.json) and
[verified upload](control-release-upload-verification.json) identify the
1,208,862,374-byte precision-control archive, SHA-256
`ec5b302d10e0ac036858bff174c6a6f681cb1e5c9b60ebdda45a8102e633f7e8`.
It adds both precision follow-ups, complete observed arrays, isolated sources
and failed packaging stages. It reuses the first
archive's unchanged native fixture. Verify archive hashes before extracting
into new directories. From a repository checkout, with NumPy installed:

```sh
python folding/comparison/check_trained_trunk.py \
  --fixture ORIGINAL/fixture --measured ORIGINAL/measured \
  --output NEW_ORIGINAL_ANALYSIS.json
python folding/comparison/check_trained_trunk.py \
  --fixture ORIGINAL/fixture --measured CONTROLS/strict-fp32/measured \
  --output NEW_STRICT_ANALYSIS.json
```

Both commands intentionally exit 1 for the measured gate failures while saving
all 32 records. This replays errors without new neural inference. Adaptation
certificates reverse to the original consumed producer. The original 166-file
pin set and additional transitive import pins distinguish measurements from
later producer fixes.

## Producer startup failures retained

**TRUNK-PAGE-01:** the [first original attempt](startup-failure.json) failed its
relative fixture fetch before any GPU calculation. The successful retry actually
observed `about:blank` with `readyState=complete`, then the requested fixture
page. The [readiness fix](public-harness-fix.json) waits for the exact URL,
expected title and completed document, then probes the actual fixture endpoint.
That certificate identifies the intermediate readiness-only producer version;
the separate precision certificate identifies the later correction.

The isolated two-pass copy initially missed an unchanged helper import. The
calculation then completed, but its offline checker needed the frozen Python
import closure. [The data-only recovery](two-pass/offline-analysis-recovery001/plan.json)
retains that failure and analyzes the saved arrays. The first strict producer
expression had a nested-string regex escaping error and captured zero seams.
Its successor uses `String.raw`, parses the actual browser expression before
startup, and captures all 32 seams. [Original failure stages](history/) remain
attached. No completed GPU measurement was repeated to repair packaging or
offline analysis. The shared headless helper is unchanged.
