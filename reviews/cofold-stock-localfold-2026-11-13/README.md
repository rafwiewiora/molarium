# Stock LocalFold workflow control

**Prepared and input-validated; no stock-page prediction has completed here.**
The existing Molarium pose benchmarks must not be relabeled as stock-page runs.

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
The launcher replaces only the harness's HTTP/CDP port numbers and its fixed
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
execute inside a real allocated GPU job; this launcher neither allocates a GPU
nor proves which adapter the page used. Verify that separately before making
hardware or performance comparisons. Keep the task's profile on storage with
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

Local validation so far: three launcher guard tests pass, a real YTHDF2
preparation-only invocation succeeds, and the original job reader retains the
exact sequence, SMILES and alignment. No folding accuracy or speed result is
asserted by those checks.
