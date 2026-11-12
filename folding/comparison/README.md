# Browser/native cofolding comparisons

These tools compare completed structure predictions without rerunning inference
or treating a native prediction as an experimental answer. The first cohort is
the existing 48-pose browser library: ubiquitin (76 residues), 16 small compounds,
seeds 0/1/2, single-sequence input, no templates. These are arbitrary pairs; no
bound crystal pose or affinity is asserted.

## What is being compared?

| Route | Model/checkpoint | Sampling | Precision |
| --- | --- | --- | --- |
| Browser OpenBind-0 | LocalFold int5 OpenBind-0 bundle | 25 steps, 2 additional recycles; browser exponential sampler | Quantized weights, WebGPU |
| Browser Boltz-2 | LocalFold int5 Boltz-2 structure bundle | 25 steps, 2 additional recycles; browser exponential sampler | Quantized weights, WebGPU |
| Native low-step | OpenFold3 0.5.1 / Boltz 2.2.1 | 25 steps, 2 recycles; each native sampler | OpenBind FP32; Boltz BF16 mixed |
| Native standard | Same native releases/checkpoints | 200 steps, 3 recycles; each native sampler | BF16 mixed |
| Native PyTorch control | OpenFold3 0.5.1 / OpenBind-0 | 25 steps, 2 recycles; upstream dense triangle kernels | FP32 |

Native OpenBind uses `of3-ob-2025-06-30-174k.pt`, the trained checkpoint released
with OpenFold3 v0.5.0, through the official v0.5.1 runtime. It does not use
Foldarium's historical v0.4.4 preview-2 adapter or Molarium's older protein-only
OpenFold 2 export. Historical method identifiers remain unchanged.

The low-step control matches step/recycle counts, not all numerical inputs.
Browser quantization, sampler implementations, ligand feature generation,
floating-point arithmetic and random streams differ. Equal integer seeds are not
equal random tensors. The standard protocol increases sampling effort while
keeping the same single-sequence inputs; it is not the full stock MSA workflow.
An exact implementation-parity test would require separately matched tensors,
weights and random inputs.

The dense FP32 control selects an official OpenFold3 kernel path, without changing
the requested sequences, compounds, sampling count or tolerance. Its small-input
memory result cannot establish general T4/L4 hardware support. Upstream OpenFold3
documents a larger GPU memory requirement; all runs require a genuine GPU grant
and record actual device/peak memory or failure.

## Reproduce inputs and analyze completed outputs

From the repository root:

```sh
node folding/comparison/prepare-native.mjs /tmp/cofold-inputs
python3 -m venv /tmp/cofold-analysis
/tmp/cofold-analysis/bin/pip install -r folding/comparison/requirements-analysis.txt
/tmp/cofold-analysis/bin/python -m unittest discover -s folding/comparison -p 'test_*.py'
```

`prepare-native.mjs` reads the preserved browser library and writes deterministic
native query files plus `comparison.json`, including the original library hash.
It refuses an existing output directory so a consumed manifest cannot be changed.
Install the official native releases separately in compatible GPU environments;
the analysis environment is not an inference runtime. Download the corresponding
official checkpoints and dependencies under their upstream terms. Run only in a
new output directory, inside an allocated single-GPU Slurm job:

```sh
# OpenBind example; its runtime also needs its official cached data assets.
python folding/comparison/native_run.py --method openbind0 --protocol low-step \
  --inputs /tmp/cofold-inputs --output /path/to/new-attempt \
  --checkpoint /path/to/of3-ob-2025-06-30-174k.pt --cache /path/to/openfold-cache
# Boltz uses --method boltz2 and the official Boltz-2 checkpoint/cache.
```

The wrapper invokes the official CLI, checks the installed release and resolved
OpenBind sampling settings, and instruments synchronized model forwards without
changing their outputs. It preserves checkpoint, input and output hashes, actual
CUDA device, package versions, cumulative GPU memory peaks and failures.
Elapsed CLI wall time includes model loading, featurization, inference and output;
it excludes checkpoint hashing, environment installation, weight downloads and
queue time. Browser and native timing boundaries/hardware differ, so their ratio
is not a controlled implementation speedup. Per-forward times are not assigned
to pose IDs without a proven correspondence. Raw operational receipts may contain
local paths; preserve their hashes and publish scientific metadata separately.

Convert only a complete native attempt, using the exact input manifest consumed
by that attempt:

```sh
/tmp/cofold-analysis/bin/python folding/comparison/convert_native.py \
  --native /path/to/completed-attempt --inputs /path/to/consumed/comparison.json \
  --output /tmp/native-library.json
/tmp/cofold-analysis/bin/python folding/comparison/compare_libraries.py \
  --library browser=reviews/library-cofolding-2026-11-12/library-48/library-1.json \
  --library native=/tmp/native-library.json --pair browser:native \
  --output /tmp/agreement.json
node folding/comparison/review-bundle.mjs \
  --library browser=reviews/library-cofolding-2026-11-12/library-48/library-1.json \
  --library native=/tmp/native-library.json --output /tmp/comparison.library.json
```

Conversion verifies receipt/input/output hashes, full compound/seed coverage,
protein sequence and explicit ligand connectivity/bond identity. It does not
infer bonds from predicted distances, fit a ligand to a reference, minimize a
prediction, or pretend to recover the native input conformer. The exported graph
uses declared input chemistry mapped to native atom identities. Both original
mmCIF files and hashes should accompany any reported analysis.
Boltz mmCIF omits ligand bonds. Before conversion, run
`export_boltz_topology.py /path/to/completed-attempt` in the trusted original
Boltz/RDKit environment. It serializes the run's `processed/mols` caches to
`ligand-topologies.json`, retaining molecule-cache and native-output hashes and
exact atom names. This helper reads trusted RDKit pickle files produced by the
native run; do not point it at arbitrary downloaded pickle files. The converter
itself reads JSON, checks those hashes, and requires the cached chemical state to
match the declared SMILES. A cached conformer is not claimed to be the selected
random reference conformer used during inference.
Import the combined JSON into Foldarium for unscored human selection. Models are
interleaved by sample for comparison; original pose IDs, samples, seeds, complete
results and source-library hashes remain attached. The exported library contains
no copied preferences. No structure is recalculated or aligned in the export;
the reviewer applies only its documented whole-complex display transform.

## Metrics and interpretation

Each pair uses a least-squares protein Cα alignment; the same transform moves
the complete predicted complex. Ligand heavy-atom RMSD uses RDKit `CalcRMS` in
that protein frame, including graph symmetry and conjugated terminal groups.
There is no independent ligand fit. All nine cross-seed pairs are retained per
compound, together with seed-paired means, directed nearest-ensemble means in
both directions and a one-to-one ensemble assignment. The nearest statistic is
optimistic and is reported alongside the other statistics.
Every distinct within-method seed pair is also retained to show intrinsic
prediction spread before interpreting cross-engine discrepancies.

Residue-contact overlap (4 Å) and severe intermolecular heavy-atom pairs (<1.2 Å)
are limited geometry diagnostics, not a complete chemical-validity assessment.
Agreement is neither experimental pose accuracy nor prospective binding evidence.
Confidence values remain model-specific. Human preferences are saved separately
from predictions; generated comparison libraries start with no decisions.

See [the public results record](../../reviews/cofold-method-comparison-2026-11-12/README.md).

Primary references: [OpenFold3 v0.5.0 release](https://github.com/aqlaboratory/openfold-3/releases/tag/v0.5.0),
[OpenFold3 parameter reference](https://openfold-3.readthedocs.io/en/latest/parameters_reference.html),
[LocalFold](https://github.com/sokrypton/localfold), and
[Boltz](https://github.com/jwohlwend/boltz).
