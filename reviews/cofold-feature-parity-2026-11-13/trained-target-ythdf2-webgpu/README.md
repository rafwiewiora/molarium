# YTHDF2: matched native / Apple WebGPU atom features

**The production browser GPU atom-feature stage passes the original numerical
gates for YTHDF2 (32QY / A1KEO).** This closes the previously unmeasured browser
part of the [second diagnostic control](../trained-target-ythdf2-cpu/README.md).
It uses the same saved native feature bytes and full-FP32 trained weights as
that CPU control. Native capture, conversion and CPU computation were reused.

| Comparison | Values | Relative RMS error | Maximum absolute error |
|---|---:|---:|---:|
| Browser GPU / native, learned atom channels | 71,040 | 1.56 × 10⁻⁷ | 5.72 × 10⁻⁶ |
| Browser GPU / native, complete target array | 82,695 | 1.54 × 10⁻⁷ | 5.72 × 10⁻⁶ |
| Browser GPU / earlier JavaScript CPU, learned channels | 71,040 | 7.99 × 10⁻⁸ | 1.91 × 10⁻⁶ |

All values are finite, and the 63 copied input channels match exactly. The
predeclared gates remain relative RMS ≤10⁻⁴ and maximum absolute error ≤10⁻³.
These are numerical feature errors, not pose RMSD in ångströms.

The measurement used actual `buildTargetFeat(..., device)` / `Af3AtomEncoderGpu`
from the pinned production source in Chrome 157 on a physical Apple Metal-3
adapter. The producer rejected software/fallback adapters before computation.
Exactly one new GPU target-feature call ran; there were zero new native calls,
CPU stage calls or whole-model predictions. All 99 files shared with the earlier
CPU producer are byte-identical. LocalFold authorship, source pin and license are
preserved with the consumed source.

The component took 270.515 ms after weight/device setup. This is one stage,
not complete-model throughput, native speedup or a compound-screening rate.
The native receipt times a larger input-embedder boundary. The old CPU timing
also comes from a separate run, so no timing ratio is claimed.

## Interpretation

YTHDF2 was selected because its original browser/native poses disagreed strongly;
STARD4 was selected as a closer diagnostic. Both now agree at this controlled
atom-feature boundary. This does not establish that their original generated
reference inputs were equivalent or explain their pose differences. Projected
single/pair embeddings, trunk, denoiser, confidence, production quantization and
full-model parity are outside this measurement. The separate NVIDIA numerical
jobs remain pending; this Apple result does not qualify NVIDIA hardware.

## Evidence and offline replay

The [original browser receipt](result.json), [complete raw output](result.production-webgpu.bin),
[frozen plan](plan.json), [independent analysis](analysis.json), execution markers
and [all 166 consumed source files](consumed-browser-source.zip) are preserved.
The source archive includes the original producer and the GPU-only adapter;
the [three exact adaptations](source-adaptation.json) reverse byte-for-byte to
the original producer. They select the unmeasured GPU path, enforce physical
Apple hardware and record adapter observations. Numerical code and gates are
unchanged. The protected browser helper retains its original hash.

The [source/ancestry index](source-evidence.json) points to the existing native
capture, weight mapping and exact fixture in the CPU-control directory. The
[offline checker](../../../folding/comparison/check_trained_target_webgpu.py)
first independently validates that native ancestry, all 44 mapped trained
tensors and channel correspondence, then verifies the consumed browser archive,
adapter receipt and complete raw output and recomputes all three comparisons:

```sh
python folding/comparison/check_trained_target_webgpu.py \
  reviews/cofold-feature-parity-2026-11-13/trained-target-ythdf2-webgpu
```

It makes zero model calls and needs no GPU, checkpoint, PyTorch, JAX or pickle.
CI also rejects a relabelled software-adapter receipt and changed numerical
output even when its local output digest is updated. Historical absolute paths
remain in the original receipts; portable replay uses the explicitly named
local raw file and the verified sibling fixture.
