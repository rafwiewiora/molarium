# Simulation readiness: two user-reported defects

## SR-08 — prepared protein rejected after ligand editing

**Finding.** [PR #31](https://github.com/rafwiewiora/molarium/pull/31) rejected
protein calculations whenever the numerical System was absent. Builder edits
must invalidate that System, so this also rejected already-prepared systems.
Re-running PDB/CCD preparation would risk replacing the user's edited ligand.

**Fix.** [calculation-readiness.mjs](../calculation-readiness.mjs) preserves
successful parameterization provenance when builder/registered graph edits
discard parameters. An arbitrary `modified-after-preparation` status is not
accepted as evidence. Older edited snapshots with an actual parameterization
audit remain supported. `runCalculation` in [app.js](../app.js) retypes edited
current Systems without re-running protein preparation or moving coordinates.
The new numerical System replaces—not reuses—the stale one. Truly unprepared
proteins still fail early with `Please prepare protein`. Pending edits must first
be finished or discarded. Force-field assignment is the existing Sage pathway;
this is not a new protein force field or a force-field quality claim.

## SR-09 — 7KPA blows up when dynamics starts without minimization

**Finding.** Protein preparation relaxes selected polar hydrogens, not the full
System. The Simulate path previously dispatched MD directly. On the public 7KPA
fixture, prepared through the normal browser workflow (6,903 atoms), WebGPU with
OBC2, X–H constraints, a 2 fs timestep and 250 steps reproduced the report:

| Same prepared starting System | Initial energy | Final energy | Ligand-centre displacement |
| --- | ---: | ---: | ---: |
| MD directly | 5,154.84 kcal/mol | 8.01 × 10⁹ kcal/mol | 1,573.46 Å |
| MD after 750 WebGPU minimization iterations | −5,345.80 kcal/mol | −3,241.83 kcal/mol | 0.425 Å |

The minimization itself moved the ligand centre by only 0.025 Å. These are raw
coordinate measurements, not a camera/alignment artifact. The browser OpenMM
**WebAssembly Reference** worker also returned `OpenMM calculation failed` on
the unminimized input in the initial diagnostic run; this was **not** a native
OpenMM comparison. The bounded reproduction records failure or timeout as such.

**Interpretation and limits.** Starting strain is a demonstrated trigger in this
fixture: removing it prevents the catastrophic short-run outcome. This does not
identify one offending atom/term, establish equilibration, prove long-time
stability, or validate ligand binding. Both the preparation model and integrator
remain experimental. The direct WebGPU worker/shared runtime configuration were
last changed on 5 September, before the latest preparation-message fix; there is
no evidence that PR #31 changed dynamics. Earlier runs might have had minimized
coordinates or different settings; the user's earlier state is not available.

**Fix.** The checked **Minimize before first simulation** option runs a visible
full-current-System minimization (750 iterations, tolerance 5 where used by the
engine) before first MD. OpenMM uses OpenMM; WebGPU uses WebGPU; current-system
STORMM uses WebGPU for this preflight. Independent built-in ensemble fixtures
are outside this current-system policy. Minimized states and their subsequent
MD endpoints are reused only when exact coordinates, chemistry, numerical
parameters, engine, solvent, constraints and cutoff match. Edits and manual
coordinate/frame changes therefore required new minimization in PR #32. The
[SR-12 follow-up](SIMULATION_UI_CACHE_2026-09-10.md) recognizes exact saved MD
frames under the unchanged numerical protocol, including display alignment. A successful
manual **full-system** minimization qualifies; partial ligand/pocket minimization
does not. Duration and temperature changes alone do not erase minimization.
Repeated jobs retain the existing velocity-initialization behavior; they are not
promised to be one continuously integrated trajectory.

Preflight rejects failed, non-finite or energy-increasing minimization before
starting MD; it does not claim that a bounded minimization reached convergence.
Unchecking the option (API `options.minimizeBeforeDynamics:false`) deliberately
skips preflight and is reported as such. The API result/action audit and result
panel distinguish performed, reused and disabled preflight; performed preflight
records input/output hashes, energies, protocol, parameter source and timing.
Worker-level fixed-input benchmarks remain unchanged and intentionally bypass
this application policy. Frozen SOS1 evidence, movies and submitted paper files
are not rewritten.

## Checks and reproducible evidence

- [Pure readiness tests](../calculation-readiness.test.mjs): preparation history,
  repeated invalidation, raw-PDB rejection, exact-state/protocol invalidation,
  failed/zero-step/partial-minimization rejection.
- [Original negative browser test](../scripts/unprepared-protein.browser.test.mjs):
  five engines, exact notice, no dispatch/motion, prepared and small-molecule controls.
- [Browser regression](../scripts/calculation-readiness.browser.test.mjs): real
  first/repeated/manual minimization, settings changes, explicit/API and actual
  Run-button opt-out; builder edits on a prepared protein followed by numerical
  retyping with identical edited atoms, bonds and coordinates. Included in CI.
- [7KPA diagnostic and bound-ligand edit](../scripts/7kpa-dynamics-startup.browser.mjs)
  and [recorded output](./7kpa-dynamics-startup-2026-09-10.json): physical Apple
  WebGPU, ordinary public preparation and chemistry actions, direct-worker
  minimized/unminimized comparison and application preflight. This connected-mode
  diagnostic retrieves public RCSB ligand definitions and is not a network-free CI test.

```sh
node --test calculation-readiness.test.mjs
MOLARIUM_TEST_API=1 bun scripts/calculation-readiness.browser.test.mjs
MOLARIUM_TEST_API=1 bun scripts/7kpa-dynamics-startup.browser.mjs --output /tmp/7kpa-startup.json
```
