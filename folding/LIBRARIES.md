# Cofold a library and review it in Foldarium

In **Protein folding → Compound library → Foldarium review**, paste one protein
sequence and SMILES lines, optionally followed by unique names. Choose OpenBind-0
or Boltz-2 under **Library method**, with the alignment, sampling steps, recycles
and base seed above it. This selection is independent of the single-prediction model.
Choose poses per compound (default three), then **Cofold library**.

The queue runs serially on the browser's GPU. It reuses loaded model weights and
the protein alignment, but computes the full protein–ligand model for every
compound and seed. It does not reuse a ligand-independent protein trunk, dock
into a frozen receptor, or claim affinity predictions. Entries with identical
SMILES are preserved if their IDs differ.

Every completed pose is committed to IndexedDB before starting another.
**Pause** interrupts the current pose; **Resume unfinished** explicitly retries
interrupted/unstarted poses while preserving original attempts and skipping all
completed or failed work. Invalid ligands become explicit failed records and the
queue continues; device loss or storage failure stops the queue. After a tab is
closed, choose its saved library and resume explicitly. Keep the tab open and
prevent the computer from sleeping. Background scheduling depends on the browser.
Only one library may hold this origin's GPU queue lock at a time.

A closing storage connection is reopened once. If earlier checkpoints disappear,
the queue retains the current result when possible, records the loss and stops;
that run cannot resume automatically. Export available results and keep earlier
exports. Browser storage can be evicted and is not a backup. Importing an export
creates a separate review-only identity; it does not restore a running queue.

The progress bar combines completed predictions with an approximate current-pose
fraction. The display reports the active compound/seed, stage, completed/failed
counts and session time. ETA uses measured warm wall times after the first
successful pose. It is a running estimate: different ligands, GPU load, resumed
shader compilation and browser throttling can change it. The first pose includes
weight loading and compilation and is reported separately in benchmark receipts.

**Review in Foldarium** opens the actual Foldarium library-review source hosted
on Molarium's origin. This lets it read the same local checkpoints. Compare up
to four independently seeded poses per compound, or inspect one at a time.
Choose prefer/reject/unreviewed, add notes, or select none of these poses. Ligands
move with their own receptors under a protein Cα alignment; they are never fitted
to each other. Confidence and prediction-to-prediction Cα RMSD are not
experimental correctness labels. Every pose shows its model and execution backend;
native comparison records without a measured individual inference time say so.
The exact Foldarium source pin and narrowly
defined asset URL transformation are in `vendor/foldarium/UPSTREAM.json`.
The separately operated `www.foldarium.org` deployment is not changed by a
Molarium release; exported libraries can move between origins when its reviewer
route is made available there.

**Export library + decisions** preserves inputs, full protein–ligand PDBs,
component graphs, exact seeds/settings, model/source hashes, timings, failures
and human decisions. **Export shortlist** in Foldarium includes preferred poses
with their receptors and provenance. Import creates a new local identity and
cannot overwrite a running library. A shared A3M can be stored once as
`run.alignment`; per-pose provenance references it and retains its SHA-256.

By default, quadratic PAE arrays are omitted from library storage, with their
float32 little-endian SHA-256 and size retained. Turn on **Retain full PAE
matrices** before starting if needed. Confidence values and complete structures
are always retained. Review and execution use compact indexes and load full
structures per compound, rather than loading the entire library. Full JSON
export currently assembles one document in memory. Import is limited to 500 MB;
split large libraries and keep exported backups. Actual GPU memory and browser
storage limits apply even below the input bounds of 10,000 compounds and 20 poses.

Only MSA search sends the protein sequence to its selected service. Model
downloads fetch immutable public weights. SMILES, predictions and review
decisions stay local; the reviewer has no molecular upload endpoint. Local Lab
blocks the externally loaded prediction backend before starting a library.

## API

The visible workflow and API use the same queue and storage:

```js
const api = await window.MolariumChemistActionsReady;
const pending = api.execute({action: 'protein.cofoldLibrary', args: {
  sequence: 'NLYIQWLKDGGPSSGRPPPS',
  compounds: [{id: 'ethanol', smiles: 'CCO'}, {id: 'benzene', smiles: 'c1ccccc1'}],
  name: 'Candidate library', model: 'localfold-openbind0', samples: 3, seed: 0,
  msaMode: 'single', steps: 25, recycles: 2, retainPae: false
}});
// These two routes bypass the long action queue.
await api.execute({action: 'protein.libraryStatus'});
await api.execute({action: 'protein.pauseLibrary'});
const {result: {library}} = await pending;
await api.execute({action: 'protein.resumeLibrary', args: {runId: library.runId}});
```

Seeds are base seed + sample index, reused across compounds. This is a
reproducible request specification; floating-point results may vary by GPU.
Use `model:'localfold-boltz2'` for the Boltz-2 structure model. Both browser
cofolding models use int5 weights through LocalFold; their confidence scales are
model-specific, and neither route provides binding-affinity estimates.
The API also accepts the textarea's SMILES/name line format. The 10,000-entry
structural input allowance is scoped to this bulk route; ordinary actions retain
their existing input limits. Known failures are not automatically retried: make
a new library with corrected inputs if they need another attempt.

## Measured throughput and tests

See [raw runs and timing boundaries](../reviews/library-cofolding-2026-11-12/README.md).
On the tested Apple M1 Pro, 25 sampling steps/two recycles/single-sequence input
averaged 1.03 seconds per warm pose at 20 residues and 2.75 seconds at 76 residues
with small ligands. First poses took 13.93 and 12.59 seconds. These are
single-machine engineering measurements, not pose-accuracy validation or a speed
promise for larger proteins, ligands, MSAs or other GPUs.
The follow-up 16-compound/48-pose library completed in 135.31 seconds, averaging
2.62 seconds per warm pose, with no failed predictions and stable instrumented
post-pose GPU-buffer counts.
The same 48 requests through Boltz-2 completed in 185.91 seconds, with a 29.11-second
first pose and 3.33 seconds per warm pose. See the
[method comparison record](../reviews/cofold-method-comparison-2026-11-12/README.md)
for raw outputs, comparison definitions and the independent native protocol.

```sh
node --test folding/library.test.mjs folding/integration.test.mjs
npm run build:web
# Review/export regression using completed scientific outputs; no inference rerun:
MOLARIUM_LIBRARY_REUSE=reviews/library-cofolding-2026-11-12/standard/library-1.json \
  bun scripts/cofold-library.browser.mjs
# A new actual throughput experiment (downloads public weights):
MOLARIUM_LIBRARY_REPORT=/tmp/cofold-throughput \
  bun scripts/cofold-library.browser.mjs --extended
```
