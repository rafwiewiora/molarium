# Runs N’ Poses: larger native-positive stock LocalFold comparison

**Status: native qualification and selection completed; new stock predictions have not run.**
Published alignments still need to be retrieved. The existing 80-prediction study
remains the completed browser result; this is its separately frozen follow-up.

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
| New browser predictions | 0 | No updated browser success rate yet |

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

## Protocol and boundaries

Planned stock runs use the pristine original LocalFold page at
`5ea3d42c911949700401b54003cb28c557fcf2a6`: Boltz-2, ten seeds (0–9), 200 diffusion
steps and three additional recycles (four trunk passes). We plan to retain the
query plus the first 255 unique rows from the published protein alignment. No
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

The scripts in `folding/comparison/` are `rnp_cohort.py`,
`fetch_rnp_evidence.py`, `fetch_rnp_msa.py`, `rnp_qualify.py` and `select_rnp.py`.
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
