# Molarium bioisostere pose-propagation benchmark v0.1.0 — registered result

Status: **frozen, complete, locally validated**

Execution date: 2026-08-22

Dataset: `molarium-bioisostere-pose-propagation-25`

This is the first registered result for the 25-case cohort. It evaluates reference-pose
propagation and role-compatible interaction transfer; it is not a binding-affinity benchmark and
does not establish prospective pose accuracy.

## Outcome summary

| Tier | Registered | Result |
| --- | ---: | --- |
| Paired crystal | 10 | 5 completed and crystal-scored; 5 stopped at pre-registered preparation blockers |
| Prospective bioisostere | 10 | 7 feasible; 1 no feasible pose; 1 reference contact unavailable; 1 unsupported parameterization |
| Adversarial negative | 5 | 4/4 runnable cases remained infeasible; 1 unsupported parameterization; 0 false transfers |

The prospective feasibility rate is 7/10 over every registered proposal (70.0%; 95% Wilson CI
39.7–89.2%) and 7/8 among cases that reached pose search (87.5%; 52.9–97.8%). This is workflow
feasibility, not docking accuracy. Four of five registered negatives produced the intended
infeasible outcome (80.0%; 37.6–96.4%); among runnable negatives the rate was 4/4 (100%;
51.0–100%).

Terminal outcomes over all 25 cases were: 12 `success-feasible`, 4
`success-infeasible-negative-control`, 5 `preparation-blocked`, 2
`parameterization-unsupported`, 1 `reference-contact-unavailable`, and 1 `no-feasible-pose`.

## Withheld paired-crystal pose accuracy

The analogue crystal was never present in the browser run input. After pose generation, the scorer
aligned Cα atoms from the ligand-assigned protein chain and applied the frozen
product-index-to-CCD-atom-name map. Values below are label-mapped heavy-atom RMSD without symmetry
correction.

| Reference → analogue | Receptor fit (Å) | Median top-1 (Å) | Median best-of-5 (Å) | Best observed/15 (Å) |
| --- | ---: | ---: | ---: | ---: |
| PARP2 4ZZY/D7N → 4ZZX/FSU | 1.387 | 1.484 | 1.353 | 1.091 |
| PPARγ 5Y2O/8N6 → 5Y2T/8LX | 0.585 | 4.720 | 4.720 | 3.342 |
| PPARγ 5Y2O/8N6 → 7AWC/BRL | 0.932 | 3.500 | 3.500 | 1.905 |
| TTR 4DER/AGI → 4DEU/NAR | 0.232 | 3.163 | 3.163 | 3.163 |
| CDK2 1H1Q/2A6 → 1H1R/6CP | 0.343 | 1.057 | 1.057 | 1.057 |

Across the five scored pairs, median top-1 RMSD and median-of-repeats best-of-five RMSD were both
3.163 Å. Two of five cases were within 2 Å by either repeat-median measure. If the single best pose
over all three registered seeds is used instead, the median was 1.905 Å and three of five cases were
within 2 Å. The corresponding 95% Wilson intervals are 11.8–76.9% (2/5) and 23.1–88.2% (3/5).
The latter is labeled as best-observed rather than presented as the primary estimate. These small
counts carry wide uncertainty and are reported as an initial engineering validation, not a
competitive docking claim.

## Preserved failures

- TTR 4DES references stopped on a 0.476 Å generated nonbonded clash.
- BACE1 2VA5 and 2VA6 stopped with seven heavy atoms that template repair could not supply.
- CDK2 1H1R stopped on a 0.505 Å generated nonbonded clash.
- The 7KPA pyridone→cyclohexanone proposal reached search but found no feasible pose. The current
  single-anchor placement cannot explore the ring-pucker/radial change needed to satisfy the
  transferred carbonyl contact; this motivates constrained ring embedding rather than case-specific
  tuning.
- BRD9 carbamate→urea stopped because the frozen reference contact was unavailable after registered
  preparation.
- Both PARP1 cases stopped at the same unsupported parameterization boundary.

## Integrity and validation

- Frozen manifest SHA-256: `8d8a0840567321010ddd8600236b6e7ada1a177f16cbeeb22ad847bfce95e502`
- Blinded run-input SHA-256: `25ff5847f92c5ef1629160079641e93550303440dc737cc68d23bdb66518977c`
- Registered-result SHA-256: `285536d0557a7e1d1d8a677bf36e6aa165125eae520348a8fb9ccd22a36ea061`
- Scored-report SHA-256: `a378fb2a7bf9ab95b3ca18697037f79d4decbe5ce490c33617f6e1228ebf2359`
- Search: 16 deterministic chains × 3 frozen seeds for each runnable case.
- Focused unit protocol: pass.
- Browser contact-remap suite: 68/68 pass.
- Registered manifest: 25/25 pass.
- Registered result validator: 25/25 pass.

The machine-readable registered report retains the complete per-repeat coordinates and hash-linked
labbooks. The compact scored report contains only terminal outcomes and withheld-crystal metrics.
