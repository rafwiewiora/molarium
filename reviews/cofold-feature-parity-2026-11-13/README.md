# Cofolding feature parity audit — partial results

The [270-prediction protocol comparison](../cofold-recent-pdb-2026-11-13/README.md)
does not establish fixed-input numerical agreement. These captures locate input
differences before attributing pose differences to kernels or quantization.
**Both original native captures and the same-SMILES control are complete. The
[first matched trained atom-feature stage](trained-target/README.md) now passes on
production CPU/WebGPU against stock native FP32. Full-model numerical agreement
remains untested.** Production folding mathematics is unchanged.

Two diagnostic systems were selected before capture: STARD4 (9T51), with
0.48 Å seed-paired mean browser/native ligand disagreement, and YTHDF2 (32QY),
with 13.85 Å disagreement. Selection uses the observed discrepancy; these are
diagnostic cases, not an independent accuracy sample.

## What agrees, and what differs

The [STARD4](comparison-9t51-a1jtm.json) and
[YTHDF2](comparison-32qy-a1keo.json) reports preserve exact metrics and source hashes.
Chemical correspondence uses the declared molecular graphs and specified stereo,
with no coordinate fitting, atom dropping, or pose selection.

| Diagnostic | STARD4 | YTHDF2 |
| --- | ---: | ---: |
| Tokens / active atoms accounted for | 238 / 1,679 | 185 / 1,381 |
| Stereo-compatible ligand graph maps | 12 | 1 |
| Ligand atoms with different name encodings, across all graph maps | 31 of 33 | 9 of 18 |
| Protein within-reference-space pair-distance RMS difference | 0.561 Å | 0.590 Å |
| Ligand within-reference-space pair-distance RMS difference, declared map | 1.383 Å | 0.219 Å |

After the explicit atom/token mapping, **elements, formal charges, bond adjacency,
atom/token masks, residue types, residue indices, chain/symmetry IDs and reference-space
membership agree exactly**. All 257 MSA rows, MSA masks, profiles, deletion means,
deletion indicators and transformed deletion values agree exactly after the documented
native 32-category → browser 31-category alphabet translation. The two native nucleic
unknown categories merge into the browser's shared unknown category; gap stays distinct.
These cases contain protein plus one ligand, with no RNA/DNA.

Four checked fields differ: token indices, entity IDs, model atom-name characters,
and reference positions. Entity IDs differ by a numbering convention. Token indices
cannot simply be dismissed as a constant offset after chemically corresponding ligand
atoms have been reordered. The model uses token-index differences for atoms in the same
residue. Its relative-position encoding needs a separate numerical check.

The browser canonicalizes SMILES before featurization; the original native query retains
the supplied spelling. Both declare the same chemical state and specified stereo, but
the spelling changes parser atom order and generated names. A separate, completed STARD4
control gives the native pipeline the exact processed browser SMILES, keeping the
chemistry, original frozen input evidence, checkpoint and data seed recorded. It does
not replace or rerun the published pose predictions. Its
[producer](producers/capture_native_features-processed-smiles.py) is preserved separately
from the consumed original producer.

Reference-coordinate differences extend beyond rigid augmentation: within-space pair
distances also differ, including in protein residue conformers. These are generated
input reference conformers, **not experimental bound coordinates or predicted poses**.
Pair-distance diagnostics remove rigid motion only; ligand atom permutations are fixed
by the declared graph map rather than optimized against coordinates. STARD4's 12 graph
maps remain explicit; the table's coordinate diagnostic uses the reported lexicographic
map, not an allegedly unique atom assignment. None of these findings establishes the
cause of the pose discrepancy.

## Same-spelling control result

The [completed STARD4 control](comparison-9t51-a1jtm-processed-smiles.json),
job 15717 on L4, uses the exact browser processed SMILES. It captures one batch
and makes zero model-forward calls. With identity parser order, **all 1,679 atom-name
encodings now agree exactly**, including every ligand atom. The same chemistry,
mask, bond and alignment matches hold. Other stereo-compatible graph maps are still
enumerated; they are not substituted for the known parser order.

Three checked raw fields differ: token indices, entity labels and reference coordinates.
[The integer-feature audit](processed-smiles-numbering.json) verifies that every
pairwise token-index difference is identical (native indices are uniformly one lower),
and every pairwise entity-equality relation is identical. Entity labels themselves
are permuted, not uniformly shifted; their numerical differences need not agree.
This is an integer-input diagnostic, not execution of the neural relative-position module.

Generated reference positions still differ. Protein within-space pair-distance RMS
remains 0.561 Å; the ligand diagnostic is 1.303 Å in known identity parser order.
The strict-FP32 trained export reproduced the frozen feature bytes and made one
actual stock input-embedder call. The [target-feature comparison](trained-target/README.md)
then passes in production CPU/WebGPU, at approximately 1.5 × 10⁻⁷ relative RMS in
the learned channels, using the same generated reference inputs and trained weights. No bound crystal
coordinates are used. **Neither the control nor the original comparisons establish
trained-model or trajectory parity.**

## Capture boundaries and preserved evidence

The browser folders preserve 44 typed arrays per case, reconstructed through the same
shared JavaScript featurizer used by production. They reuse each saved input ligand
component and alignment, verified against the original hashes. No conformer is
regenerated, no weights are loaded, and no GPU/model runs. This is reconstruction
from saved inputs, not a historical live-tensor capture.

The native folders preserve 39 tensor arrays per case from the official OpenFold3
0.5.1 CLI, checkpoint loader and data pipeline. The `predict_step` replacement saves
its exposed inputs and returns no prediction; a guarded model forward must never
execute. Receipts confirm one captured batch and zero forward calls per case.
Original inputs/checkpoint are checked against a completed native control; capture
selects seed 0 and data seed 42. An isolated cache excludes user-default runner settings.
Opaque Biotite AtomArray metadata is listed by type and is not represented as a tensor.
The stock CLI reports no successful prediction because the capture deliberately returns
none; the feature-specific receipt records the successful capture, not a predicted pose.

Both initial T4 Spot allocations failed before their scripts started. The new immutable
attempt completed on L4 Spot: jobs 15602_0 and 15602_1; CPU preservation job 15620.
The [portable source archive](native-features.zip) and
[transfer receipt](transfer-receipt.json) retain consumed inputs, reference receipts,
producer scripts, preflight, scheduler history and logs, alongside complete raw captures.
Exact consumed producer versions are retained in the [repository producer archive](https://github.com/rafwiewiora/molarium/tree/main/reviews/cofold-feature-parity-2026-11-13/producers); later changes
do not rewrite old receipts.

The earlier [protein export layout audit](exported-protein-atom-layout.json) finds
identical named protein atom sets for all nine recent systems. Export layout does not
prove feature equality. The [installed-source audit](installed-native-source.json)
records actual core file hashes matching the
[pinned official revision](https://github.com/aqlaboratory/openfold-3/tree/795e45b03924a8f8ffc72ae50298bd113530b9d3).

## Reproduce and remaining scope

Reconstruct the browser side into a new directory:

```sh
node folding/comparison/capture-browser-features.mjs \
  --library reviews/cofold-recent-pdb-2026-11-13/browser-openbind0-msa256-standard/library-3.json \
  --seed 0 --output /tmp/new-stard4-features
```

Unzip `native-features.zip` into a new directory, then run:

```sh
python folding/comparison/compare_feature_snapshots.py \
  --native reviews/cofold-feature-parity-2026-11-13/native-9t51-a1jtm \
  --browser reviews/cofold-feature-parity-2026-11-13/browser-9t51-a1jtm \
  --library reviews/cofold-recent-pdb-2026-11-13/browser-openbind0-msa256-standard/library-3.json \
  --inputs /tmp/unpacked-native-features/inputs/9t51-a1jtm \
  --output /tmp/new-stard4-comparison.json
```

The [comparator](../../folding/comparison/compare_feature_snapshots.py) rejects changed
inputs and incomplete atom correspondence. Its
[tests](../../folding/comparison/test_feature_comparison.py) replay both public cases
without a model or pickle and test stereo/transfer rejection. Serialization and
cross-language tests check exact typed bytes. Reports explicitly list ungraded native
fields and browser-only gather/template internals.

Next: extend the matched target-feature result to projected single/pair states,
the trunk, denoiser and confidence head, then complete trajectories with explicit
random tensors. Quantized production weights need their own control. NVIDIA browser hardware and quantization error require separate
controls. The transition-stability candidate remains experimental.
