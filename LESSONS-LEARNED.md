# Molarium lessons learned

This file records implementation findings that changed a product or engineering decision. Measurements
belong here only when their system, runtime, and timing boundary are clear.

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
The [Astra review](./reviews/ASTRA_REVIEW_OF_SOL_WORK_2026-09-05.md) records the remaining
worker-boundary defects separately from the corrected scorer.

## Keep oracles and execution boundaries independent

WASM OpenMM checks are useful compatibility diagnostics, not modern GPU performance
baselines. The direct-worker native oracle builds analytic OpenMM forces independently
from the numeric System; shared parameter assignment is still not independently validated.
STORMM-worker/native OpenMM coverage remains a separate task. Frozen-evidence CI verifies
archived results; it does not dispatch today's GPU kernels. Report fresh correctness runs
separately, and never equate resident native-Context timing with browser whole-job timing.
