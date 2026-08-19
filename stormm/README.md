# stormm-webgpu v0.3

WGSL molecular-mechanics engine with STORMM-style fixed-point batched replicas. This
is a STORMM-inspired implementation, not a port of the complete STORMM application.
Each current engine batches replicas of one topology; heterogeneous stacked-system
synthesis remains a required architectural extension.

## Files
- `core.mjs` — WGSL kernels (valence, nonbond, OBC2/ACE, kickDrift, SHAKE, kickKE,
  RATTLE, tick), topology
  builders (`buildAlkane(nC)`, `buildWater(side, rng)`, `buildDimer(opts)`), the
  `buildParameterizedSystem(molecule, parameterization)` OpenMM-System converter, constants,
  f64 CPU reference (`cpuEnergies`, `cpuDimerForce`), decoders, `mulberry32` RNG.
  No DOM, no GPU calls.
- `engine.mjs` — `createEngine(device, topo, nReps, {T, thermo, gamma, seed, initSeed,
  constraintTolerance, constraintIterations})`.
  Returns `{ run(steps), forceOnly(), readEnergies(), readPositions(rep), readAllPositions(),
  readVelocities(rep), readForces(rep), readStatus(), readConstraintStatus(),
  assertHealthy(), encodeStep(encoder), done(), destroy() }`.
  Works in browser and Node (Dawn). `run()` submits in <=50-step chunks so command
  buffers stay bounded. Pass `initSeed` for reproducible initial conditions.
- `test.mjs` — deterministic WebGPU validation suite.
- `openmm-reference-validation.mjs` — compares identical parameter arrays and
  coordinates to Molarium's bundled OpenMM 8.2 Reference-platform WebAssembly.
- `openmm-reference-results.json` — checked results from the laptop GPU.

## Numeric representations
| quantity    | representation                              | scale        | range              |
|-------------|---------------------------------------------|--------------|--------------------|
| energies    | int64 split (2x atomic u32, manual carry)   | 2^22 /kcal   | ±2.2e12 kcal/mol   |
| forces      | int64 split (2x atomic u32, manual carry)   | 2^18 /kcal/Å | ±3.5e13 kcal/mol/Å |
| coordinates | int64 fixed-point (authoritative) + f32 mirror | 2^32 /Å   | ±2.1e9 Å           |

Single-contribution guard clamp: |value| < 9e15 counts. NaN and clamp events set a
persistent GPU status flag and result reads throw instead of silently returning poisoned
data. There is no ±453 kcal/mol saturation and
no silent i32 force wrap: the overflow test drives |E|~2e6 kcal/mol and |F|~8e6
kcal/mol/Å through the accumulators and matches f64 to ~5e-7 relative.

Known precision boundary: kernels compute from the f32 coordinate *mirror*, so force
accuracy degrades with distance from the origin (~1e-7 relative per Å). At 500 Å,
energies agree with the origin-centered system to ~3e-4 relative (tested). A real
STORMM port re-centers coordinates per work unit; that is the planned fix, not the
int64 store, which is exact.

## Test suite (thresholds are asserted, not aspirational)
- Energy components vs JavaScript f64 use combined relative-or-absolute tolerances.
- Forces vs f64 central differences: rel < 2e-4 (observed ~6e-5), **every atom and
  component** (48/243/576 checked).
- NVE drift, windowed head-vs-tail means over 4000 steps: < 0.5%.
- 192-atom system (above the old 128-atom exclusion cap; masks are now dynamic).
- Overflow: clashed LJ dimer, |E|~2e6, |F|~8e6 vs f64.
- Coordinate range: system at +500 Å (old i32@2^24 coords wrapped at ±128 Å).
- Deterministic replay: two engines, same seeds, 500 Langevin steps — energies and
  positions **bitwise identical**.
- Langevin: mean T of 8 replicas x 4 samples within 300±25 K (~2.6 sigma).
- Coupled O–H constraints at 2 fs: 16 constraints across each of four replicas for
  500 Langevin steps; maximum relative distance error `3.76e-7` and maximum
  dimensionless RATTLE residual `2.76e-8` on the tested laptop GPU.
- Constrained trajectories reproduce bitwise with identical seeds, and replica 1 is
  bitwise identical between one- and four-replica engines. A deliberately insufficient
  one-iteration solve throws with the replica, phase, and final residual.
- Non-finite topology parameters and invalid step counts are rejected before dispatch.

## Molarium OpenMM Reference comparison

The reference harness uses the exact `openmm/molarium-openmm.wasm` shipped with Molarium.
The C++ bridge hard-codes OpenMM's double-precision CPU `Reference` platform. The
WebGPU engine and OpenMM receive identical f32-rounded coordinates and parameter arrays.
Bond, angle, torsion, Lennard-Jones, and Coulomb energies are checked separately. An
additional parameterized case isolates the OBC2/ACE contribution before comparing the
total potential and every analytic force component. A constrained-water dynamics case
runs the same two O–H distances for 500 steps at 2 fs through STORMM SHAKE/RATTLE and
OpenMM Reference CCMA; maximum relative distance errors were `9.67e-6` and `3.50e-7`,
respectively, against a `2e-5` acceptance threshold.

Observed maximums across C16, 27 flexible waters, a charged LJ dimer, and a general
parameterized System with a sixth-order π/2-phase torsion and explicit exception, plus
the same System in OBC2/ACE implicit water:

- isolated implicit-energy absolute error: `4.41e-6 kcal/mol`
- total-energy absolute error: `2.15e-5 kcal/mol`
- force relative RMS error: `6.66e-6`
- maximum force-component absolute error: `9.18e-5 kcal/mol/Å`

Run both suites from the Molarium root:

```sh
bun install
bun run test:stormm-webgpu
bun run test:stormm-openmm
```

For a steady-state timing comparison:

```sh
bun run benchmark:stormm
```

On the tested laptop, a single tiny system favors OpenMM Reference because GPU dispatch
dominates: Reference was 13.3x faster for C16 and 3.5x faster for water27. Homogeneous
replica stacks reverse the result: WebGPU was 10.3x faster for 1024 C16 replicas and
24.1x faster for 256 water27 replicas. These are median warm timings over three samples,
with equal aggregate replica-steps and no context construction or result readback. They
compare throughput, not identical integrator algorithms, and do not yet exercise true
heterogeneous STORMM synthesis.

## Browser usage
```js
import { buildWater, mulberry32 } from './core.mjs';
import { createEngine } from './engine.mjs';
const device = await (await navigator.gpu.requestAdapter()).requestDevice();
const topology = buildWater(3, mulberry32(41));
const eng = await createEngine(device, topology, 1024, { T: 300, thermo: 1, initSeed: 42 });
eng.run(100); await eng.done();
const energies = await eng.readEnergies();   // [{bond,angle,dih,lj,coul,implicit,ke} x nReps]
const positions = await eng.readAllPositions(); // packed vec4f positions for every replica
```

Molarium's **Run → STORMM fixed-point · WebGPU ensemble** method wraps this API in a
module worker. The default Current molecule route first requests the complete numeric
System from Molarium's existing OpenMM/Sage worker, then converts and replicates that
topology. Current molecules can select OBC2/ACE implicit water; the engine computes
Born radii and analytic chain-rule forces separately for every replica. They can also
derive X–H constraints from numeric bond equilibrium distances and use a 2 fs step.
Each replica runs deterministic Gauss-Seidel SHAKE after drift and RATTLE after the
second kick. Position corrections are rounded into the authoritative int64 coordinate
store. The default relative tolerance is `1e-5` with at most 32 iterations; failed
replicas and their final residuals are reported rather than accepted. It retains a
frame-major `frame → replica → xyz` trajectory buffer, shows
all replicas in an energy-colored mosaic, and extracts only the selected replica into
Molarium's existing frame player. The histories are not concatenated. The two validated
builders remain available as optional presets.

## Units & conventions
Angstrom, kcal/mol, amu, ps. a = 418.4·F/m. kB = 0.0019872. Coulomb k = 332.0636.
Integrator: velocity Verlet; optional Langevin (counter-based PCG + Box-Muller,
deterministic given seed); optional general pair-distance SHAKE/RATTLE. LJ mixing:
Lorentz-Berthelot (arithmetic sigma, geometric
epsilon). Torsions and angles avoid WGSL `atan2`/`acos` (spec permits ~1e-4 abs error).

## Scope limits
- Replicas within one engine must share atom counts, topology, and parameters. True
  STORMM-style heterogeneous synthesis needs per-system descriptors, packed atom/term
  offsets, and kernels dispatched over the combined work-unit table.
- All-pairs nonbonded within a replica, one workgroup per replica: practical to
  ~512 atoms/replica (O(N^2)). No neighbor lists, no PBC/minimum image, no PME.
- Parameterized Molarium molecules are supported through `buildParameterizedSystem()`;
  the current all-pairs browser path is capped at 512 atoms per replica. General
  pair-distance constraints and the UI's X–H constraint mode are supported. Constraint
  projection is serial within each replica (replicas remain GPU-parallel), so very large
  constraint graphs are not yet performance-optimized. PBC/PME and barostats remain unsupported.
- OBC2 with mbondi2 radii and the ACE surface term is supported for Current molecule
  stacks without a cutoff. The built-in C16 and explicit-water presets remain vacuum-only.
- f32 arithmetic in kernels (WGSL has no f64); STORMM's double-precision modes
  don't map. Accumulation and coordinate storage are exact fixed-point.
