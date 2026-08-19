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

