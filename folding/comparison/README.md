# Browser/native cofolding comparisons

The [recent-release PDB expansion](../../reviews/cofold-recent-pdb-2026-11-13/README.md)
adds nine target-diverse drug-like complexes, a complete source-selection audit,
independent browser input-chemistry checks, and all-candidate Foldarium review.
Original and corrected-input predictions are retained as separate phases;
provided-MSA and native controls are tracked explicitly. The
[finding-to-fix ledger](../../reviews/cofold-recent-pdb-2026-11-13/findings.md)
links each correction to evidence and regressions.

The recent panel includes 54 complete native single-sequence predictions and
54 native MSA predictions; the interactive review retains all 270 poses.
`package_native_panel.py` publishes exact coordinates, named topology, consumed
inputs/runner and public scientific receipts without rerunning inference.
`check_native_panel.py` independently reconstructs every exported PDB and crystal
score from those archives, including stereochemical failures. Only private CLI
argument paths are removed; original receipt hashes remain attached. The
regression runs in the existing cofolding-analysis CI gate. Recovered cohorts
retain each source's original status, consumed inputs/runner and stopped-output
inventory; `native_panel_recovery.py` validates the complete assembly without
repeating science. `native_panel_timings.py` summarizes synchronized native
forward records separately from browser end-to-end timings. Both native MSA
phases are complete; original zero-output startup failures are preserved
separately from pose scores.

A [full input-feature audit](../../reviews/cofold-feature-parity-2026-11-13/README.md)
has completed native and shared-JS captures on two diagnostic systems, with
zero native model forwards. Its portable comparison accounts for every atom
and identifies SMILES-order/name and reference-conformer differences while
verifying chemistry/alignment feature matches. The completed same-spelling control eliminates the atom-name/order difference;
generated reference coordinates still differ. The [first trained target-feature stage](../../reviews/cofold-feature-parity-2026-11-13/trained-target/README.md)
passes at matched inputs/full-FP32 weights; complete model and trajectory parity
remain unresolved.

The next, **unqualified** stage uses `capture_native_trunk.py` to observe the
stock four-cycle `run_trunk` at exact frozen feature bytes. It exports trained
weights, projected embeddings, template/MSA/pairformer boundaries and the
actual MSA random draws. A module-local observer returns those draws unchanged;
the official neural computation is retained. The whole-model forward remains
guarded, so this is not another pose prediction. `make_trained_trunk_fixture.py`
uses the pinned upstream weight-layout converter, and
`scripts/cofold-trained-trunk.browser.mjs` runs the production GPU trunk with
FP32 storage, weights and accumulation. `check_trained_trunk.py` recomputes
errors from all 32 required raw seams, rejecting partial transfers or changed
gates. These tools have **no completed full-trunk parity result yet**.

```sh
MOLARIUM_FEATURE_CONTROL=/path/to/completed-feature-control \
  python folding/comparison/capture_native_trunk.py \
  --inputs /path/to/frozen-inputs --output /path/to/new-native-capture \
  --checkpoint /path/to/of3-ob-2025-06-30-174k.pt \
  --reference-receipt /path/to/completed-native-receipt.json \
  --browser-library /path/to/exact-browser-library.json
python folding/comparison/make_trained_trunk_fixture.py \
  --native /path/to/new-native-capture --target-fixture /path/to/matched-target-fixture \
  --converter-root /path/to/pinned-upstream-converter --output /path/to/new-trunk-fixture
bun scripts/cofold-trained-trunk.browser.mjs /path/to/new-trunk-fixture /path/to/new-gpu-capture
python folding/comparison/check_trained_trunk.py \
  --fixture /path/to/new-trunk-fixture --measured /path/to/new-gpu-capture \
  --output /path/to/new-analysis.json
```

The native capture requires its original compatible single-GPU runtime and
Slurm grant. Instrumented trunk timings include serialization and readbacks,
and cannot be presented as inference throughput. The separately observed
distogram weights support the production loader; the native head is not
executed here and its accuracy is not qualified. The exact native target
features intentionally isolate the trunk from the earlier target encoder.
This does not test production int5 weights or denoising/confidence.

Capture timing correction **CAP-01**: older feature receipts created
`startedAt` after imports and validation, but `elapsedSeconds` began before
them. New receipts bind both clocks to the same start and separately record
`receiptCreatedAt` and the elapsed scope. Original public receipts remain
unchanged; their start/finish timestamp difference must not be substituted for
elapsed time. The explicit CUDA-synchronized embedder measurement has its own
boundary and is unaffected.

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
| Native PyTorch standard | OpenFold3 0.5.1 / OpenBind-0 | 200 steps, 3 recycles; upstream dense triangle kernels | FP32 |

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
TORCHINDUCTOR_COMPILE_THREADS=1 python folding/comparison/native_run.py --method openbind0 --protocol low-step \
  --inputs /tmp/cofold-inputs --output /path/to/new-attempt \
  --checkpoint /path/to/of3-ob-2025-06-30-174k.pt --cache /path/to/openfold-cache
# Boltz uses --method boltz2 and the official Boltz-2 checkpoint/cache.
```

The wrapper invokes the official CLI, checks the installed release and resolved
OpenBind sampling settings, and instruments synchronized model forwards without
changing their outputs. It preserves checkpoint, input and output hashes, actual
CUDA device, package versions, cumulative GPU memory peaks and failures.
Generated OpenBind runners use zero data-loader workers and the example limits
compiler concurrency to one. The upstream ten-worker default plus compiler
subprocesses exhausted host memory on a four-CPU/14G node before the first
prediction; the worker-limited retry preserves the same model, sequence/ligands,
precision, recycles and sampling count. Worker settings are execution metadata,
and timings apply to that recorded configuration. Compiler control is documented
in [PyTorch 2.5.1 source](https://github.com/pytorch/pytorch/blob/v2.5.1/torch/_inductor/config.py).
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
`residue_profile.py --left browser.json --right native.json --output profile.json`
localizes residuals from those same full-protein fits. It preserves all residue/
pair displacements and source hashes, without trimming a tail or refitting a core.

Residue-contact overlap (4 Å) and severe intermolecular heavy-atom pairs (<1.2 Å)
are limited geometry diagnostics, not a complete chemical-validity assessment.
Agreement is neither experimental pose accuracy nor prospective binding evidence.
Confidence values remain model-specific. Human preferences are saved separately
from predictions; generated comparison libraries start with no decisions.

See [the public results record](../../reviews/cofold-method-comparison-2026-11-12/README.md).

## Experimental reference poses

The [fixed three-complex crystal panel](../../reviews/cofold-crystal-reference-2026-11-13/README.md)
adds experimental ligand RMSD to the implementation comparisons. It supplies only
deposited protein sequence and exact CCD stereochemical SMILES to inference.
`experimental_reference.py` extracts references from pinned mmCIF/CCD files and
scores saved predictions in the whole-protein frame, retaining missing-residue
mapping, symmetry, each seed, confidence selection, oracle best-of-three and
tetrahedral-stereochemistry diagnostics. The charged aromatic N–H case exposed
and fixed a scorer limitation: bracket hydrogens are now restored by exact
declared chemical-graph correspondence before RDKit sanitization. No atom is
assigned by predicted distance. Existing frozen pose coordinates stay unchanged.

`prepare-experimental.mjs` reuses `writeNativeInputs()` from `prepare-native.mjs`;
it never includes crystal coordinates in native queries. `review-experimental.mjs`
adds each experimental structure once as a labelled display reference, without
copying review preferences or treating the reference as a computed pose.

## Interrupted native OpenBind jobs

Never restart a consumed output directory. First verify through the scheduler
that its job stopped, then capture an inventory **at the source before transfer**:

```sh
python folding/comparison/snapshot_native_outputs.py \
  --native /path/to/stopped-output --job-id 12345 --job-state NODE_FAIL
```

The job state is a recorded observation, not a command to stop work. Transfer the
entire source directory, inventory and exact consumed inputs. Original receipts
and coordinates stay unchanged; a running receipt left by a killed process is
never treated as a completed CLI invocation. A complete-attempt receipt or a
stopped-source inventory must account for every transferred model file/hash.
Missing files cause an error instructing the operator to retrieve them, rather
than quietly turning missing copies into more calculations.
Public receipts omit only private CLI paths and retain the original receipt
digest; recovery records bind both the original digest and the transferred
public receipt. The public interrupted-run archive can be replayed by placing
`receipt.public.json` and `stopped-output-inventory.json` in its extracted `raw/`
directory, then using `raw=inputs` as the attempt argument. A regression test
reproduces the exact 42-pose input digest from those public files.

```sh
python folding/comparison/native_cohort.py plan --inputs /original/cohort/inputs \
  --attempt /stopped/output=/stopped/consumed-inputs --allow-interrupted \
  --output /new/immutable-attempt
```

Run only the generated `groups/*/inputs` through `native_run.py`, each in a new
output directory inside a genuine GPU allocation. Original query IDs and seeds
are preserved. Missing seeds are grouped independently, so a compound with one
saved seed does not repeat it. The demonstrated recovery preserves six outputs
and submits only 42 missing poses. Tests also cover a partially completed seed
set. Normal scheduler handling may retry a node that failed before its batch
script started; any consumed scientific output directory still rejects replay.

After all missing groups finish, assemble original and resumed sources:

```sh
python folding/comparison/native_cohort.py assemble --inputs /original/cohort/inputs \
  --attempt /stopped/output=/stopped/consumed-inputs \
  --attempt /new/group-output=/new/group-inputs --allow-interrupted \
  --output /new/assembled-cohort
```

Assembly requires the complete unique compound/seed set, matching checkpoint,
protocol, input lineage, sequence and chemical identity. It copies original
structures without motion or inference. Each output retains its source attempt
and actual execution environment. An assembled complete cohort does not relabel
an interrupted native CLI as complete. Total CLI wall time remains unavailable
when interruption prevents measuring it. The assembled cohort can be converted
using the original full input manifest. A frozen 48-pose round-trip test checks
that all converted coordinate hashes remain identical.

This helper currently handles OpenBind mmCIF with explicit chemical topology;
Boltz recovery additionally needs its named input-cache extraction.

## Reproduce the residual figure

Install `requirements-plot.txt` in an isolated environment, then:

```sh
python folding/comparison/plot_residue_profiles.py \
  --profile 'Native 25 steps / 2 recycles=reviews/cofold-method-comparison-2026-11-12/openbind0-residue-profile.json' \
  --output /tmp/openbind-residuals --tail-start 72
```

PNG, SVG and a source/environment/artifact-hash receipt are emitted together.
The band is the empirical 10–90% range over cross-seed pairs, not a confidence
interval for experimental accuracy. Multiple profiles can be overlaid without
changing the underlying full-protein fits.

Primary references: [OpenFold3 v0.5.0 release](https://github.com/aqlaboratory/openfold-3/releases/tag/v0.5.0),
[OpenFold3 parameter reference](https://openfold-3.readthedocs.io/en/latest/parameters_reference.html),
[LocalFold](https://github.com/sokrypton/localfold), and
[Boltz](https://github.com/jwohlwend/boltz).
