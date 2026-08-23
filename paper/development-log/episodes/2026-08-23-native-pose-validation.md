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

## Results and decisions

- Browser ANI-2x versus native TorchANI passed: energy delta 0.00277–0.06312 kcal/mol and force
  relative RMS 3.06e-6–3.48e-6.
- Native OpenMM Reference versus CUDA passed: energy delta 4.29e-5–1.11e-4 kJ/mol and force relative
  RMS 1.21e-6–1.30e-6.
- Browser Sage WebGPU versus bundled OpenMM/WASM passed: energy delta 4.63e-5–2.76e-4 kcal/mol and
  force relative RMS 1.01e-5–1.16e-5.
- Bundled OpenMM/WASM versus native OpenMM Reference failed: energy delta 3.849–4.757 kcal/mol and
  force relative RMS 0.0423–0.0444. Browser Sage versus native CUDA consequently failed by the same
  scale. This is retained as an unresolved validation failure, not normalized away.
- The spiro geometry relaxed by 36.845 kcal/mol under ANI-2x (0.203 Å aligned heavy-atom RMSD) and
  41.985 kcal/mol under MMFF94. It is intrinsically strained as drawn in addition to its severe
  receptor clash. Receptor clash still dominates the pose-level physical warning.

## Interpretation limits

Absolute ANI or MMFF energies are not compared between analogues with different compositions.
Relaxation drops are same-graph strain diagnostics. None of these calculations is a binding free
energy. The passing browser-WebGPU/bundled-WASM and native-Reference/native-CUDA pairs do not rescue
the failed cross-runtime Sage comparison; release claims must keep those statements separate.

The exact hashes, software versions, thresholds and result hashes are recorded in
`docking/validation/cloud-panel/RESULTS-2026-08-23.md`.
