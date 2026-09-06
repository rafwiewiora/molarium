# Molarium next best ideas and validation gates

This is the living technical backlog for Molarium. It records what should be built next,
why it matters, what speedup has actually been measured, and which accuracy checks must
pass before an experimental method becomes a trusted default.

The rules for this document are simple:

- Keep measured results separate from estimates.
- Record the exact system, hardware, precision, timestep, warmup, and timing boundary.
- Compare identical parameters and coordinates when claiming numerical parity.
- Do not call a conceptual rewrite a source port.
- Do not promote a method on energy agreement alone. Forces and dynamics matter.
- Unsupported chemistry or force terms must stop with an error. Silent fallback is a bug.

## What was actually ported to WebGPU

There was no single CUDA-to-WGSL conversion. Molarium currently has three distinct GPU paths.

### Direct Sage WebGPU

This is a clean browser implementation of the numerical terms in a prepared OpenMM System.
It was written directly in WGSL and JavaScript; it is not an OpenMM Platform plugin and it is
not translated OpenMM CUDA source.

The worker receives the same numeric bonds, angles, torsions, charges, Lennard-Jones values,
exceptions, constraints, and optional OBC2 data as the OpenMM Reference worker. The shader
implements the equations directly. Its current force kernel is atom-centric: one invocation
owns one atom and gathers its incident valence and nonbonded contributions. Compact incidence
and exception tables make this possible without floating-point atomics.

This route gives us a small, inspectable browser engine and direct OpenMM comparisons. It does
not automatically inherit arbitrary OpenMM forces, PME, barostats, virtual sites, or plugins.

### STORMM-style WebGPU

This is a clean WGSL implementation inspired by STORMM's replica-synthesis architecture. It is
not a line-by-line translation of STORMM's CUDA kernels and it is not the complete STORMM program.

The ideas taken from STORMM are the important architectural ones:

- pack many independent systems into one GPU workload;
- use deterministic fixed-point accumulation;
- keep enough work on the GPU to amortize dispatch overhead;
- organize simulation state around replica-local work rather than one OpenMM Context per copy.

Molarium then implemented a deliberately smaller homogeneous-replica engine: valence forces,
isolated Lennard-Jones and Coulomb, scaled exceptions, OBC2/ACE, Langevin or Verlet integration,
fixed-point coordinates, and replica-local SHAKE/RATTLE. Upstream STORMM fixtures and a pinned
native build are independent validation sources, not linked runtime code.

A genuine source-derived STORMM port would also bring heterogeneous synthesis descriptors,
the upstream work-unit machinery, more force terms, mature constraint specialization, GBn/GBn2,
and broader I/O. We should only do that when those features justify the much larger code surface.

### ANI-2x WebGPU

The ANI path is different again. Official TorchANI ANI-2x weights are exported to ONNX, and ONNX
Runtime WebGPU evaluates the eight atomic-network ensemble members. Molarium computes the
canonical 1008-value atomic environment vector (AEV) and contracts `dE/dAEV` back to Cartesian
forces using analytical derivatives.

The conformer batching path concatenates same-element atoms from many conformers into the dynamic
first dimension of each ONNX graph. Each conformer keeps its own coordinates, L-BFGS history, line
search, energy, and convergence state, while the expensive neural-network calls are shared.

AEV construction now runs in WGSL. The resulting storage buffer is passed directly to ONNX Runtime
with `Tensor.fromGpuBuffer`; `dE/dAEV` remains on the same WebGPU device and a second analytical WGSL
kernel contracts it into Cartesian forces. Only the ensemble energies and final force batch return
to JavaScript for the existing optimizer. Resource-limit failures can fall back to the verified CPU
descriptor path, but incompatible shapes, device loss, and non-finite results fail closed.

ANI-2x is a vacuum potential. Molarium must not describe it as OBC2-solvated or add an empirical
OBC term while continuing to label the result simply “ANI-2x.” Two new solvent-aware research
models are worth tracking:

- [TWIN](https://arxiv.org/abs/2607.10887) is an implicit-water equivariant potential reported for
  drug-like molecules, peptides, and proteins. The July 2026 preprint does not currently link a
  distributable implementation or weights.
- [ConSolv](https://arxiv.org/abs/2606.24983) conditions a MACE-like potential on 66 organic
  solvents. Its June 2026 manuscript says code and data will be released upon acceptance.

Add either model only after weights, license, reference inference, chemical domain, and force
goldens are available. Until then, the Arena should compare the Sage/OBC2 and vacuum-ANI surfaces
as explicitly different Hamiltonians.

### Selectable conformer alignment

Current Arena conformers share one graph and atom order, so their largest common substructure is
the whole molecule. The viewer aligns displayed stages to the judged minimum with a symmetry-aware
heavy-atom rigid fit. A future atom/substructure picker should supply a smaller alignment mask to
the same fitter. Generic maximum-common-substructure search is only needed when comparing related
but non-identical molecules, tautomers, protonation states, or transformations.

### Why WGSL required redesign rather than syntax translation

WGSL is portable across browser backends, but it is more restrictive than CUDA:

- no general `f64` arithmetic on the browser targets we use;
- no 64-bit integer atomics and no portable floating-point atomics;
- asynchronous buffer readback;
- tighter binding and buffer limits;
- less control over warps, occupancy, and dynamic shared memory;
- inverse trigonometric builtins with looser accuracy guarantees.

Molarium works around those limits with split `atomic<u32>` fixed-point accumulators, fixed-point
coordinate storage in the replica engine, atom-owned gather kernels where possible, compact packed
buffers, analytical derivatives, formulations that avoid inaccurate inverse trig, and bounded
command batches. These are algorithmic adaptations, not mechanical language changes.

## Measured performance ledger

These numbers are evidence for specific configurations, not universal speed claims.

| Path | Compared with | Workload and timing boundary | Measured result |
| --- | --- | --- | ---: |
| GPU-resident ANI-2x refinement | Batched ONNX WebGPU with JavaScript AEV/force loops | `CCCCCCOCC`, 64 requested seeds, 58 retained, 1,474 evaluations in 34 batches | ANI search 9.460 s to 1.398 s: **6.77x**; ANI lane end to end 11.62 s to 3.17 s: **3.67x** |
| Batched ANI-2x refinement | Previous one-conformer-at-a-time ANI implementation | `CCCCCCOCC`, 64 requested ETKDG seeds, 58 retained conformers, quick Arena search, one RDKit worker | ANI stage 40.344 s to 9.989 s: **4.04x**; end to end 42.154 s to 12.114 s: **3.48x** |
| RDKit worker pool | One RDKit WASM worker | 64 requested seeds, cold development benchmark | 0.943 s to 0.533 s: **1.77x** |
| Direct Sage WebGPU | OpenMM Reference WASM | 304-atom Trp-cage, warm 1,000-step flexible vacuum MD, M1 Pro | 214.9 vs 102.8 ns/day: **2.09x** |
| Direct Sage WebGPU | OpenMM Reference WASM | 1,231-atom ubiquitin, warm 1,000-step flexible vacuum MD, M1 Pro | **9.16x** worker-time speedup |
| Direct Sage WebGPU | OpenMM Reference WASM | Ubiquitin, OBC2/ACE, flexible, warm 1,000 steps, M1 Pro | 29.33 vs 1.148 ns/day: **25.6x** |
| Direct Sage WebGPU | OpenMM Reference WASM | Ubiquitin, OBC2/ACE, 1 nm cutoff, X-H constraints, 2 fs | 50.15 vs 5.32 ns/day: **9.43x** physical throughput |
| STORMM-style replicas | OpenMM WASM Reference CPU | 1,024 C16 replicas, equal aggregate warm steps, no setup/readback | **10.3x** |
| STORMM-style replicas | OpenMM WASM Reference CPU | 256 water27 replicas, equal aggregate warm steps, no setup/readback | **24.1x** |
| STORMM-style WebGPU | Upstream STORMM CUDA on the same NVIDIA L4 | 16 alanine replicas, 10,000 steps, vacuum/OBC2, flexible/constrained | **0.39–0.73x** CUDA throughput |

For the latest ANI benchmark, GPU time was split into 145.9 ms of AEV construction, 1,091.2 ms of
ONNX network work, and 94.5 ms of force contraction. Rescoring all 174 final Arena candidates with
ANI added 118 ms in three energy-only batches. The old and new implementations produced the same
judged energy arrays and conformer landscape in the development comparison. We still need a
checked-in, repeatable benchmark manifest before treating either speedup as a cross-version gate.

The complete STORMM conformer workflow does **not** yet have a defensible end-to-end speedup against
a matched modern CPU conformer workflow. We removed the serial OpenMM search from the product path;
that old reference lane was benchmark scaffolding, not a useful competitor. Build the benchmark in
the validation plan below before advertising a full-workflow number.

### Current local correctness baseline

On 18 August 2026, `bun run test` passed 351/351 browser checks on the development M1 Pro. The
focused `bun run test:ani-webgpu` suite additionally passed six native TorchANI fixtures:

- GPU-resident ANI-2x versus native TorchANI: `0.02572 kcal/mol` maximum energy error,
  `1.022e-5` maximum relative force RMS, and `3.366e-4 kcal/mol/Å` maximum force-component error
  across water, ethanol, methylamine, methanethiol, fluoromethane, and chloromethane;
- ANI batch-size-one, duplicate, and shuffled evaluations were exact; a rigid translation changed
  energy by `1.25e-8` hartree and the largest force component by `2.13e-4 kcal/mol/Å` in f32;
- direct Sage WebGPU versus OpenMM: `2.361e-6` maximum relative single-point deviation over the
  molecule panel and `7.696e-7` relative force RMS for aspirin;
- OBC2/ACE WebGPU versus OpenMM: `0.0001279 kcal/mol` energy error and `7.836e-7` relative force RMS
  for the reported aspirin implicit-solvent case;
- Rosemary Trp-cage starting energy: `0.0001525 kcal/mol` WebGPU/OpenMM difference.

These are a useful regression baseline on one browser/GPU stack. They are not the cross-vendor
acceptance envelope requested in Gate I.

## Prioritized next ideas

### P0: make correctness and performance claims reproducible

September 5 status: partially delivered for the **direct WebGPU worker**. The
[47-case native OpenMM suite](./benchmarks/simulation/README.md) and its hash-pinned
raw results cover Apple M1 Pro and NVIDIA L4, native OpenCL/CUDA precision, and five-repeat
throughput with explicit timing boundaries. The updated scorer rejects malformed vectors,
unknown protocols, and incomplete full-suite claims. This does not complete the STORMM-worker
native comparison, third-vendor coverage, long-time gates, or whole-workflow conformer benchmark.
The historical STORMM CUDA ratio above is not source-hashed current-worker evidence; its
separately retained study must be published/reconciled before supporting a current claim.

1. **Create one machine-readable result ledger.** Every benchmark should emit JSON containing the
   commit, fixture hashes, browser, adapter, driver, precision, timestep, warmup, sample distribution,
   setup/readback boundary, and validation results. The table above should be generated from it.
2. **Add a cross-device release matrix.** At minimum: Apple/Metal, NVIDIA/D3D12 or Vulkan,
   AMD/D3D12 or Vulkan, and one software Dawn/lavapipe correctness run. A method is experimental
   until its error envelope is measured on more than one GPU family.
3. **Make new backends fail closed.** Validate all force-term counts, model hashes, atom ordering,
   charge totals, exceptions, constraints, units, and supported elements before dispatch. Unknown
   terms and missing outputs must be errors, never zero-filled data.
4. **Separate independent oracles.** Shared parameterization is useful, but it can hide a common
   upstream mistake. Retain hand-computable fixtures, finite differences, native OpenMM, native
   TorchANI, and pinned upstream STORMM as distinct checks.

### Completed: move the ANI hot path into WebGPU buffers

Completed: per-stage timing, WGSL AEV construction, same-device ONNX buffer input/output, analytical
WGSL force contraction, CPU descriptor fallback for resource limits, TorchANI goldens, and batch
order/duplicate/translation checks. Mixed-convergence and cross-device tests remain open.

### P1: add the next MLIP only after hardening ANI

1. Benchmark AIMNet2 as the next molecular candidate. Its charge and long-range
   capabilities are attractive, but browser export and force parity must be demonstrated first.
2. MACE-OFF is a valuable higher-capacity comparison, but equivariant message passing is a larger
   WebGPU/ONNX portability project and should follow an operator/export feasibility spike.

Relevant upstream projects: [ONNX Runtime WebGPU I/O binding](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html),
[AIMNet2](https://github.com/isayevlab/aimnetcentral), and
[MACE](https://github.com/ACEsuit/mace).

### P1: turn Conformer Arena into a scientific benchmark

1. Check in a chemically diverse benchmark panel: flexible chains, macrocycles, rings, amides,
   intramolecular hydrogen bonds, charged molecules, sulfur, fluorine, and chlorine.
2. Freeze the seed set per molecule so candidate generators receive identical starting coordinates.
3. Report wall time, valid structures, unique clusters, low-energy conformer recall, best heavy-atom
   symmetry-aware RMSD, torsion coverage, and diversity. Do not rank methods only by their own energy.
4. Re-score all returned structures with one declared judge and also report method-native energies
   separately. Add an optional higher-level offline oracle for a small subset.
5. Bootstrap over molecules and seeds. A single attractive landscape is a demo, not a benchmark.
6. Keep ANI minimization as a competitor before attempting ANI dynamics. Stable minimization does
   not establish stable long-time MD.

### P1: optimize replica search automatically

Partially implemented: the STORMM replica-smoke sweep and visible recommended count already
exist. Repeated samples with uncertainty, the cache policy below, cross-device validation,
and adversarial exact-step/frame and replica-isolation coverage remain open.

1. Run a short warmup sweep over replica counts on the current adapter and system.
2. Choose the count that maximizes aggregate conformer-steps/s without exceeding memory or device
   limits, then display both selected count and benchmark uncertainty.
3. Cache the result by adapter, topology size, force options, and browser version.
4. Verify that timing is aggregate and that every replica advances the requested number of steps.

### P1: expose builder-relaxation controls

1. Let the user choose the automatic post-edit policy: off, local neighborhood, or whole molecule.
2. Let the user select atoms and mark them as fixed or harmonically restrained before optimization.
3. Show the automatically chosen movable region—including two-shell and complete-ring expansion—in
   the viewer before it runs, with a simple way to add or remove atoms.
4. Record the policy, selected atom indices, restraint strength, and optimizer in saved provenance.
5. Add regressions proving fixed atoms remain exact and restrained atoms obey the declared tolerance.

### P2: extend the classical WebGPU engines where the workload needs it

1. Replace the direct WebGPU engine's all-pairs Verlet-list construction with a spatial cell list,
   benchmark the full force path across compact and extended systems, and expose a cutoff only after
   it demonstrates a real crossover. The current 1.0 nm path is validation-only: it was 46% slower
   for 304 atoms and 17% slower for 1,231 atoms on an Apple M1 Pro.
2. Add the validated spatial neighbor-list design to the STORMM-style engine only after the direct
   path establishes its numerical behavior and size crossover.
3. Parallelize or specialize constraints. Same-L4 measurements show this is a clear gap relative to
   upstream STORMM CUDA.
4. Add heterogeneous synthesis only when mixed molecules in one launch are a real product need.
5. Add periodic boxes and PME as a separate project with its own validation plan. Do not mix this
   into the isolated-boundary engine incrementally without explicit model metadata.
6. Add checkpoints, restart files, cancellation, and device-loss recovery before encouraging long runs.

### P2: make interactions and trajectories quantitative

1. Recompute hydrogen bonds and aromatic contacts for each saved frame, with explicit geometric
   criteria and occupancy summaries.
2. Let residue-follow mode keep a stable aligned frame and expose RMSD, contacts, distances, and
   torsions as selectable collective variables.
3. Export the plotted values with the trajectory so visual interpretation is reproducible.

### P2: let users connect CUDA compute they control

Add a provider-neutral remote calculation protocol for a loopback CUDA sidecar, Modal, and a Colab
outbound relay. Start with native TorchANI CUDA as an independent ANI oracle, then add NVIDIA
ALCHEMI/AIMNet2. The browser must require an explicit remote selection and show the actual engine,
model hash, device, precision, transfer time, and fallback status. The full protocol, security
boundary, validation mode, and implementation order are in
[`REMOTE-CUDA-DESIGN.md`](./REMOTE-CUDA-DESIGN.md).

## Accuracy and validation checklist

Every new energy/force backend should pass Gates A through F. Dynamics requires Gate G. Batched
methods require Gate H. A release claim requires Gate I. Workflow methods such as conformer search
also require Gate J.

### Gate A: provenance and domain

- Hash model weights, numeric Systems, fixtures, generated shaders, and native reference outputs.
- Record upstream version/commit, exporter version, model license, browser, adapter, and driver.
- Check supported elements, charge, spin, connectivity, atom count, and force-term coverage.
- Reject unsupported forces, malformed parameters, non-finite values, and incomplete model outputs.

### Gate B: topology, parameters, and units

- Compare atom order, masses, total charge, bonds, angles, torsions, exceptions, and constraints.
- Exercise zero and nonzero 1-4 scaling, exclusions, impropers, multiple torsion terms, and ions.
- Test unit conversions explicitly at the worker boundary.
- Round-trip export/import without inferring bonds from coordinate proximity.

### Gate C: energies

- Compare each force component and total energy with an independent oracle.
- Include hand-computable two-, three-, and four-atom fixtures.
- Include ordinary geometries, distorted bonds/angles, torsion scans, close contacts, and large energies.
- Test translation, rotation, atom permutation, and replica-order invariance where applicable.
- Use combined absolute and relative tolerances; report both maximum and distribution, not one average.

### Gate D: forces

- Compare every Cartesian component with the native oracle.
- Compare analytical forces with central finite differences and random directional derivatives.
- Report RMS, relative RMS, maximum component, and worst atom/molecule.
- Check near-zero net force and torque for isolated systems.
- Include cutoff/skin boundaries, exception pairs, OBC radii changes, and near-collinear angles.

### Gate E: minimization

- Re-evaluate the initial and final structures in the independent oracle.
- Confirm finite coordinates, valid topology, lower target energy, and a meaningful final force norm.
- Compare single-structure and batched minimization from identical starts.
- Test line-search rejection, convergence, maximum-iteration exit, and clashed input failure.
- Measure geometry agreement as well as energy agreement; similar energy can hide a different minimum.

### Gate F: numerical robustness

- Test deterministic replay where determinism is promised.
- Test overflow, underflow, NaN propagation, overlapping atoms, coordinate translation, and buffer limits.
- Run long soaks with periodic health checks and exact requested frame/step counts.
- Force device loss or cancellation and verify a structured, recoverable error.
- Fuzz small valid Systems and compare energies/forces automatically with the oracle.

### Gate G: molecular dynamics

- Run NVE tests and report drift relative to thermal energy over multiple windows and seeds.
- Check center-of-mass momentum and temperature/equipartition behavior.
- Validate SHAKE and RATTLE residuals every step, not only at the final frame.
- For Langevin dynamics, compare distributions and autocorrelations across seeds rather than coordinates.
- Re-evaluate sampled frames in the oracle and test restart continuity.
- Test at least 100,000 steps for production-sized options before advertising long trajectories.

### Gate H: batching and replica isolation

- A chosen replica must match a one-replica run under the same deterministic seed.
- Reordering, duplicating, adding, or removing other replicas must not change it.
- Give each stochastic replica an independent, reproducible random stream.
- Assert exact per-replica step and frame counts and report aggregate versus per-replica throughput clearly.
- For ANI, compare batch size 1 with the full batch, shuffled batches, duplicate conformers, and batches
  whose members converge on different iterations.

### Gate I: cross-platform reproducibility

- Run the same hashed fixtures on at least three GPU vendors/backends.
- Establish a measured f32 tolerance envelope; do not require bit identity across vendors unless tested.
- Reject software adapters for performance claims, but keep one in CI for shader correctness.
- Detect and report backend fallback. Never label WASM execution as WebGPU.
- Save raw result JSON so a regression can be traced to a device, driver, or browser update.

### Gate J: workflow-level scientific utility

- Conformer search: measure reference-conformer recall, symmetry-aware RMSD, torsion coverage, cluster
  diversity, invalid structures, and time-to-first/useful conformer across a frozen benchmark set.
- MLIPs: verify AEVs, member energies, ensemble mean/spread, `dE/dAEV`, Cartesian forces, batching
  equivalence, and model-domain rejection against native TorchANI before testing chemical benchmarks.
- Implicit solvent: test neutral, charged, buried, exposed, and salt-bridge cases against OpenMM OBC2,
  then validate qualitative ensemble behavior separately from pointwise parity.
- Protein folding: keep feature/model parity separate from prediction quality on experimental structures.
- Viewer analysis: validate contact definitions and frame alignment numerically, not from screenshots.

## Current coverage and immediate gaps

| Area | Strong checks already present | Most important missing check |
| --- | --- | --- |
| Direct Sage WebGPU | 14-molecule energies, complete force vectors, OpenMM endpoint re-evaluation, Rosemary/ubiquitin, OBC2, cutoff, constraints | Cross-vendor matrix and longer NVE/restart tests for the protein-oriented path |
| STORMM-style WebGPU | f64 component references, finite differences, overflow/range, NVE drift, thermostat statistics, replay, isolation, constraints, OpenMM and pinned upstream STORMM fixtures | Neighbor-list correctness, broader chemistry, and long cross-device constrained/OBC2 soaks |
| ANI-2x | Official model hash, native TorchANI energies and forces for H/C/N/O/S/F/Cl examples, GPU/CPU descriptor parity, exact single/batch/duplicate/shuffle checks, minimization lowers ANI energy | Mixed-convergence batches, finite-difference gradient panel, cross-browser results, and standard chemical benchmark coverage |
| RDKit seed pool | Deterministic worker seeds, merged pruning, browser integration | Frozen serial-versus-pool conformer equivalence and quality/recall benchmark |
| Conformer Arena | Shared seeds, one common Sage/OBC2 score, explicit vacuum ANI score, STORMM/OpenMM same-coordinate parity, symmetry-aware clustering, batch-use assertions | Checked-in end-to-end CPU baselines and external conformer-quality benchmark |
| OpenFold 2 | Native graph parity, WebGPU/WASM parity, browser integration | Standard prediction-quality benchmark against experimental structures |

The immediate priorities are the remaining [review boundary fixes](./TODO.md), a direct
native OpenMM oracle for the production STORMM worker, three-vendor Gate I coverage,
and stronger Gate H replica isolation. WGSL AEV construction and stage timing are already
implemented; extend their cross-device and mixed-convergence validation. The matched
end-to-end conformer-quality benchmark remains open before making a whole-workflow speed claim.
