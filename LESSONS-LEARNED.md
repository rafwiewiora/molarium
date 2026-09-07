# Molarium lessons learned

This file records implementation findings that changed a product or engineering decision. Measurements
belong here only when their system, runtime, and timing boundary are clear.

## A feasible pose can satisfy a silently weakened question

The [September 6 design-function panel](./reviews/DESIGN_FUNCTION_VALIDATION_2026-09-06.md)
found that registered CDK2 chlorination yielded 23/64 feasible candidate chains only after an
unavailable, previously required water contact was automatically omitted. Validate the required
contact **set across actions**, not merely each final candidate's `feasible` flag.

Atom lineage is not a motion policy: that step deliberately samples an affected attachment torsion,
releasing five inherited ring atoms while the remaining 19-atom core stays exactly fixed.
Measure both sets. After receptor relaxation, remeasure contacts from live atom coordinates;
cached candidate distances and captured receptor points need not describe the visible complex.

The [public Design finding-to-fix ledger](./reviews/DESIGN_FINDINGS_AND_FIXES_2026-09-06.md)
keeps each original observation linked to its implementation and regression evidence. Correcting
software does not turn a frozen failed experiment into a historical pass. Required/optional contact
intent, feature availability, candidate satisfaction, and current geometry are distinct state and
must stay distinct in both the API and interface.

The subsequent source-stable remediation showed a second layer: CDK2's N7–water contact looked
missing because graph staging regenerated the unchanged donor H with a new ID. Preserving the
single H under strict unchanged-chemistry/local-geometry conditions recovered both original
contacts without omission. Fail-closed behavior prevents a false pass; repairing the identity
cause restores the legitimate workflow. Changed chemistry and multi-H ambiguity still need an
explicit correspondence decision, not the same automatic repair.

Help text is part of the scientific contract. Explain what moves and what is enforced at the
operation's control: constrained ligand propagation, unrestrained pocket minimization, induced-fit
backbone motion, and discrete rotamer application answer different questions. An **i** button
should clarify those differences, not replace an explicit warning or fail-closed action guard.

## A cutoff is not automatically faster

The direct WebGPU engine has a correct, OpenMM-compared 1.0 nm nonperiodic cutoff path with a 1.2 nm
Verlet list. Its first implementation builds that list by checking every atom pair every 20 steps and
then gathers force data through indirect neighbor-buffer reads.

On Chrome 151 using the Apple M1 Pro Metal WebGPU adapter, warmed OBC2/ACE dynamics with X-H
constraints and a 2 fs step gave:

| System | Run | No cutoff | 1.0 nm cutoff | Outcome |
|---|---:|---:|---:|---:|
| Rosemary Trp-cage, 304 atoms | 5,000 steps | 1,430 steps/s | 772 steps/s | cutoff 46% slower |
| Rosemary ubiquitin, 1,231 atoms | 1,000 steps | 340 steps/s | 282 steps/s | cutoff 17% slower |

The 1.2 nm list contains about 71% of all directed pairs for compact Trp-cage and 32% for ubiquitin.
At these sizes, list construction and irregular memory access cost more than the skipped arithmetic.
A cutoff also changes the Hamiltonian, so its energy is not expected to match a no-cutoff run.

Decision: user-facing calculations use no cutoff and expose no cutoff selector. The existing cutoff
code remains reachable by validation tests while a spatial neighbor-list implementation is developed.

## Force agreement does not guarantee accurate energy reduction

The September 5 direct-worker suite found an isolated ubiquitin Lennard–Jones energy error
of 1.45668 kJ/mol despite close force agreement. Replacing serial f32 accumulation with
per-atom partial sums and a tree reduction reduced the error to 0.000626 kJ/mol without
changing the force calculation or acceptance tolerance. Keep isolated-term energy tests,
not only total energies that can cancel. [Raw before/after evidence](./benchmarks/simulation/README.md#regression-discovered-by-this-suite).

## State exactly which numerical inputs agree

The full 47-case direct-worker suite passes against native Reference on identical f32 inputs
on M1 Pro and L4, but only 42/47 pass against original double-valued inputs. Translated and
near-minimum structures expose f32 coordinate limits. Native CUDA double passes the original
inputs too. Keep original, packed, and quantization comparisons separate, and select the
native original observation when reporting original-input agreement.

## Validate complete requests and complete outputs

A returned result is not enough: require finite energy and exactly 3N Cartesian forces,
unique expected case IDs, reviewed protocol bytes, and explicit suite coverage. An empty
suite, silently ignored force class, or missing frame is not evidence of correctness.
The [Astra review](./reviews/ASTRA_REVIEW_OF_SOL_WORK_2026-09-05.md) preserves the original
worker-boundary defects and appends their fixes and negative regression tests.

## Keep oracles and execution boundaries independent

WASM OpenMM checks are useful compatibility diagnostics, not modern GPU performance
baselines. The direct-worker native oracle builds analytic OpenMM forces independently
from the numeric System; shared parameter assignment is still not independently validated.
STORMM-worker/native OpenMM coverage uses its own supported-case and original-input gate.
Its Å/kcal parameter packing is not the direct worker's f32-nm packing. Frozen-evidence CI verifies
archived results; it does not dispatch today's GPU kernels. Report fresh correctness runs
separately, and never equate resident native-Context timing with browser whole-job timing.

## Static scoring must preserve the supplied pose

Constraints on a System are not permission to project a fixed-pose scoring input. STORMM's
old score-batch initialization applied SHAKE before its first energy read. Read-only evaluation
now preserves the coordinates and labels constraints as not applied; dynamics still projects
them. A deliberately unsatisfied analytic constraint checks both the coordinates and forces.

## A local URL does not make an entire checkout safe to serve

Default both server modes to loopback, explicitly declare public files, reject dotfiles and
foreign Host headers, and check canonical paths for symlink escape. Browser tests use
OS-allocated server ports and visible startup errors; random port ranges and unread stderr
can conceal a dead server or point a test at another process.

## Navigation races need traces that do not overwhelm the timing

Wrapping every stream, digest, and database promise made the checkpoint-import hang disappear
in early probes. Sparse non-pausing stage markers reproduced it at `indexedDB.open`, after
asset transport and SHA verification had already completed. Connection cleanup alone did not
recover the case. Deferring database initialization on blank reproduction landing pages,
alongside lifecycle cleanup and bounded explicit errors, passed ten repeated navigation imports.
Preserve both failure and recovery traces; do not call a passing instrumented run a root-cause
diagnosis or silently replace a failed durable save with volatile in-memory state.
