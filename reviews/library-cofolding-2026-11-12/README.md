# Cofolding library integration and throughput — 2026-11-12

Implemented: a serial OpenBind-0 compound/seed queue, local checkpointing,
pause/explicit resume, per-entry failures, live approximate progress and measured
warm ETA, local Foldarium grid/single-pose review, saved exact human preferences
and notes, and portable library/shortlist export. The reviewer loads structures
by compound and the queue holds compact metadata, supporting libraries beyond a
single browser prediction without loading all structures into RAM.

## Measurements

Apple M1 Pro; Chrome 157's normal macOS WebGPU adapter (`apple / metal-3`),
headless browser with an isolated profile. Serial execution, no MSA search,
small test ligands (ethanol, benzene, benzoate), seeds 0 and 1. Each row is a
separate fresh-browser session. These arbitrary protein–ligand pairs test
throughput and integration, not biological binding or pose correctness.

| Protein | Steps | Additional recycles | Poses | First pose | Warm mean wall time | Warm poses/min |
|---|---:|---:|---:|---:|---:|---:|
| Trp-cage, 20 aa | 1 | 0 | 6 | 12.19 s | 0.46 s | 130.5 |
| Trp-cage, 20 aa | 25 | 2 | 6 | 13.93 s | 1.03 s | 58.3 |
| Ubiquitin, 76 aa | 25 | 2 | 4 | 12.59 s | 2.75 s | 21.8 |
| Ubiquitin, 76 aa · 16 varied compounds | 25 | 2 | 48 | 12.00 s | 2.62 s | 22.9 |

The 48-pose library completed without failures in 135.31 seconds. It includes
ethanol/benzene, aspirin, caffeine, ibuprofen, acetaminophen and other substituted
aromatics (exact SMILES are in the raw run). Instrumented managed-GPU counters
returned to 16,347,712 resident bytes/16 buffers after every pose, with a peak
of 623,815,848 bytes. These counters cover upstream-tracked GPU buffers, not
total browser/process/driver memory; this run does not prove unlimited scaling.

The first pose includes ligand features, public weight loading/decoding, shader
compilation and inference. Warm wall time excludes the first **chronological**
pose and includes the subsequent per-ligand/per-seed work; it is not just kernel
time. Individual inference times are also recorded. Timings vary with target
length, ligand size, MSA depth, protocol, browser/GPU and competing work. This
does not establish throughput for typical larger drug targets, sustained
thousand-compound runs or another GPU. On the 76-residue fixture, 100 compounds ×
three poses would take roughly 14 minutes at the observed warm rate, plus setup;
this arithmetic is an estimate, not a measured 300-pose experiment.

`summary.json` is recomputed from the immutable completed library exports,
ordered by `startedAt`. It contains their SHA-256 digests, protocols, browser and
adapter information, every pose timing and output PDB hash. Raw exports:

- `quick/library-1.json`: 20 aa, minimal sampling; an early viewer check exposed
  a Mol* namespace assumption after all six predictions completed.
- `standard/library-1.json`: 20 aa, standard settings; a test-harness race read
  the previous run's completion text before a new run had started. Its six
  completed predictions are retained and reused instead of rerun.
- `standard-76/library-1.json`: new 76 aa standard-settings run, compact PAE
  storage. End-to-end review tests passed using this run and imported earlier
  outputs. `throughput.json` preserves detailed protocol/provenance, and
  `foldarium-review.png` shows the two-pose grid.
- `library-48/library-1.json`: 16 compounds × three seeds, 48 completed poses,
  standard settings and per-pose managed-GPU-memory counters; review/export
  checks passed again. Its screenshot shows three independently seeded poses.

The interrupted first 76-residue harness attempt was stopped before a checkpoint
was exported; it is not included in successful timing measurements. The final
harness waits for the new run ID and active state, writes a receipt after each
completed case, and can reuse completed JSON exports for reviewer-only tests.
An early derived timing report used IndexedDB's lexicographic pose-ID ordering;
statistics now explicitly use chronological order. Raw pose timestamps/timings
were preserved and the corrected summary can be reproduced with:

```sh
MOLARIUM_BENCH_HARDWARE='Apple M1 Pro' \
  node scripts/summarize-cofolding-throughput.mjs \
  reviews/library-cofolding-2026-11-12/quick/library-1.json \
  reviews/library-cofolding-2026-11-12/standard/library-1.json \
  reviews/library-cofolding-2026-11-12/standard-76/library-1.json \
  reviews/library-cofolding-2026-11-12/library-48/library-1.json
```

## Review findings and linked fixes

- **LIB-01 — Preserve completed work.** Per-pose atomic IndexedDB checkpoints,
  separate interrupted attempt IDs, explicit resume and no rerun of complete or
  failed poses. Unit test interrupts and resumes the queue and checks all attempts.
- **LIB-02 — Scalable browser storage.** Compact pose index, per-compound structure
  reads, optional full PAE retention (default hash/shape), one shared alignment.
  Export is still an in-memory JSON operation and import has a 500 MB bound.
- **LIB-03 — Human preference is not truth.** Standalone Foldarium library mode
  avoids quiz answer/RMSD contracts. Exact IDs, notes, preferred/rejected/none,
  and atomic mutually consistent “none”/preference updates are persisted locally.
- **LIB-04 — Preserve molecular comparisons.** Least-squares Cα protein alignment
  moves each complete complex. Unit tests retain a deliberately displaced ligand
  and explicit aromatic bonds/formal charges at arbitrary coordinates.
- **LIB-05 — Stop and inspect during long API work.** Pause/status bypass the
  regular Chemist Actions queue. Browser Web Locks exclude concurrent library
  runners and protect deletion while computing. Ordinary actions keep their
  existing structural input limits; only the library bulk route accepts 10,000
  explicit entries.
- **LIB-06 — Actual viewer API.** Replace an unavailable Mol* namespace call with
  `CameraManager.focusSphere`; the actual reviewer now opens and renders predicted
  pockets and ligands. The upstream and hosted standalone viewer both use 5.11.0.
- **LIB-07 — Honest progress and timing.** Monotonic within-pose estimates, warm
  measured ETA, first-pose setup separated, actual protocols and source hashes
  preserved; benchmark aggregation uses timestamps, not sorted compound IDs.
- **LIB-08 — Reliable startup and scoped requests.** Polling before the first
  checkpoint returns starting/idle; pause requests during creation are retained;
  button/controller cleanup covers startup failures. The bulk action rejects a
  conflicting model/single-ligand input instead of silently changing it, and
  shared hardware/model-download failures stop the queue instead of failing every
  ligand. Release runs also record the Molarium distribution's code-version hash
  alongside LocalFold/model pins (unversioned development modules report null).
- **LIB-09 — Keep the human's inspection state.** Preference, note and none-of-these
  changes update review controls in place, preserving cameras and WebGL viewers.
  The browser regression asserts that voting retains the same viewer canvas.

Verification: Node queue/input/cancellation/storage tests; Foldarium's existing
public suite and public-tree audit; actual WebGPU inference through the visible
library button; grid rendering; persisted preference; shortlist file; none clears
preference; JSON import under a fresh local identity. Reviewer regression reuses
completed outputs in CI, without downloading models or repeating inference.

Remaining scientific qualification: native OpenBind parity and known-complex
pose accuracy remain experimental, as in the single-prediction integration.
Remaining scale qualification: representative larger targets/ligands, long-run
storage/quota stress, multiple GPU/browser types, and streaming very large
exports. Native `www.foldarium.org` rollout is separate from this Molarium-hosted
source integration; no private deployment configuration was copied.
