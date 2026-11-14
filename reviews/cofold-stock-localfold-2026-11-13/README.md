# Stock LocalFold workflow control

**The full-budget stock-page benchmark is running:** 200 diffusion steps,
3 additional recycles (4 trunk passes) and 10 seeds per system/model pair.
The [frozen selection and 80 input jobs](benchmark-200x10/plan.json) contain only
pairs where the same native model produced a pose strictly below 2 Å from the
crystal. This includes all seven qualifying recent-panel pairs plus the earlier
FKBP12/FK5 Boltz diagnostic: eight pairs across seven proteins. Native
stereochemistry/clash failures are flagged separately in the selection.
The existing Molarium pose benchmarks must not be relabeled as stock-page runs.

The [initial 22-prediction snapshot](initial-snapshot/README.md) preserves every
completed result at its timestamp, including misses, raw page archives and
consumed source. An offline checker independently recomputed all 22 scores from
the public evidence. The remaining predictions continue as the separate frozen
batch; this interim snapshot is not the final ten-seed result.

The 210 vendored engine files match pristine LocalFold revision
`5ea3d42c911949700401b54003cb28c557fcf2a6`. The compiled model manifests also
match those recorded by our browser benchmarks. However, Molarium canonicalizes
SMILES and passes the model seed into `smilesComponent`. The original page passes
the SMILES directly and lets `smilesComponent` derive its conformer seed from
the SMILES hash. Identical engine source does not establish identical inputs.
The saved [integration audit](integration-audit.json) includes a small same-graph,
different-conformer control; it did not run a neural model.

## Run the original page

[`run_stock_localfold.py`](../../folding/comparison/run_stock_localfold.py) imports
the pristine upstream `tools/fold-in-page.py`, which loads the original
`index.html`, drops the input job onto the page and presses its Fold button.
It uses `--remote-weights`, so even the model-bundle index is served unchanged.
The launcher replaces the harness's HTTP/CDP port numbers and its fixed
browser-profile directory. All folding and ligand-preparation code stays in
the original checkout. It refuses a changed source revision, a dirty checkout,
multiple jobs/seeds and an existing output directory.

```sh
git clone https://github.com/sokrypton/localfold /path/to/localfold
git -C /path/to/localfold checkout 5ea3d42c911949700401b54003cb28c557fcf2a6
python folding/comparison/run_stock_localfold.py \
  --upstream-root /path/to/localfold \
  --job reviews/cofold-stock-localfold-2026-11-13/32qy-a1keo-seed0.json \
  --model boltz2 --steps 25 --recycles 2 \
  --output /path/to/new-stock-localfold-attempt
```

Add `--prepare-only` with a **different new output directory** to verify source,
job structure and the original CLI without launching Chrome or fetching weights.
The prepared directory is a receipt, not a resumable inference attempt.
Chrome and network access to the pinned upstream weights are required for a
fold. Original browser-launch flags are retained: upstream uses headless Chrome
on macOS, and normally headed Chrome with an X display on Linux/NVIDIA.
`LOCALFOLD_CHROME` can select the installed executable. On managed compute,
execute inside a real allocated GPU job; this launcher does not allocate a GPU.
After a completed fold it reads the original module's existing folding device
and profile, rejects software/fallback paths, and records the browser version.
`--require-vendor apple` or `--require-vendor nvidia` adds an explicit vendor
gate. This observer neither creates another folding device nor sets any tuning.
The original page's own timing report is also retained. Keep the task's profile on storage with
room for model/cache downloads, and retire that disposable profile when the
attempt no longer needs it.

The saved YTHDF2 input preserves the existing panel's sequence, raw SMILES and
256-row provided A3M exactly, in an AlphaFold 3 job container, with seed 0 and no
experimental coordinates. [Input provenance](input-provenance.json) records the
hashes. The unmodified upstream job reader accepted both entities, seed 0 and
the supplied alignment with no dropped-input warning. The requested 25 steps
and 2 recycles match our low-step control; other controls retain the original
page/job defaults. These explicit settings are not a claim about the website's
default sampling budget. A 200-step/3-recycle control is a separate attempt.

Each completed run must retain `prediction.pdb`, `job.zip`, the original harness
log and a receipt with source/input/output hashes and browser flags. The launcher
checks the page's actual model/step/recycle controls and runs upstream's separate
`check-job-archive.py` against the submitted job. A corrupt archive, mismatched
controls or changed checkout makes the attempt fail. This verifies execution
and artifacts; native agreement and experimental pose accuracy require the
existing independent protein-aligned scoring protocol. Equal integer seeds do
not imply equal random tensors or bitwise output across devices.

## Why this control matters

Run stock LocalFold and Molarium with the same declared input, model, settings
and hardware. If their outputs differ, inspect preparation/features before
attributing the difference to the port. Then compare the stock result with
native inference and the experimental pose. Existing results, failures and
sampling protocols remain preserved as separate evidence.

The initial preparation-only receipt remains preserved as a historical check;
it does not stand for a completed inference result. The active batch runs on the
same local Apple hardware used for our earlier browser benchmarks. It uses a
fresh profile for every prediction and retires only that run's disposable
cache/profile after saving the scientific outputs and score. No completed
native prediction is rerun. The original `smilesComponent` named graphs used by
the scorer are frozen separately, never injected into the folding page.

`run_stock_benchmark.py` refuses changed plan/launcher bytes, retains every
failure, and stops after three consecutive execution/scoring errors rather
than consuming the rest of the batch on a broken runtime. The independent
`score_stock_localfold.py` validates native selection evidence, requested
budget, receipt/output hashes, stock named chemistry and exact archived MSA
bytes. It uses the existing all-observed-Cα fit and symmetry-aware heavy-atom
ligand RMSD; no pocket or ligand fit is introduced. The full frozen budget and
native selection are also covered by the comparison test suite.
