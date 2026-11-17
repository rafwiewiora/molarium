# Runs N’ Poses: larger native-positive stock LocalFold comparison

**Status: all 480 predictions completed and passed independent replay.**
Ten seeds were run for every preselected system through the pristine original
LocalFold page on physical Apple Metal-3 WebGPU: 200 diffusion steps and four
trunk passes. All inputs were frozen before inference, with the query plus up to
255 unique published alignment rows. The frozen plan SHA-256 is
`797454ec8d2766485a96cfb13326511f0333efa7b89bb656968f84b2844ad349`.
A host restart was recovered without repeating a completed prediction.

The [final report and all original outputs](checkpoint-480/README.md) retain
all 480 planned predictions, source-attempt histories and sampling receipts.
The [six-sample](checkpoint-288/README.md), [221-prediction](checkpoint-221/README.md)
and initial checkpoints remain preserved. The earlier
[80-prediction study](../cofold-stock-localfold-2026-11-13/results-200x10/README.md)
is a separate cohort. Final [ten-sample browser QA](review-ui-2026-11-16/README.md)
also passed all 48 systems. The separate
[NVIDIA component controls](../cofold-feature-parity-2026-11-13/gpu-capability-2026-11-16/numerical-2026-11-17/README.md)
remain pending. The completed pose study and reviewer are public in
[merged PR #56](https://github.com/rafwiewiora/molarium/pull/56); numerical
qualification is tracked separately.

The public [Runs N’ Poses dataset](https://zenodo.org/records/18366081) and
[repository](https://github.com/plinder-org/runs-n-poses/tree/197fafc60a5cef3a9e7f8a4b0dac7c965eed3839)
provide experimental complexes, actual sequence/SMILES declarations and published
Boltz-2 predictions. We reuse these predictions rather than rerunning native
inference. We first screen for published native RMSD <2 Å, then independently
score saved native coordinates against the experimental ligand in the frame of
**all observed corresponding protein C-alpha atoms**. There is no pocket fit,
trimming, or independent ligand alignment.

| Stage | Cases | Comment |
|---|---:|---|
| Frozen representable candidate pool | 147 | One canonical protein, one connected 15–60-heavy-atom ligand, 60–700 residues, release after 1 June 2023 |
| Independent native qualification | 113 | At least one rescored saved Boltz-2 pose strictly below 2 Å |
| Selected follow-up | 48 | Stable hash order; at most two cases per exact sequence and three per supplied RnP cluster |
| Distinct selected protein sequences / clusters | 43 / 36 | Related cases remain identifiable |
| Selected cases with a stereo/clash-passing native hit | 41 | Seven geometric-only successes remain flagged separately |
| Independently verified browser predictions | 480/480 | All ten seeds for all 48 cases; zero execution failures |

| Training-similarity bin | Candidate pool | Native-qualified | Selected | Predeclared target |
|---|---:|---:|---:|---:|
| [0,25) | 3 | 1 | 1 | 3 |
| [25,50) | 20 | 17 | 12 | 12 |
| [50,75) | 81 | 63 | 18 | 18 |
| [75,100] | 43 | 32 | 17 | 17 |

Similarity is the published `sucos_shape_pocket_qcov_2023`: ligand SuCOS shape
similarity times pocket coverage to a closest training system before 1 June
2023. It is **not sequence identity**. We retain the two-case low-bin shortfall
instead of filling it with higher-similarity cases. The other two low-bin
candidates fail exact reference-SDF versus inference-input chemical-state
agreement. Across all 147 candidates, 17 fail that chemical-state gate, 11
contain unsupported modified protein residues, and six have no independently
rescored full-frame native hit. Exclusions and all selection decisions are saved.

## Ten predictions per system

There is a geometric <2 Å hit in **31/48 cases**. In **26/48 (54.17%)**, at least
one <2 Å pose also passes the limited stereo/clash checks. Selecting the highest
archived ipTM, with the fixed lowest-seed tie rule and no validity filtering before
ranking, gives **17/48 (35.42%)** passing hit cases. Any-hit selection uses the
experimental answer; it is not an automated pose-selection policy.

Thus **17/48 native-positive systems still have no browser geometric hit**.
Five more systems have only near-native poses that fail the limited diagnostics.
In the subset with a diagnostic-passing native hit, **24/41 (58.54%)** contain
any passing browser hit, leaving 17/41 without one.

| Uniform samples per case | Any geometric <2 Å hit | Any passing <2 Å hit | Highest-ipTM passing <2 Å hit |
| ---: | ---: | ---: | ---: |
| 1 | 22/48 | 16/48 | 16/48 |
| 3 | 26/48 | 21/48 | 16/48 |
| 6 | 28/48 | 25/48 | 17/48 |
| 10 | 31/48 | 26/48 | 17/48 |

Four additional samples beyond six add one passing-hit system. Confidence-selected
passing hits remain 17/48. The archived ipTM is rounded to two decimals: 33 cases
have top-score ties, six mixing passing hits with other poses. Of nine cases where
fixed confidence selection misses an available passing hit, four involve a top-score
tie and five have only strictly lower-scoring passing poses. The
[ten-sample diagnostic ledger](checkpoint-480/diagnostics-first10/README.md)
retains every selected seed, missed hit and stereochemical flag. It does not
reconstruct unrounded confidence or identify a preparation, quantization or kernel cause.

![Completed sampling and launcher-time results](checkpoint-480/sampling-plots/sampling-and-time.png)

Recorded launcher wall time has a median of 112.9 seconds per prediction
(IQR 80.7–182.4; range 41.0–483.9) on this physical Apple WebGPU run. This includes
browser startup, available asset loading, folding, confidence and archive checks;
it excludes independent scoring. It is not isolated inference/kernel time or a
cross-device speed comparison. Protein length and system conditions matter.

![Ten samples across the training-similarity spectrum](checkpoint-480/similarity-plots/first-10.png)

Any-passing-hit counts by increasing similarity bin are 1/1, 5/12, 9/18 and 11/17.
The lowest bin contains only one case. The [final report](checkpoint-480/README.md)
includes the native-valid subset, every denominator and the confidence-selected
counts. These are results of the selected native-positive reconstruction cohort,
not a population accuracy or matched-input numerical-parity estimate.

The [historical six-sample checkpoint](checkpoint-288/README.md) retains all 288
original outputs, its 25/48 any-passing and 17/48 confidence-selected results,
26 top-score ties and the original source-attempt evidence. It remains unchanged.

## Historical three-sample checkpoint

All 48 selected cases have completed seeds 0–2. Of these, 26/48 have a geometric <2 Å hit and 21/48 (43.75%) have a hit passing the limited stereo/clash checks. Restricting to the 41 cases with a diagnostic-passing native hit gives 19/41 passing browser hit cases. These retrospective best-of-three counts use the experimental answer and are separate from confidence-based pose selection. The completed ten-seed results are reported above.

![Uniform first-three-seed checkpoint](checkpoint-221/plots/first-three.png)

The source files, full per-case table and similarity-bin denominators are in the [checkpoint report](checkpoint-221/README.md). The lowest-similarity bin has only one case. An interrupted attempt and its fresh continuation are recorded in [execution history](execution-history.json); none of the first 221 completed predictions was repeated.

Selecting the highest reported ipTM without the crystal answer gives 16/48 passing hit cases after three samples, compared with the crystal-informed 21/48. The [sampling and timing analysis](checkpoint-221/README.md#uniform-sampling-and-confidence-selection) reports every uniformly completed prefix separately. Recorded launcher time has a median of 110.9 seconds across this checkpoint; this includes browser startup, available asset loading and output checks, rather than just GPU computation.

The archived confidence is rounded to two decimals: 19 cases have multiple seeds tied for highest reported ipTM. Three of the five cases with a passing hit that the fixed tie rule does not select have a passing pose tied at the top score; only two have strictly lower reported confidence. The [case-level diagnostic breakdown](checkpoint-221/diagnostics-first3/README.md) distinguishes these observations. The 16/48 result uses the stated lowest-seed tie rule and does not reconstruct the original unrounded confidence values.

The first-three cases partition into 16 selected passing hits, five passing hits not selected, five cases whose only <2 Å poses fail the limited diagnostics, and 22 cases with no <2 Å pose. All five geometric-only cases have stereochemical-identity failures among those near-native poses. In 21 confidence-selected poses, global protein Cα RMSD is below 2 Å while ligand RMSD is at least 2 Å. This shows why a close protein backbone alone does not verify ligand placement; it does not establish a preparation, precision or kernel cause.

## Inspect the original poses

[All 48 preselected systems and 480 original predictions](checkpoint-480/review-libraries/README.md)
are available as 96 portable Foldarium libraries: one prediction-only file and
one separately reference-inclusive file per system. No case was omitted after
seeing the results. Import a downloaded JSON into the Molarium reviewer to rotate
poses, compare pockets, record exact pose preferences/notes and export a shortlist.
No benchmark correctness labels or preferred poses are embedded. Source attribution
travels with each library.

Every original prediction PDB string and explicit ligand graph is preserved.
The [full coordinate/graph check](checkpoint-480/review-libraries/alignment-check.json)
verifies all 480 unique poses, 48 experimental references and 96 libraries; display
alignment differs from the scoring frame by at most 1.8 × 10⁻¹⁴ Å. This is a data
check, not another model run or a claim that every ten-sample page has rendered.
Recorded launcher time remains provenance rather than being relabelled as isolated
inference time in the viewer.

The [actual six-sample browser sweep](review-ui-2026-11-16/README.md) passed all
48 systems, 288 unique predictions and every grid page, including exact notes,
preferences, original PDB/graph exports, shortlist and reference separation.
The actual **ten-sample** sweep also passed all 48 cases: 480 predictions,
48 separate references and 288 grid pages, with the same export and persistence
checks. The [saved complete receipts](review-ui-2026-11-16/all48-ten-sample-verification.json)
replay against independently regenerated final exports in CI. Experimental cards omit prediction metadata,
and prediction/PDB numbering stays stable when a reference or a failed request
is present. UI behavior and pose accuracy are separate checks.

The [original five posthoc examples](checkpoint-288/review-examples/README.md)
and their narrower historical browser receipt remain available. Their original
scope and the later finding-to-fix history are preserved in the UI review document.

## Stock input preparation check

All 48 raw SMILES prepare through the pristine stock `smilesComponent` defaults,
and their named chemical graphs match the declared inputs. The independent
stereochemical-graph diagnostic passes for 45/48 initial conformers. It flags
`8aqf__1__1-a__1-b`, `8iqt__1__1-a__1-b` and `9f40__1__1-a__1-q`; these are input
conformer flags, not folding results. The raw stock preparation is preserved for
all 48, including flagged cases, without changing seeds, rewriting SMILES or
replacing cases. Exact graphs, coordinates and diagnostics are in
`stock-input-components/`. Input conformer flags and final output diagnostics are reported separately.

## Protocol and boundaries

The stock runs use the pristine original LocalFold page at
`5ea3d42c911949700401b54003cb28c557fcf2a6`: Boltz-2, ten seeds (0–9), 200 diffusion
steps and three additional recycles (four trunk passes). Inputs retain the
query plus up to the first 255 unique rows from the published protein alignment. No
experimental coordinates or restraints enter stock inference. The published
native runs used their own settings and alignments; this is a reconstruction
comparison conditioned on native success, **not matched-input numerical parity
or a general accuracy benchmark**. Different native and browser sampling budgets
and model quantization must remain explicit.

RnP’s Boltz CSV uses `method=boltz` for both Boltz generations. We select the
exact `predictions/boltz2.csv` archive member; selecting by that ambiguous column
would mix methods. Both complete source archives were checksum-verified while
streaming. The extractor retained 3,210 published native-hit CIFs and 588 reference
files; the 39.5 GB compressed native archive was not retained. Chemical/reference
gates permit rescoring 2,569 of those poses. Only those saved published-hit poses
were rescored; “nativeBestA” means the best independently rescored pose in that
subset, not a new search over every published prediction.

**Native ligand topology limitation:** the published Boltz mmCIF does not include
ligand bonds, and the processed native RDKit cache is absent. We reconstruct
names from the exact declared SMILES using Boltz’s deterministic
`MolFromSmiles → AddHs → CanonicalRankAtoms → element/rank names → RemoveHs` rule,
preserved from tag v2.2.1, commit `cb04aeccdd480fd4db707f0bbafde538397fa2ac`. Names and
elements must match bijectively. No predicted distances or experimental RMSD
choose the mapping. This is explicitly reconstructed input topology; we do not
claim recovery of the original native cache or knowledge of its historical
RDKit version. The older strict native-cache converter is unchanged.

Stereo and <1.2 Å protein–ligand heavy-atom clash diagnostics are limited checks,
not full PoseBusters validation or a binding-affinity estimate. Geometric and
chemically flagged outcomes stay separate.

## Files and reproduction

- `candidate-pool.json`: frozen inputs, source hashes, model/cutoff/size gates and stable order.
- `native-qualification.json`: independently rescored saved poses, exclusions, diagnostic flags and source/script hashes.
- `selection.json`: selected cases, every rejected selection, caps and shortfalls.
- `references/`: portable reference molecular states for the selected cases.
- `reference-sources/` and `native-best/`: original experimental CIF/SDF and the closest rescored native-hit CIF for each selected case.
- `source-evidence/`: complete extraction receipts and member checksums for all retained candidate evidence.
- `sources/`: pinned source metadata, input-preparation notebook, naming implementation and licenses.
- `environment.txt`: exact analysis package versions.
- `frozen-stock-plan.json`: all 480 job identities and input hashes, frozen before inference.
- `initial-snapshot/`: retained 11-prediction historical snapshot.
- `checkpoint-221/`: 221 independently recomputed predictions, original outputs, device/step receipts and self-contained archive parts containing every frozen input. The summary distinguishes the completed three-seed prefix from the unfinished ten-seed budget.
- `checkpoint-288/`: six samples for every case, independently replayed with original outputs, merged attempt histories, sampling and similarity plots, confidence-tie diagnostics and recorded launcher timings. This historical six-sample result is retained separately from the completed ten-sample report.
- `checkpoint-480/`: completed full experiment, independently replayed original output archives, 3/6/10-sample diagnostics, confidence/timing/similarity plots and all 96 human-review libraries.
- `execution-history.json`: interruption, preserved completed work and immutable continuation.

The scripts in `folding/comparison/` are `rnp_cohort.py`,
`fetch_rnp_evidence.py`, `fetch_rnp_msa.py`, `rnp_qualify.py` and `select_rnp.py`.
`prepare_rnp_components.mjs` preserves original stock ligand preparation;
`prepare_rnp_msas.py` checks the source query and derives the fixed A3Ms;
`prepare_rnp_stock_plan.py` writes every seed-specific input before execution.
`export_stock_review.py` independently verifies a completed snapshot and exports
specified cases in the existing portable Foldarium format without rerunning
models. `check_stock_review.mjs` checks the original PDB and graph hashes,
reference separation, confidence fields and display alignment. CI regenerates
the released examples byte for byte and exercises actual file import and local
preference persistence. The exporter pins its executing source and preserves
explicit dataset attribution in each standalone library.
`wait_rnp_stock.py` can monitor existing assigned jobs, verify the transferred
archive, then start exactly one immutable stock batch. It does not submit remote
jobs or create resources. Remote identity/account configuration stays in a
separate task-local file, and the monitor verifies the guest and Slurm identity
on every check. The wait is bounded; transport failures and failed dependencies
stop it. The batch retains existing source, native-hit and physical-GPU gates,
and stops after three consecutive execution errors.
Full source retrieval requires an allocated CPU job and verifies the entire
official compressed archive checksum. Outputs use fresh immutable directories.
The qualification report records its exact consumed script hashes.
The original candidate selector is saved as `sources/consumed-rnp-cohort.py`;
the current CLI additionally closes the annotation file explicitly. Its generated
candidate records and policy are unchanged.

`check_rnp_selection.py --report reviews/cofold-rnp-spectrum-2026-11-15` checks
the selection and independently rescores all 48 published baseline structures
from the included raw files. `test_rnp.py` covers strict thresholds, model
generation, cutoff, chemical-state mismatch, missing/duplicate atom identities,
coordinate-independent mapping and selection caps.

## Attribution

Source dataset: Peter Škrinjar, Jérôme Eberhardt, Gerardo Tauriello, Torsten
Schwede and Janani Durairaj, *Have protein-ligand cofolding methods moved beyond
memorisation?*, [Zenodo version 18366081](https://zenodo.org/records/18366081),
CC BY 4.0. The files here are selected, reformatted and rescored derivatives;
original-source checksums and processing changes are recorded. Only Boltz-2
outputs are included; AlphaFold3 output restrictions are preserved as source
context and no AlphaFold3 coordinate output is redistributed. The naming source
is from [Boltz](https://github.com/jwohlwend/boltz/tree/cb04aeccdd480fd4db707f0bbafde538397fa2ac),
with its MIT license alongside the snapshot.

## Report tooling findings

The shared snapshot writer previously named KIT/NSP3 and “three saved native
seeds” in fixed prose. It now derives flags from the current frozen cohort and
refers to its actual preserved native evidence. Scores and the executing frozen
batch are unchanged. The evidence checker keeps its original default size and
member limits; larger cohorts may explicitly select a finite artifact budget
(up to 2 GiB / 20,000 members), with all hash, physical-GPU, sampling and rescore
checks retained. `summarize_rnp_stock.py` separates geometric from diagnostic-
passing hits, retains execution failures, and omits final case-hit rates for
unfinished groups.

`analyze_rnp_sampling.py` compares fixed seed prefixes with highest-ipTM selection, without removing invalid poses before ranking. Missing confidence suppresses the corresponding selection rates. Timing observations are hash-bound to the original receipts. The offline checker regenerates the analysis and also checks the confidence values against the original prediction archive. `finalize_rnp_stock.py` can wait for the existing attempts and then merge, rescore, verify and plot all terminal predictions. It cannot submit, restart or repeat science, publish changes, or deploy. It stops on an unfinished stopped batch or a finite wait deadline.

## Combining interrupted attempts without repeating science

`merge_stock_attempts.py` stages completed checkpoints for analysis only; it runs no model. It checks identical consumed source manifests, every frozen input, reference hashes, and completed receipt/output hashes. Later attempts may resolve unfinished predictions, but any overlap with an already completed prediction is rejected. Original progress snapshots and source manifests remain attached. The archive checker verifies that merged completions match those original checkpoints. The interrupted trunk-only attempt is retained in execution history rather than counted as another completed sample.
