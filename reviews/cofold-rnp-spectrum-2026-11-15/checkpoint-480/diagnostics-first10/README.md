# Diagnostic breakdown after 10 samples per case

480 completed predictions across 48 cases; 0 execution failures remain in the denominator.

| Observation | Cases |
| --- | ---: |
| selected passing hit | 17 |
| no geometric hit | 17 |
| geometric hits fail limited diagnostics | 5 |
| passing hit not selected | 9 |

33 cases have multiple seeds tied for highest archived ipTM. 6 of those ties mix passing hits and other poses. The crystal-informed passing-hit bounds across these ties are 15–21 cases. These bounds do not recover unrounded confidence or define a prospective selection rule.

The pinned upstream archive writer applies `round2` to summary ipTM ([source](https://github.com/sokrypton/localfold/blob/5ea3d42c911949700401b54003cb28c557fcf2a6/web/fold-archive.js)). Strictly lower reported confidence and a reported-score tie are distinguished below.

| Case | Observation | Passing seeds | Highest-ipTM seeds | Selected seed | Ligand RMSD Å | Protein Cα RMSD Å |
| --- | --- | --- | --- | ---: | ---: | ---: |
| 8cjg__1__1-a__1-d | selected passing hit | 3, 4, 8 | 3, 6, 7 | 3 | 1.467 | 1.065 |
| 8ou2__1__1-a__1-c | selected passing hit | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 | 0 | 1.479 | 0.428 |
| 8j30__1__1-a__1-c | no geometric hit | — | 4 | 4 | 7.654 | 1.369 |
| 8cij__1__1-a__1-b | no geometric hit | — | 1, 2, 4, 5, 6, 7, 9 | 1 | 2.392 | 2.390 |
| 8chc__1__1-a__1-b | geometric hits fail limited diagnostics | — | 1, 3, 4, 5 | 1 | 2.647 | 1.549 |
| 8aqf__1__1-a__1-b | no geometric hit | — | 1, 3, 7, 8 | 1 | 7.601 | 1.646 |
| 8am2__1__1-a__1-d | no geometric hit | — | 6 | 6 | 2.959 | 0.410 |
| 7g00__1__1-a__1-q | selected passing hit | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 | 0, 2, 3, 7, 9 | 0 | 1.031 | 0.796 |
| 8gev__1__1-a__1-b | passing hit tied at highest reported iptm | 5 | 0, 2, 5, 9 | 0 | 2.410 | 0.447 |
| 7u8x__1__1-a__1-b | no geometric hit | — | 1, 2, 4, 6 | 1 | 3.785 | 11.199 |
| 8i2n__1__1-a__1-c | selected passing hit | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 | 3 | 3 | 1.390 | 2.378 |
| 8pqf__1__1-a__1-c | no geometric hit | — | 0 | 0 | 8.367 | 5.433 |
| 8geu__1__1-a__1-b | selected passing hit | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 | 2, 3, 5, 8 | 2 | 1.295 | 0.439 |
| 8swe__1__1-a__1-e | selected passing hit | 0, 1, 2, 3, 4, 5, 7, 8, 9 | 2, 7, 9 | 2 | 1.724 | 0.682 |
| 8pji__1__1-a__1-e | selected passing hit | 0, 2, 8 | 0 | 0 | 1.272 | 1.379 |
| 8pbo__1__1-a__1-c | selected passing hit | 0, 1, 3, 4, 5, 6, 7, 8, 9 | 1, 5, 6, 8, 9 | 1 | 0.858 | 0.671 |
| 7uad__1__1-a__1-b | geometric hits fail limited diagnostics | — | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 | 0 | 0.364 | 1.138 |
| 8u7w__1__1-a__1-c | selected passing hit | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 | 2 | 2 | 1.017 | 0.960 |
| 8gcz__1__1-a__1-n | no geometric hit | — | 0, 1, 2, 3, 5, 7, 8, 9 | 0 | 3.356 | 0.709 |
| 8px8__1__1-a__1-d | passing hit tied at highest reported iptm | 1, 2, 3, 4, 7, 8, 9 | 0, 1, 3, 6, 8, 9 | 0 | 1.419 | 0.180 |
| 8q2y__1__1-a__1-c | no geometric hit | — | 6 | 6 | 6.829 | 0.584 |
| 7szr__1__1-a__1-g | geometric hits fail limited diagnostics | — | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 | 0 | 1.633 | 4.834 |
| 9f40__1__1-a__1-q | no geometric hit | — | 1, 2, 3, 4, 5, 8 | 1 | 3.294 | 1.361 |
| 8crl__1__1-a__1-c | no geometric hit | — | 1 | 1 | 9.358 | 1.601 |
| 8jmo__1__1-a__1-d | passing hits have strictly lower reported iptm | 5, 9 | 3, 6 | 3 | 3.836 | 0.666 |
| 8q34__1__1-a__1-f | no geometric hit | — | 4, 8, 9 | 4 | 6.985 | 0.539 |
| 8gdk__1__1-a__1-o | no geometric hit | — | 1, 3, 8, 9 | 1 | 3.361 | 0.753 |
| 8bo3__1__1-a__1-b | selected passing hit | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 | 2, 5, 9 | 2 | 0.898 | 0.469 |
| 8u7x__1__1-a__1-c | passing hits have strictly lower reported iptm | 1, 5 | 7 | 7 | 1.272 | 1.251 |
| 8i0d__1__1-a__1-b | no geometric hit | — | 1, 4, 8 | 1 | 10.300 | 1.891 |
| 8efj__1__1-a__1-d | selected passing hit | 0, 1, 2, 4, 5, 6, 8, 9 | 8 | 8 | 1.584 | 2.303 |
| 8iqt__1__1-a__1-b | passing hit tied at highest reported iptm | 1, 2, 6 | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 | 0 | 1.554 | 0.647 |
| 8tti__1__1-a__1-e | geometric hits fail limited diagnostics | — | 2 | 2 | 2.408 | 0.585 |
| 8t1y__1__1-a__1-b | selected passing hit | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 | 0, 1, 2, 3, 4, 5, 7, 8, 9 | 0 | 0.782 | 1.333 |
| 8jby__1__1-a__1-c | no geometric hit | — | 1 | 1 | 4.193 | 0.816 |
| 8q2u__1__1-a__1-c | selected passing hit | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 | 1, 2, 3, 4, 5, 6, 7, 8 | 1 | 1.059 | 0.444 |
| 8a3a__1__1-a__1-b | passing hits have strictly lower reported iptm | 2, 4, 5, 7, 8 | 3 | 3 | 6.741 | 0.588 |
| 8sze__1__1-a__1-c | selected passing hit | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 | 1, 2, 5, 6, 7, 8, 9 | 1 | 1.103 | 0.711 |
| 8hlj__1__1-a__1-c | selected passing hit | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 | 0, 3, 6, 7, 9 | 0 | 1.052 | 0.955 |
| 8sx2__1__1-a__1-c | no geometric hit | — | 6 | 6 | 4.456 | 6.587 |
| 9f41__1__1-a__1-q | no geometric hit | — | 1, 4, 5, 6, 7, 8, 9 | 1 | 2.897 | 1.146 |
| 8usm__1__1-a__1-c | passing hits have strictly lower reported iptm | 2, 3, 5, 7, 8 | 9 | 9 | 5.500 | 0.919 |
| 8t27__1__1-a__1-b | passing hits have strictly lower reported iptm | 4 | 1, 9 | 1 | 1.627 | 2.786 |
| 8b62__1__1-a__1-c | geometric hits fail limited diagnostics | — | 2, 4 | 2 | 1.986 | 1.173 |
| 8a2p__1__1-a__1-b | selected passing hit | 0, 1, 2, 3, 4, 5, 7, 9 | 2, 4, 5, 6 | 2 | 1.813 | 0.716 |
| 8pp8__1__1-a__1-d | no geometric hit | — | 1, 7 | 1 | 4.299 | 1.383 |
| 8t9v__1__1-a__1-b | passing hit tied at highest reported iptm | 9 | 2, 9 | 2 | 2.952 | 1.127 |
| 8gww__1__1-a__1-c | selected passing hit | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 | 5, 7 | 5 | 1.552 | 1.334 |

Categories describe the completed outputs. They do not identify a causal preparation, quantization or kernel defect. Limited diagnostics are not full physical validation, and a low global protein RMSD does not certify the pocket. All details and source hashes are in [diagnostics.json](diagnostics.json).
