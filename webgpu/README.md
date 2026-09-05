# OpenFF SMIRNOFF WebGPU backend

See the [independent native-OpenMM benchmark suite](../benchmarks/simulation/README.md)
for current, source-hashed energy/force validation and GPU timing protocols.
Numerical results further below are historical local measurements. In particular,
Reference/WASM speed ratios are not comparisons against native OpenMM CUDA/OpenCL.

Molarium's experimental GPU method is a browser-native evaluator implemented by
`webgpu-worker.js` and `molarium-webgpu.wgsl`. It is a direct **SMIRNOFF System
evaluator on WebGPU**, not an OpenMM WebGPU platform. For ordinary small
molecules, the WebGPU and OpenMM workers call the same
`openff/sage-parameterizer.js` module, so both receive the same OpenFF Sage
2.1.0 bonds, angles, periodic torsions, van der Waals parameters, exclusions,
1–4 exceptions, masses, and deterministic RDKit Gasteiger charges. The prepared
Rosemary alpha protein reference bypasses browser typing and supplies the exact
numeric System exported by official OpenFF/NAGL tooling to both engines.

The shader evaluates:

- harmonic bond and angle terms;
- every assigned proper and improper periodic torsion term;
- Lorentz–Berthelot Lennard-Jones and Coulomb interactions;
- Sage/OpenMM 1–2 and 1–3 exclusions plus scaled 1–4 exceptions;
- opt-in OBC2 generalized Born water with standard mbondi2 radii and the ACE
  nonpolar surface term;
- an opt-in nonperiodic cutoff backed by a GPU-built fixed-stride Verlet list;
- graph-colored X–H SHAKE and RATTLE velocity constraints for a 2 fs step;
- steepest-descent geometry relaxation and short stochastic Langevin dynamics.

Positions are stored in nm, time in ps, mass in daltons, force in kJ/mol/nm,
and internal energy in kJ/mol. User-facing energy is converted to kcal/mol.
Parameter assignment and calculation remain inside browser workers; molecular
data does not leave the tab.

## Numerical design and scope

WebGPU currently exposes single-precision arithmetic on the tested browsers.
Forces are analytical and accumulated deterministically by one invocation per
atom. A compact valence-incidence table avoids rescanning unrelated terms, and
ordinary nonbonded parameters are mixed on demand with sparse directed
exception rows. This avoids both floating-point atomics and the former dense
`32*N*N`-byte pair matrix. The fixed 512-atom cap is gone; allocations are now
checked against the adapter's actual storage-buffer limits.

The flexible reference path uses a 1 fs integration step. The optional X–H
mode derives constraint distances from the exact bond equilibrium parameters,
colors the constraint graph so atom-disjoint edges execute in parallel, and
runs four deterministic SHAKE/RATTLE sweeps at 2 fs. The host reports the final
maximum relative bond residual. The nonperiodic cutoff path builds directed
Verlet rows with a 0.2 nm skin, validates row capacity without truncation, and
rebuilds every 20 steps. It does not yet implement periodic boxes, explicit
solvent, PME, virtual sites, barostats, generic protein parameterization, or
batched independent systems. Use OpenMM Reference as the compatibility oracle.

## Product target

This backend is not intended to reproduce every OpenMM Platform feature. The
next production target is one browser-local protein–ligand system with cutoff
neighbor lists, constraints, the validated OBC2 force, and sound
thermostatted integration. A separate STORMM-shaped backend is the preferred
architecture for thousands of independent small systems. Periodic PME/LJPME,
explicit solvent, barostats, virtual sites and arbitrary OpenMM custom/plugin
forces are later phases and must remain visibly unsupported until implemented
and validated.

## Validation

`bun run test` launches real headless Chrome WebGPU work. The suite sends the
same parameterized systems to both evaluators, covers a 14-molecule Sage panel,
compares small-molecule and Rosemary protein energies and forces to OpenMM 8.2
Reference, and then checks GPU minimization and a 250-step/26-frame GPU dynamics
trajectory by reevaluating their endpoints with OpenMM.

The current 265-check run passed, including OBC2/cutoff energy and force parity
and 2 fs constrained trajectories in both engines. Across the 14-molecule panel, the largest
single-point deviation was `2.361e-6` relative. For the aspirin gradient, the
WebGPU/OpenMM deviation was `7.696e-7` relative RMS (`3.486e-3 kJ/mol/nm` RMS;
`1.356e-2 kJ/mol/nm` maximum component). These are regression measurements on the
tested browser and hardware, not a cross-platform precision guarantee. For the
304-atom Rosemary Trp-cage reference, WebGPU differed from OpenMM by
`1.525e-4 kcal/mol` at the starting geometry and passed the protein force-vector
comparison.

On the tested Apple M1 Pro, a warmed three-run 1,000-step Rosemary benchmark
measured `214.9 ns/day` in WebGPU versus `102.8 ns/day` in OpenMM Reference
WebAssembly at the same 1 fs step. Single-point energy plus force readback still
favored the CPU path (`25.5 ms` versus `5.7 ms`). Run
`bun run benchmark:rosemary` to measure the crossover on another adapter.

A larger browser-only scaling run used hydrogen-complete ubiquitin (PDB 1UBQ):
76 residues, 1,231 atoms, and an exact Rosemary/NAGL System relaxed for 500
OpenMM Reference minimizer iterations before dynamics. On the same M1 Pro,
three warmed 1,000-step runs measured a median `65.18 ns/day` in WebGPU versus
`7.11 ns/day` in OpenMM Reference WebAssembly, a `9.16×` worker-time speedup
(`8.99×` by page-wall time). Initial energies differed by `0.0194 kcal/mol`.
Single-point energy plus force readback still favored OpenMM (`48.1 ms` versus
`238.3 ms`). This remains an all-pairs, nonperiodic vacuum benchmark: it
demonstrates engine scaling, not a scientifically complete solvated protein
protocol. Reproduce it with
`bun run benchmark:rosemary --fixture=./openff/rosemary-ubiquitin.json`.

The same ubiquitin system in OBC2/ACE implicit water measured a three-run
WebGPU median of `29.33 ns/day` (`2.946 s` per 1,000 steps). One matched OpenMM
Reference WASM run measured `1.148 ns/day` (`75.279 s`), giving a `25.6×`
worker-time speedup. The starting total energies were `-2305.1328 kcal/mol`
and `-2305.0634 kcal/mol`, respectively (`0.0694 kcal/mol` absolute over 1,231
atoms). On the aspirin regression, WebGPU differs from OpenMM by
`1.279e-4 kcal/mol` and `7.835e-7` relative force RMS. Reproduce the protein
run with `bun run benchmark:rosemary --fixture=./openff/rosemary-ubiquitin.json
--implicit-solvent=obc2`.

The protein-oriented path (`--implicit-solvent=obc2 --constraints=hbonds
--cutoff-nm=1.0`) constrains 629 X–H bonds in 1UBQ. On the M1 Pro, three warmed
1,000-step WebGPU runs measured a median `290.24 steps/s` or `50.15 ns/day` at
2 fs, with a final maximum relative constraint residual of `2.16e-6`. A matched
250-step OpenMM 8.2 Reference WASM run measured `30.79 steps/s` or `5.32
ns/day`, a `9.43×` physical-throughput advantage for WebGPU. Starting cutoff/OBC2
energies differed by `0.0979 kcal/mol` over 1,231 atoms. The same WebGPU cutoff
run with flexible bonds measured `293.13 steps/s`, showing that graph-colored
SHAKE/RATTLE adds little step-time overhead; its main benefit is the doubled
physical timestep. These are nonperiodic implicit-solvent results, not an
explicit-solvent or PME claim.

## Supplied scaffold

The earlier `files (1).zip` archive was useful design scaffolding, but it was
not a complete OpenMM platform: its `WebGpuPlatform.hpp` omitted the platform
implementation and most required OpenMM kernels. Molarium consequently kept a
direct browser-compute architecture and validates it against OpenMM rather than
presenting that incomplete C++ interface as an OpenMM GPU backend.
