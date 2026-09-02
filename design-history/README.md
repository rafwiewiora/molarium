# Molecular design history

Molarium records a medicinal-chemistry campaign as an append-only decision
graph, then derives reviews and movies from that record. The purpose is not to
make a polished success story after the fact. It is to retain proposed designs,
failed calculations, stopped branches, superseded ideas, imported evidence,
and the decisions that connected them.

Open the standalone review at
[`/design-history/viewer/`](./viewer/index.html) while the Molarium server is
running.

The complementary molecular story viewer at
[`/design-history/structure-viewer/`](./structure-viewer/index.html) uses the
bundled Mol* renderer to show pinned experimental coordinates with deliberate
overview, pocket-zoom, orbit, and crystal-overlay camera moves. It currently
supports the 7GN8→7GNR DNDI-6510 story and a five-state BCL-xL trajectory from
compound 4 through compounds 6, 7, 16, and 21.

## Record layers

Four record types have deliberately different responsibilities:

1. **Chemist Actions** records operations available through Molarium's visible,
   versioned chemistry interface. Executable design scripts may replay only
   through that API.
2. **Calculation labbooks** record a numerical protocol, inputs, outputs,
   timings, and implementation provenance.
3. **Design campaigns** record snapshots, molecular commits, branches,
   observations, hypotheses, measurements, and explicit progress decisions.
4. **Registered design routes** use schema
   `molarium.registered-design-route/v1` to define a hit, allowed coordinate
   boundary, and ordered graph edits. They are input protocols, not history
   ledgers.

The append-only campaign ledger uses `molarium.design-campaign/v1`. A route
cannot pass ledger verification, and a ledger cannot be loaded as a route.

The main Build workspace exposes this ledger through **Design History**. One
`campaign.create` action can capture the current molecule as the first commit;
later actions commit snapshots, create or switch branches, merge an explicit
current molecular state, record a disposition, and verify the record. Campaign
JSON and the active branch are stored in IndexedDB. Closing a campaign clears
the active workspace pointer without deleting its saved commits. Workbench
import verifies the campaign before changing the session and requires a branch
head with a complete graph and coordinates. Reference-only campaign records are
consumed by the standalone viewers instead.

Snapshots, action scripts, commits, individual events, complete campaigns, and
movie manifests are SHA-256 content addressed. Events also form a hash chain.
`verifyCampaign()` recomputes those identities, matches commit events to commit
bodies, derives branch heads from the chained events, validates references, and
rejects a mutated record.

Actors are typed as `human`, `agent`, `system`, or `import`. That field
records who made an observable contribution. It does not infer authorship from
prose and it does not expose private model chain-of-thought. Public records may
contain requests, proposals, tool actions, results, concise rationales, and
decisions—the material another scientist can inspect and reproduce.

## Historical reconstruction versus executable replay

The two literature stories are source-grounded reconstructions. Claims copied
from a source are labelled `reported-in-source`; chronology or interpretation
added by this project is labelled `molarium-reconstruction`. A reconstruction
does not claim that the original authors used Molarium. The five visible BCL-xL
states also carry replay scripts made only from the public Chemist Actions API;
those scripts reproduce Molarium's presentation of the curated record, not the
historical authors' laboratory operations.

The 7KPA story is an infrastructure rehearsal. Its graph transformations are
represented as Chemist Actions scripts so the public replay boundary can be
tested. A result passing that development screen is not an affinity or
medicinal-chemistry claim.

A molecule snapshot may intentionally omit `canonicalSmiles`. In that case the
viewer says that no exact structure was asserted instead of drawing a guessed
chemical structure. This boundary is important for literature examples whose
text supports a design relationship but whose exact machine-readable graph has
not been curated.

## Build and verify the pilot records

```sh
npm run build:design-stories
npm run test:design-history
npm run test:design-history-browser
npm run test:live-campaign-production
```

The deterministic builder writes three campaigns and their movie manifests to
`stories/generated/`:

- the reported open-science route from `(S)-x1` to DNDI-6510, including stopped
  Ames-mitigation branches and the later archived program decision;
- the reported BCL-xL fragment-linking campaign, including potent biochemical
  branches that did not translate to cellular activity;
- the executable 7KPA Chemist Actions rehearsal, including its negative spiro
  design.

Primary literature and structure locators live inside each campaign record.
The current public sources include
[DOI 10.1101/2025.06.16.660018](https://doi.org/10.1101/2025.06.16.660018),
[DOI 10.1021/jm300178u](https://doi.org/10.1021/jm300178u), and the RCSB entries
7GN8, 7GNR, 3SPF, 3SP7, and 7KPA.

## Render a review or movie

```sh
# Fast visual smoke: two provenance-linked PNGs
bun scripts/render-design-story.mjs \
  --story molarium-7kpa-rehearsal --smoke

# Complete cue set and MP4
bun scripts/render-design-story.mjs \
  --story moonshot-dndi-6510 --video

# Every frame contains the actual 3D structure and interpolated Mol* camera
bun scripts/render-structure-story.mjs

# A second real-structure discovery example
bun scripts/render-structure-story.mjs \
  --story design-history/structure-viewer/bclxl-fragment-linking.json
```

Every structure-story frame is selected through `structureStory.selectFrame`
on the public Chemist Actions API. The render manifest associates each captured
frame with its API sequence number and pins a complete `chemist-action-audit.json`
alongside the renderer hash, Chrome build, viewport, file digests, and MP4
digest. Story inputs and frame schedules are byte-deterministic. Raster output
is provenance-pinned rather than claimed to be byte-identical across different
browser, operating-system, font-rasterization, or codec builds.

Output defaults to ignored `outputs/design-history/<story>/`. Use `--output`
to select another directory.

### Experimental structure boundary

Raw RCSB coordinate files and their SHA-256 digests are pinned under
`structures/`. The reproducible asset builder extracts chain, 5 Å pocket, and
ligand views. For the DNDI-6510 comparison it aligns 7GNR chain A onto 7GN8
chain A using 305 matched Cα atoms (0.209 Å RMSD), allowing a direct overlay of
the two experimental ligands. For BCL-xL, compound 4 remains the exact 3SPF
pose. Compounds 6, 7, 16, and 21 use exact literature graphs and deterministic
scaffold-constrained reconstruction against the aligned 3SP7/03B receptor
complex. Those states are always labeled as visualization hypotheses—not
deposited structures or docking predictions—and pass pinned identity, scaffold,
and receptor-contact gates.

## Trust and privacy boundary

- Campaign verification detects accidental or undeclared record mutation; it
  is not a digital signature and does not prove that a claim is true.
- A SHA-256 digest proves which bytes were reviewed, not who created them.
- Imported claims remain attributable to their source; calculations and
  reconstructions are separately labelled.
- Raw private transcripts are not part of the campaign format. Redacted,
  curated development episodes may be published separately.
- The viewer uses bundled RDKit WebAssembly for local 2D depictions. It does
  not need a structure service and does not upload campaign molecules.
- Executable scripts are recursively validated and may call only registered
  Chemist Actions. Direct coordinate injection, arbitrary callbacks, module
  imports, and internal chemistry shortcuts are rejected.
