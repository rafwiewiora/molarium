# Production STORMM-style WebGPU versus native OpenMM

Generated from hash-verified immutable measurements by `build-stormm-report.mjs`.

The production browser worker is compared directly against independently constructed
native OpenMM 8.2 Reference Systems—not transitively through the WASM bridge.
Every supported case includes its potential energy and all 3N Cartesian forces.

## Agreement and explicit coverage

The full packet has 47 cases: **22 supported; 25 unsupported**. The latter require
nonzero cutoffs and/or more than 512 atoms per replica. They remain in every raw
result, with reasons. No cutoff was dropped and no smaller molecule substituted.

This gate uses **original inputs** and the unchanged accuracy tolerances in
[protocol.json](../protocol.json). It is not the direct-worker f32-nm packed-input
gate; STORMM uses Å/kcal packing and fixed-point accumulation. A supported-subset
pass is never a full-47 or arbitrary-System certification. Static scoring does
not apply constraint projection to the supplied pose.

| Hardware | Supported cases passing | Unsupported | Largest force relative RMS |
| --- | ---: | ---: | ---: |
| Apple M1 Pro | 22/22 | 25 | 9.448e-4 |
| NVIDIA L4 | 22/22 | 25 | 9.446e-4 |

Per-case pass/fail remains authoritative, including both 500 Å Trp-cage translation
stress cases. Coverage is smaller than the direct-worker panel, so these counts
must not be presented as a comparison of overall engine accuracy.

## Single-replica production-job speed

Median ns/day [P05–P95] from five measured repetitions, at least two seconds per
sample after warm-up; 250 steps/job, 1 fs, 300 K, friction 1/ps, two endpoints.
Each job constructs a fresh one-replica engine and includes transfer and endpoint
readback. STORMM retains its production seeded 0.02 Å initial-coordinate jitter.
These are not kernel-only measurements, aggregate ensemble throughput, or a
matched OpenMM resident-Context speedup.

| Workload | Apple M1 Pro | NVIDIA L4 |
| --- | ---: | ---: |
| trpcage-original-vacuum | 68.8 [68.7–69.0] | 116.9 [116.2–120.0] |
| trpcage-original-obc2 | 24.2 [24.2–24.3] | 39.9 [39.4–40.4] |
| trpcage-hbonds-obc2 | 19.1 [19.1–19.1] | 31.7 [31.4–31.8] |

## Evidence and remaining work

- Apple M1 Pro: [manifest and raw vectors/timing samples](m1pro-stormm-20260905-a01/manifest.json).
- NVIDIA L4: [manifest and raw vectors/timing samples](l4-stormm-20260905-a01/manifest.json).
- [Direct-worker/native baselines](README.md) retain distinct timing boundaries.
- The bundled WASM oracle remains a portable diagnostic; its historical five-pose native check does not cover every option.
- Multi-replica sweeps, matched native ensemble strategies, third-vendor measurements, and long-time ensemble validation remain open.
