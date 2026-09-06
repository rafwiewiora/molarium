# Simulation benchmarks

Energy and **every Cartesian force** are compared against native OpenMM, independently
constructed in Python from the same numeric force-field System. The browser side runs
the production `webgpu-worker.js`; no alternative force implementation is substituted.
This validates force evaluation, not the accuracy of the force field against experiment
or independent assignment of charges/parameters.

The pinned [protocol](./protocol.json), [case generator](./prepare.mjs),
[native oracle](./native_openmm.py), [browser runner](./run-browser.mjs), and
[acceptance tests](./metrics.test.mjs) are the reproducible source of truth.
[Measured results and raw evidence](./results/README.md): 47/47 fixed-f32-input
kernel comparisons pass on Apple M1 Pro and NVIDIA L4. Against original
double-valued inputs, 42/47 meet the same strict tolerance; near-minimum and
translated-coordinate precision limits are prominent in the results. Native
OpenCL/CUDA precision baselines and five-repeat throughput tables are included.
The initial energy-summation failure is preserved alongside its correction.

## Reproduce

Requirements: Bun 1.3.14, Node (for preparation/scoring), Python 3.10–3.12, and
Chrome with a physical WebGPU adapter. For Linux NVIDIA hardware, Chrome needs
a working graphics/Vulkan driver as well as CUDA. A CUDA-only installation is
not evidence of browser-WebGPU availability. Software adapters are rejected.

```sh
bun install --frozen-lockfile
uv venv --python 3.12 .venv-benchmark
uv pip install --python .venv-benchmark/bin/python openmm==8.2.0 numpy==2.2.6
.venv-benchmark/bin/python benchmarks/simulation/export_upstream.py
npm run benchmark:simulation:prepare
npm run test:simulation-benchmarks

# Choose a NEW attempt directory each time. Existing results cannot be overwritten.
.venv-benchmark/bin/python benchmarks/simulation/native_openmm.py \
  --output benchmarks/simulation/attempts/my-gpu-a01/reference.json
bun benchmarks/simulation/run-browser.mjs --speed \
  --output benchmarks/simulation/attempts/my-gpu-a01/webgpu.json
node benchmarks/simulation/score.mjs \
  --packet benchmarks/simulation/generated/packet.json \
  --reference benchmarks/simulation/attempts/my-gpu-a01/reference.json \
  --actual benchmarks/simulation/attempts/my-gpu-a01/webgpu.json \
  --output benchmarks/simulation/attempts/my-gpu-a01/score.json

# Run AFTER the browser timing job, never concurrently on the same GPU.
uv pip install --python .venv-benchmark/bin/python -r benchmarks/simulation/requirements-cuda12.txt
.venv-benchmark/bin/python -m openmm.testInstallation
.venv-benchmark/bin/python benchmarks/simulation/native_openmm.py \
  --platform CUDA --precision single --speed \
  --output benchmarks/simulation/attempts/my-gpu-a01/cuda-single.json
```

The plain pip package does not include CUDA; install the explicitly version-matched
official CUDA plugin above. OpenMM 8.2's loose extra can otherwise select a newer,
ABI-incompatible plugin. Confirm CUDA is actually listed by the installation check.
Use `--platform OpenCL --precision single` on supported Apple/AMD/Intel systems.
Run CUDA `mixed` and `double` separately to characterize precision. The scorer
also accepts native platform results as `--actual`. Missing platforms produce
an error artifact, not a passing row. `CHROME_PATH` selects a Chrome binary or
a reviewed hardware-specific launcher. Preserve that launcher's flags with a result.
For NVIDIA Linux, an equivalent launcher to the measured L4 run is included:
`CHROME_PATH="$PWD/benchmarks/simulation/chrome-nvidia.sh" bun benchmarks/simulation/run-browser.mjs --speed --output PATH.json`.

For a quick isolated subset, `prepare.mjs --without-upstream` generates 46 cases
without a network download; score it with `--suite openmm-small-46`. The default
scorer requires all 47 registered cases, and separately reports `fullSuitePassed`.
`run-browser.mjs --cases ID,ID` is a diagnostic subset; it cannot score as a
full-suite pass. To inspect an explicitly subsetted packet with matching reference
and measured case sets, `score.mjs --diagnostic` reports the observed comparisons
but always leaves the acceptance gate false. Empty case sets are rejected.
The scorer verifies supported input schemas, the actual reviewed protocol content
and its SHA-256, unique expected case IDs, and exactly **3N finite forces** in
every original, rounded, and measured observation. `--seconds` and
`--repeats` override timing length explicitly and are recorded. Default: one
warm-up, five measured repetitions, at least two seconds per sample.

## Accuracy protocol

- Isolated harmonic bond/angle, proper/improper periodic torsions, Lennard–Jones,
  Coulomb, exclusions and independently scaled exceptions; combined OBC2/ACE.
- Prepared Rosemary Trp-cage (304 atoms) and ubiquitin (1,231 atoms), each with
  isolated terms, full vacuum/OBC2, deterministic coordinate perturbations,
  a 500 Å translation stress test, nonperiodic cutoff, and X–H constraints.
- Two-particle tests just inside/outside the 0.8 nm cutoff. Exception interactions
  must remain present outside that cutoff.
- Official OpenMM DHFR GBSA: AMBER99SB, explicit upstream OBC radii, 2 nm cutoff,
  hydrogen masses 1.5 amu, and all 1,221 upstream constraints. Its neighbor buffer
  is explicitly sized to hold every potential neighbor; the cutoff is unchanged.

The oracle records both original double-valued inputs and the f32-rounded values
actually packed for WebGPU. The primary gate tests the latter; the former and
input-quantization error remain visible, especially for translated coordinates.
OpenMM's own physical constant and analytic force classes are used, without
importing Molarium's WASM/C++ bridge. OBC settings, exception parameters and
reaction-field dielectric are explicit. Energy is kJ/mol; force is kJ/mol/nm.

The force report includes RMS absolute and relative error, maximum Cartesian
error, and the median/P95/maximum symmetric per-atom relative error used in
[OpenMM's validation guide](https://docs.openmm.org/latest/userguide/library/07_testing_validation.html).
The aggregate is a median of case medians, not an atom-count-weighted average.
Individual case rows remain authoritative; a good median cannot hide a failure.

Acceptance limits are fixed in `protocol.json` before measurement:

| Quantity | Allowed absolute error |
| --- | --- |
| Potential energy | 0.001 + 3×10⁻⁵ × sum of absolute native component energies, kJ/mol |
| Cartesian force RMS | 0.002 + 0.001 × native force RMS, kJ/mol/nm |
| Maximum Cartesian force error | 0.02 + 0.003 × largest native force component, kJ/mol/nm |

All three gates must pass. Non-finite values, missing/duplicated cases and
provenance mismatches fail closed. These are implementation-regression tolerances,
not an assertion that every observable is accurate to that tolerance.

## Speed protocol and interpretation

We report both single-point job latency and MD throughput with raw samples,
median and P05/P95 spread. Compilation is warmed. Every job waits for real GPU
completion/readback. The common MD workload is 250 steps, 1 fs, 300 K, friction
1/ps, with the fixture's stated constraints/cutoff and two saved endpoints.

Browser timings include worker messages, System packing/buffer construction,
integration, energy/force evaluation and output transfers. They restart the
simulation for each production job. Native timings use an already constructed
Context, read the requested state, and integrate continuously within each sample.
These scopes are intentionally labelled separately: do not divide the columns
and advertise the quotient as a matched kernel speedup. Native OpenMM uses its
LangevinIntegrator; the browser's integration algorithm and random stream differ.
Neither timing is pure GPU kernel time; these short jobs are not long-run NVE
drift or thermodynamic-ensemble validation.

## What has and has not been reproduced

We reviewed the [pinned upstream benchmark implementation](https://github.com/openmm/openmm/blob/0da03998df892bbb0a954ad3767c30a0cc53a11c/examples/benchmarks/benchmark.py),
the [OpenMM 7 methods](https://doi.org/10.1371/journal.pcbi.1005659), and the
[OpenMM validation guide](https://docs.openmm.org/latest/userguide/library/07_testing_validation.html).
The current upstream script's default GBSA timing uses 4 fs, H-mass repartitioning,
HBonds, LangevinMiddle, and friction 91/ps. Our energy/force reproduction uses
that numeric System, but our common timing workload is explicitly modified.
Historical results from other GPUs or OpenMM releases are not our measurements.

| Upstream family | Production direct WebGPU coverage |
| --- | --- |
| DHFR `gbsa` | Exact representable numeric force model; modified integration timing |
| `rf`, `apoa1rf` | Unsupported: periodic boundaries |
| `pme`, `apoa1pme` | Unsupported: periodic boundaries and PME |
| `apoa1ljpme` | Unsupported: LJPME |
| `amoebagk`, `amoebapme` | Unsupported: polarizable AMOEBA forces |
| `amber20-dhfr`, `amber20-cellulose`, `amber20-stmv` | Unsupported: periodic boundaries and PME |
| Published ubiquitin NVE drift protocol | Not yet reproduced by this short-job suite |
| Independent GROMACS/Tinker comparisons | Not yet rerun; OpenMM is the independent oracle here |

The separate [batched STORMM-style WebGPU engine](../../stormm/README.md) has
[existing WASM-Reference validation](../../stormm/openmm-reference-validation.mjs).
It is not native STORMM and those older results are not part of this direct-worker
native-OpenMM gate. Replica throughput must be reported as aggregate replica-ns/day,
never substituted for single-trajectory ns/day.

### Production STORMM versus native OpenMM

[Measured results and complete raw evidence](./results/STORMM.md): **22/22 supported
cases pass on both M1 Pro and L4**, with 25 unsupported cases explicitly retained.

Run the same frozen 47-case packet through `run-browser.mjs --backend stormm`.
Its independently registered scope is **22 supported cases and 25 unsupported**:
ten analytic cases and twelve Trp-cage cases are measured; nonzero cutoffs and
Systems exceeding 512 atoms are reported explicitly, without modifying their
Hamiltonians or substituting smaller systems. Add `--speed` for five-repeat,
single-replica production-job timing on supported performance cases.

```sh
bun benchmarks/simulation/run-browser.mjs --backend stormm --speed \
  --output benchmarks/simulation/attempts/my-gpu-stormm-a01/stormm.json
node benchmarks/simulation/stormm-score.mjs \
  --packet benchmarks/simulation/generated/packet.json \
  --reference benchmarks/simulation/attempts/my-gpu-a01/reference.json \
  --actual benchmarks/simulation/attempts/my-gpu-stormm-a01/stormm.json \
  --output benchmarks/simulation/attempts/my-gpu-stormm-a01/score.json
```

This is an **original-input** comparison to independently constructed native
OpenMM Reference, with the same numerical tolerances. It is not a matched-packed-input
gate: STORMM's Å/kcal conversion and fixed-point accumulation differ from the direct
worker's f32-nm representation. A passing supported subset never sets `fullSuitePassed`.
Static energy/scoring preserves the supplied pose, including constraint-bearing
Systems; SHAKE/RATTLE projection is applied only for dynamics/conformer work.
The new `energy` worker job returns all 3N forces in kJ/mol/nm. Speed uses one
replica, friction 1/ps, and records STORMM's production seeded initial-coordinate
jitter. These are not matched resident-kernel timings or an ensemble speedup claim.

WASM OpenMM remains useful as a portable in-browser diagnostic oracle and for
offline demonstrations, but is not a modern performance competitor. Its existing
five-pose native comparison does **not** certify every bridge option or benchmark.
The native path above avoids depending on that unproven transitive equivalence.

All three workers now reject unknown numeric System fields, unsupported force
content, invalid parameter domains/indices, and non-finite coordinates before
accepting supplied parameters. The Python oracle independently enforces the same
seven-array contract. No valid fixture parameters are rewritten by validation.

## Regression discovered by this suite

The initial M1 Pro run passed 44/46 cases. Ubiquitin's isolated LJ energy missed
the native oracle by 1.45668 kJ/mol despite close force agreement. Serial f32
summation across the full pair triangle was replaced with per-atom rows and a
parallel tree reduction; the miss fell to 0.000626 kJ/mol. The perturbed OBC2
case also recovered. All 46 original cases then passed without changing any
tolerance. Initial and corrected attempts remain separate.

## Adding hardware results

Submit the full raw reference/browser/native-platform JSON files, their immutable
packet, generated scores, source hashes, and exact commands. Include physical GPU
model, driver, OS, browser version, precision and launch flags. Run on an otherwise
idle GPU and record unusual power/thermal limits. Repeat on consumer NVIDIA,
AMD, Intel, and additional Apple GPUs; unmeasured rows must stay unmeasured.
Never count SwiftShader/llvmpipe or a missing CUDA/Vulkan platform as hardware coverage.

Upstream inputs and force fields retain their original licenses. The exporter
records commit-pinned source URLs, downloaded-file hashes, force-field XML hashes,
and an audit serialization of the actual OpenMM System. It downloads the upstream
benchmark script for provenance but does not execute downloaded Python code.

CI rechecks every frozen file hash, recomputes every published pass/fail decision,
and rejects headline WebGPU results whose executable source hashes no longer match
the checkout. New implementation changes therefore require fresh benchmark evidence.
