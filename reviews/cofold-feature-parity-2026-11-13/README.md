# Cofolding feature parity audit — in progress

The [270-prediction protocol comparison](../cofold-recent-pdb-2026-11-13/README.md)
does not establish fixed-input numerical agreement. This experiment examines
the inputs before attributing pose differences to a kernel or quantization.
Native captures are queued on PSIgreen; no native/browser feature verdict is
reported yet. Production folding mathematics is unchanged.

Two diagnostic systems were selected before these captures: STARD4 (9T51),
with 0.48 Å seed-paired mean browser/native ligand disagreement, and YTHDF2
(32QY), with 13.85 Å disagreement. Selection uses the observed discrepancy;
these are diagnostic cases, not an independent accuracy sample.

The saved [protein atom-layout audit](exported-protein-atom-layout.json) finds
identical named protein atom sets in the browser and native seed-0 exports for
all nine recent systems. Output atom sets do not prove input-feature equality.
The [installed native source audit](installed-native-source.json) records actual
OpenFold3 0.5.1 core file hashes, which match the
[pinned official revision](https://github.com/aqlaboratory/openfold-3/tree/795e45b03924a8f8ffc72ae50298bd113530b9d3).

The browser folders preserve 44 typed arrays per case, reconstructed through the
same shared JavaScript featurizer used by production. They reuse each saved
input ligand component and alignment, verified against the original hashes.
No conformer is regenerated, no weights are loaded, and no GPU or model runs.
This is reconstruction from saved inputs, not a historical live-tensor capture.
The raw binary arrays preserve types, signed zero, large integers and masks.
Exact consumed producer scripts are retained in [producers](producers/).

The [native capture](../../folding/comparison/capture_native_features.py) uses
the official CLI, checkpoint loader and data pipeline. Its `predict_step`
replacement saves exposed tensor inputs and returns no prediction. A guarded
model forward must never execute. Original consumed inputs/checkpoint are
checked against a completed native control; the capture explicitly selects
seed 0 and data seed 42. An isolated cache prevents user-default runner settings
from leaking into the experiment. Opaque metadata objects are listed by type.

Both initial T4 Spot allocations failed before their scripts started: no
feature files or forward calls were produced. A new immutable attempt uses the
same source and inputs on normal/L4 Spot partitions at normal priority. Captures
will retain failures, source receipts and raw arrays; incomplete work is not
labelled as numerical parity.

The next checks compare semantic atom/token correspondence, element and charge
features, masks, bonds, alignment features and reference coordinates. Complete
trained-model comparison then requires the same feature values, weights and
explicit random tensors, with taps at the embedder, trunk, denoiser and confidence
head. Reference-coordinate injection for numerical testing uses generated input
conformers, never experimental bound coordinates. Hardware qualification and
quantization error are separate controls. The transition-stability candidate
remains experimental until those controls justify deployment.

Reconstruct the shared-JS side into a new directory:

```sh
node folding/comparison/capture-browser-features.mjs \
  --library reviews/cofold-recent-pdb-2026-11-13/browser-openbind0-msa256-standard/library-3.json \
  --seed 0 --output /tmp/new-stard4-features
```

[Binary reader](../../folding/comparison/feature_snapshot.py),
[native serialization tests](../../folding/comparison/test_feature_capture.py),
[cross-language reader tests](../../folding/comparison/test_feature_snapshot.py),
and [JavaScript tests](../../folding/comparison/capture-browser-features.test.mjs)
verify exact bytes and reject changed or overwritten captures. These tests do
not claim GPU/model execution.
