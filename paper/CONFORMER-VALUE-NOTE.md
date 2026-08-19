# Development note: does STORMM improve the RDKit seed pool?

This note records an early development screen. It is evidence about the current implementation, not
yet a publication-quality benchmark.

## Comparison

RDKit ETKDGv3 generated up to 64 symmetry-pruned conformers per molecule and briefly polished each
with MMFF94, or UFF when MMFF94 was unavailable. The same retained coordinates were then passed to
the STORMM-style WebGPU lane. The `thorough` schedule used 2,500 Langevin steps split across 600 K,
450 K, and 300 K, plus 240 fixed-step Sage relaxation iterations.

Both the untouched RDKit conformers and the STORMM outputs were evaluated on their exact coordinates
with one OpenMM Reference judge: OpenFF Sage 2.1, OBC2/ACE implicit water, X–H constraints, and no
nonbonded cutoff. “Best gain” is the lowest RDKit-seed energy minus the lowest STORMM energy, so a
positive value favors STORMM. The run used the fixed seed `20260817` in Chrome 151 on arm64.

| Molecule | Retained seeds | Best gain (kcal/mol) | Same-seed pairs improved | Structurally new STORMM clusters | STORMM-only clusters within 3 kcal/mol |
| --- | ---: | ---: | ---: | ---: | ---: |
| n-hexane | 13 | -0.695 | 2/13 | 2 | 2 |
| n-octane | 37 | -0.434 | 5/37 | 9 | 4 |
| 1-octanol | 55 | +1.533 | 7/55 | 23 | 8 |
| ethyl butyl ether | 33 | -0.880 | 3/33 | 7 | 5 |
| ethyl hexyl ether | 58 | -0.304 | 3/58 | 31 | 14 |
| aspirin | 2 | +8.570 | 2/2 | 0 | 2 |
| ibuprofen | 18 | +3.782 | 17/18 | 3 | 9 |
| lidocaine | 8 | +0.560 | 2/8 | 0 | 0 |

Across the eight molecules, STORMM found the lower minimum for four. The median molecule-level best
gain was only **+0.128 kcal/mol**. It improved **41/224 (18.3%)** of the paired starting conformers.
It did, however, contribute 75 clusters absent from the untouched seed lane; 44 clusters were within
3 kcal/mol in the STORMM lane but not in the untouched seed lane. The latter includes both genuinely
new structural clusters and existing clusters that STORMM moved into the low-energy window.

The shorter `balanced` schedule was worse: STORMM found the lower best conformer for two of eight
molecules, and the median molecule-level best gain was -0.879 kcal/mol. The extra relaxation in the
`thorough` schedule therefore matters, but does not make the energetic improvement general.

## Implementation parity

The STORMM-reported energies were compared automatically with OpenMM on the same coordinates at every
saved search stage. All eight runs passed. The largest absolute difference in the table above was
`5.03e-5 kcal/mol`; the configured absolute tolerance is `2e-4 kcal/mol`. The mixed conformer-quality
result is therefore not explained by an energy mismatch between the WebGPU engine and the judge.

## Defensible conclusion

The current prototype demonstrates fast batched exploration and additional conformational diversity.
This small panel does **not** establish that it generally produces lower-energy conformers than the
RDKit seed pool. Aspirin and ibuprofen are encouraging examples, while hydrocarbons and ethers show
that the fixed-step post-annealing minimizer is not yet reliable enough.

Before using a quality claim in the paper:

1. replace the fixed-step final relaxation with a convergent per-replica optimizer and retain the
   best-seen geometry for each replica;
2. freeze a larger chemically diverse panel and run several independent random seeds;
3. report confidence intervals across molecules, not only pooled conformers;
4. add reference-conformer recall and an independent higher-level energy oracle for a tractable
   subset; and
5. keep throughput, diversity, and energetic quality as separate claims.

Reproduce the current screen with:

```sh
bun run benchmark:conformer-value -- --conformers 64 --effort thorough
```
