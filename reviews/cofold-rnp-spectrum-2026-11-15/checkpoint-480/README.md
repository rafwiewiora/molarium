# Recorded results at 10 samples per case

480 completed predictions and 0 failed executions across 48 planned cases. Failures remain in every planned denominator.

| Selection | Cases |
|---|---:|
| Any geometric <2 Å pose, using the experimental answer | 31/48 (64.58%) |
| Any <2 Å pose passing limited stereo/clash checks | 26/48 (54.17%) |
| Highest reported ipTM, passing <2 Å pose | 17/48 (35.42%) |

Any-hit selection is retrospective and uses the crystal answer. Confidence selection uses the highest archived ipTM and the lowest seed for ties, with no crystal or validity filtering before ranking. The upstream archive rounds ipTM to two decimals; ties do not recover unrounded confidence.

| Uniform samples per case | Any geometric hit | Any passing hit | Confidence-selected passing hit |
|---:|---:|---:|---:|
| 1 | 22/48 (45.83%) | 16/48 (33.33%) | 16/48 (33.33%) |
| 3 | 26/48 (54.17%) | 21/48 (43.75%) | 16/48 (33.33%) |
| 6 | 28/48 (58.33%) | 25/48 (52.08%) | 17/48 (35.42%) |
| 10 | 31/48 (64.58%) | 26/48 (54.17%) | 17/48 (35.42%) |

17/48 native-qualified cases have no browser geometric <2 Å hit after 10 planned samples.

Among cases with a limited-diagnostic-passing native hit, any passing browser hit is 24/41 (58.54%). 7 selected cases lack a native hit passing those limited checks.

17/41 cases with a passing native hit have no passing browser hit at this sample budget.

| Published training-similarity interval | Cases | Any passing hit | Confidence-selected passing hit |
|---|---:|---:|---:|
| [0,25) | 1 | 1/1 (100.00%) | 1/1 (100.00%) |
| [25,50) | 12 | 5/12 (41.67%) | 4/12 (33.33%) |
| [50,75) | 18 | 9/18 (50.00%) | 6/18 (33.33%) |
| [75,100] | 17 | 11/17 (64.71%) | 6/17 (35.29%) |

The 48 selected cases contain 43 exact protein sequences and 36 published clusters. Similarity is ligand SuCOS shape times pocket coverage to pre-June-2023 training examples, not sequence identity. The lowest-similarity bin has one case instead of the intended three; the shortfall is retained.

This is a selected native-positive reconstruction cohort. Native predictions were reused and independently rescored; their historical cached ligand topology and RDKit version are unavailable. Deterministic declared-SMILES/name reconstruction is explicit. Native/browser preparation and sampling differ. These counts establish neither population accuracy nor numerical implementation parity. The stereo/clash diagnostics are limited checks, not full physical validation.

Protocol: pristine LocalFold, raw declared SMILES, query plus up to 255 unique published MSA rows, 200 diffusion steps, and three additional recycles/four trunk passes. Experimental references are used only for scoring/display in the frame of all observed corresponding Cα atoms; there is no pocket fit or independent ligand alignment.

[All case-level outcomes and confidence ties](diagnostics-first10/README.md) · [All original poses for local human review](review-libraries/README.md) · [Original assembly notes and case table](assembly-README.md) · [Sampling and launcher-time plots](sampling-plots/manifest.json) · [Similarity plot](similarity-plots/manifest.json)

Launcher timing includes browser startup, available asset loading, folding, confidence and archive checks. Concurrent analysis and system conditions affect it. It is not isolated GPU kernel timing, screening throughput, or a cross-device speed comparison.
