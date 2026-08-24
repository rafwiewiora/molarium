# Native pose validation: pyrazole, tetrahydropyran and spiro analogues

Date: 2026-08-23

## Question

Do the browser models reproduce independent native implementations on the high-disruption 7KPA
analogue poses, and is the spiro-ketone control only a receptor clash or also an intrinsically
strained ligand geometry?

## Preregistered execution boundary

The browser generated every pose through public Chemist Actions. A read-only harness then inspected
the complete ligand, reordered coordinates by persistent atom ID into the exact refinement System,
and invoked the production browser workers without mutating the live molecule. The packet converter
failed closed on atom-order, topology, coordinate, force-array or numeric-System hash differences.

The 24-pose CPU panel was scored with RDKit MMFF94 and native OpenMM Reference. A deterministic
shortlist retained all unique feasible poses or, for a case with no feasible pose, the best distinct
negative control. One serialized NVIDIA L4 task scored those five poses with native OpenMM Reference,
OpenMM CUDA double deterministic and TorchANI ANI-2x. Browser single points were already embedded in
the hash-checked packets.

## Infrastructure debugging record

1. The first environment specification requested a CUDA metapackage unavailable in the selected
   conda channels. No scientific job ran.
2. A temporary inherited Python environment could load PyTorch/TorchANI, but its pip OpenMM build had
   no CUDA platform. The five-pose GPU attempt failed in five seconds and produced no scientific
   result.
3. A clean prefix was rebuilt with conda-forge OpenMM 8.2 plus pinned PyTorch 2.7.1 and TorchANI
   2.8.1. Reference, CPU and CUDA OpenMM platforms were enumerated before submission.
4. Four CPU shards completed the 24 poses. One L4 task completed the five-pose shortlist in 39
   seconds with zero engine failures.
5. A reporting-only follow-up upload was rejected by the cloud payload-safety guard. It was not
   bypassed. The original immutable outputs were retained; fixed gate logic and tests were added
   locally for subsequent runs.
6. The original browser OpenMM artifact then failed against native OpenMM despite matching browser
   WebGPU. Atom order, topology, coordinates and the numeric System were rechecked before changing
   any scientific threshold. The failure was retained in the record.
7. OpenMM 8.2.0 was rebuilt from the official hash-pinned source archive with Emscripten 6.0.6.
   The identical C bridge was separately linked to native OpenMM 8.2. The five poses agreed to
   2.84e-14 kcal/mol maximum energy error and 3.76e-15 maximum force relative RMS.
8. A fresh Chrome validation explicitly requested vacuum, no constraints and no nonbonded cutoff.
   Every configured numeric-System hash equalled its packet hash. Browser Sage WebGPU agreed with
   rebuilt OpenMM/WASM to 1.24e-4 kcal/mol and 1.16e-5 force relative RMS at worst.

## Results and decisions

- Browser ANI-2x versus native TorchANI passed: energy delta 0.00277–0.06312 kcal/mol and force
  relative RMS 3.06e-6–3.48e-6.
- Native OpenMM Reference versus CUDA passed: energy delta 4.29e-5–1.11e-4 kJ/mol and force relative
  RMS 1.21e-6–1.30e-6.
- Rebuilt OpenMM/WASM versus the same bridge linked to native OpenMM 8.2 passed: energy delta
  0–2.84e-14 kcal/mol and force relative RMS 2.68e-15–3.76e-15.
- Browser Sage WebGPU versus rebuilt OpenMM/WASM passed: energy delta 4.07e-5–1.24e-4 kcal/mol and
  force relative RMS 1.01e-5–1.16e-5. The cross-runtime Sage gate therefore passes for these five
  fixed poses.
- The superseded WASM artifact's 3.849–4.757 kcal/mol mismatch is retained as a failed intermediate
  result. It lacked complete build provenance; the clean rebuild uses a different binary hash. The
  precise historical build difference cannot be reconstructed from that binary alone.
- The spiro geometry relaxed by 36.845 kcal/mol under ANI-2x (0.203 Å aligned heavy-atom RMSD) and
  41.985 kcal/mol under MMFF94. It is intrinsically strained as drawn in addition to its severe
  receptor clash. Receptor clash still dominates the pose-level physical warning.

## Interpretation limits

Absolute ANI or MMFF energies are not compared between analogues with different compositions.
Relaxation drops are same-graph strain diagnostics. None of these calculations is a binding free
energy. The passing result is deliberately narrow: five hash-selected poses, one exported Sage
numeric System per pose, vacuum, no cutoff, and no constraints. It validates execution parity, not
the accuracy of Sage for binding affinity, the quality of pose generation, or transfer to arbitrary
chemistry. The old failure remains visible because replacing a runtime artifact is remediation, not
evidence that the original binary was correct.

The exact hashes, software versions, thresholds and result hashes are recorded in
`docking/validation/cloud-panel/RESULTS-2026-08-23.md`.
