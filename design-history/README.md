# Molecular design history

Molarium records a medicinal-chemistry campaign as an append-only decision
graph, then derives reviews and movies from that record. The purpose is not to
make a polished success story after the fact. It is to retain proposed designs,
failed calculations, stopped branches, superseded ideas, imported evidence,
and the decisions that connected them.

Open the standalone review at
[`/design-history/viewer/`](./viewer/index.html) while the Molarium server is
running.

## Record layers

Three records have deliberately different responsibilities:

1. **Chemist Actions** records operations available through Molarium's visible,
   versioned chemistry interface. Executable design scripts may replay only
   through that API.
2. **Calculation labbooks** record a numerical protocol, inputs, outputs,
   timings, and implementation provenance.
3. **Design campaigns** record snapshots, molecular commits, branches,
   observations, hypotheses, measurements, and explicit progress decisions.

Snapshots, action scripts, commits, individual events, complete campaigns, and
movie manifests are SHA-256 content addressed. Events also form a hash chain.
`verifyCampaign()` recomputes those identities, validates parent and branch
references, and rejects a mutated record.

Actors are typed as `human`, `agent`, `system`, or `imported-source`. That field
records who made an observable contribution. It does not infer authorship from
prose and it does not expose private model chain-of-thought. Public records may
contain requests, proposals, tool actions, results, concise rationales, and
decisions—the material another scientist can inspect and reproduce.

## Historical reconstruction versus executable replay

The two literature stories are source-grounded reconstructions. Claims copied
from a source are labelled `reported-in-source`; chronology or interpretation
added by this project is labelled `molarium-reconstruction`. A reconstruction
does not claim that the original authors used Molarium.

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
7GN8, 7GNR, 3SPF, and 7KPA.

## Render a review or movie

```sh
# Fast visual smoke: two provenance-linked PNGs
bun scripts/render-design-story.mjs \
  --story molarium-7kpa-rehearsal --smoke

# Complete cue set and MP4
bun scripts/render-design-story.mjs \
  --story moonshot-dndi-6510 --video
```

Every distinct cue is captured once. The render manifest maps that PNG to the
exact frame range in the movie schedule and records the campaign hash, movie
hash, renderer hash, Chrome build, viewport, file digest, and optional MP4
digest. Story inputs and frame schedules are byte-deterministic. Raster output
is provenance-pinned rather than claimed to be byte-identical across different
browser, operating-system, font-rasterization, or codec builds.

Output defaults to ignored `outputs/design-history/<story>/`. Use `--output`
to select another directory.

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

