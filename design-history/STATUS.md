# Design history and reproducible story movies — durable handoff

Last updated: 2026-08-30

Integrated branch: `dev`

Merged PR: [#5](https://github.com/rafwiewiora/molarium/pull/5)

Merge commit: `de2a02d089dccf8fc22c102244e254ca0d8a8fbb`

## Objective

Build durable “git for molecules” infrastructure for medicinal-chemistry
campaigns. A campaign must preserve what a human or agent proposed, what was
calculated or measured, what progressed, and what was explicitly not
progressed. A movie is compiled from that record rather than authored as a
separate, cleaner history.

The record contains visible evidence, hypotheses, actions, results, and
decisions. It does not claim to preserve private chain-of-thought.

## Architecture implemented

The system has three complementary records:

1. **Chemist Actions** (`molarium.chemist-actions/v1`) records how the visible
   browser tools were operated. Replay is permitted only through this frozen
   public API.
2. **Calculation labbooks** record the exact numerical protocol and its
   hash-linked events.
3. **Design campaigns** (`molarium.design-campaign/v1`) form an append-only,
   tamper-evident decision graph over content-addressed molecule snapshots,
   action scripts, and molecule commits.

Implemented modules:

- `integrity.mjs`: canonical plain-JSON encoding and WebCrypto SHA-256.
- `ledger.mjs`: campaign, event, snapshot, commit, branch, decision, and
  finalization records; actor/source vocabularies; complete verification.
- `replay.mjs`: validated serial replay through Chemist Actions, including
  bounded result bindings for newly added atom IDs. Direct coordinate or
  internal callback shortcuts are rejected recursively.
- `movie.mjs`: hash-linked deterministic movie manifests and frame expansion.

Important guarantees already tested:

- molecule snapshots, scripts, commits, event entries, whole campaigns, and
  movies are hash checked;
- event IDs are recomputed during verification;
- repeated real measurements are allowed when their recorded times differ;
- stopped/deferred designs remain first-class decisions instead of deletion;
- branch heads and parent commits are retained;
- finalized campaigns are immutable;
- replay stops and records the first failed public action;
- captured values can be reused by later public actions without arbitrary code;
- movie cues cannot refer to missing events, commits, or snapshots.

## Pilot campaigns generated

Run:

```text
node design-history/stories/build-pilot-stories.mjs
```

The deterministic outputs are under `design-history/stories/generated/`.

### Moonshot lead to DNDI-6510

- 9 molecular commits, 30 events, 10 decisions.
- Explicitly retains four not-progressed approaches and the eventual archived
  program decision, not only the successful `(S)-x1 → (S)-x38` line.
- Current campaign SHA-256:
  `39ff4d2fd81b367b8527643646e6890c44f69822a4e5bb1837bfd5ccb07b1e95`
- Primary source: DOI `10.1101/2025.06.16.660018`, PMCID `PMC12262575`.
- Exact CCD structures are used for RPZ in PDB 7GN8 and RZU in PDB 7GNR.

### BCL-xL fragment linking

- 11 molecular commits, 35 events, 11 decisions, and 5 replayable trajectory scripts.
- Preserves both the compound 7 route and linker branches that retained
  biochemical affinity but failed to translate to cellular activity.
- Current campaign SHA-256:
  `3bab186b499d4716917b80177adbededd05f097cefa880c4b91999eb9b10b659`
- Primary source: DOI `10.1021/jm300178u`, PMID `22448988`, PMCID `PMC3397176`.
- Exact CCD structure B50 from PDB 3SPF is used for compound 4. Exact literature
  graphs for compounds 6, 7, 16, and 21 are reconstructed against the aligned
  3SP7/03B complex and remain explicitly labeled as reconstructed.

### Executable 7KPA rehearsal

- 4 molecular commits, 14 events, 4 decisions.
- Converts the three high-disruption enumeration plans to scripts containing
  only public Chemist Actions. The tetrahydropyran script demonstrates safe
  capture and reuse of the persistent ID returned for a newly added atom.
- Current campaign SHA-256:
  `ef4f091831004b55d3e377386852860abc93a5be93cdd4b7d315de4330d4e5ad`
- The pyrazole and tetrahydropyran cases progress through the registered
  development screen. The spiro case remains explicitly not progressed because
  contact feasibility coexisted with 11 clashes and +1870.38 kcal/mol raw
  receptor–ligand Lennard-Jones energy.

Literature reconstructions label claims as `reported-in-source` or
`molarium-reconstruction`. They do not falsely imply that the historical
authors used Molarium. The 7KPA story is separately labeled as an executable
infrastructure rehearsal, not a medicinal-chemistry or affinity claim.

## Viewer and renderer implemented

`design-history/viewer/` is a standalone, responsive campaign review. It shows
the verified molecule or an explicit no-structure-asserted placeholder, the
decision graph, chronological labbook, actor types, progressed and stopped
states, source locators, and campaign/movie hashes. The bundled RDKit
WebAssembly worker draws canonical SMILES locally. Cue and frame URLs are
deterministic, and playback, keyboard stepping, graph selection, and timeline
selection all use the same movie manifest.

`scripts/render-design-story.mjs` captures each unique cue in headless Chrome,
hashes the PNGs, maps them to exact movie frame ranges, and optionally assembles
an MP4 with FFmpeg. FFprobe must report the exact scheduled frame count or the
render fails. The completed 7KPA demonstration has 324 frames at 30 fps,
1440 × 900, and four provenance-linked cue images. Local output is ignored
under `outputs/`; the render manifest records the browser, renderer, input, PNG,
and video hashes.

Browser QA found and fixed two issues before release: RDKit jobs initially
missed the worker's required `type: run` envelope, and the custom fatal overlay
CSS overrode its HTML `hidden` state. The smoke test now checks actual local SVG
depiction, non-occluded layout, logo loading, campaign integrity, graph nodes,
timeline events, and cue navigation.

## Tests currently passing

```text
npm run test:design-history
npm run test:design-history-browser
npm run build:web
```

The focused suite currently reports:

```text
design-history tests passed: 7 events, 15 movie frames
design-history story tests passed: 3 campaigns, complete commit dispositions, deterministic rebuild
design-history viewer model tests passed: 9 commits, 8 branches
design-history browser test passed: 4 commits, 9 labbook events, local SVG depiction
```

## Completion state

The first design-history feature is complete and merged. Local and GitHub
Scientific validation, Browser integration, Production build, and Cloudflare
Pages checks all passed. The feature branch remains on the remote as a
recoverable development record; new work should branch from current `dev`.

Reasonable next increments, not blockers for this release:

1. Capture a human-reviewed complete literature-story movie for the paper.
2. Curate exact machine-readable structures for historical snapshots that
   currently carry an explicit no-structure-asserted placeholder.
3. Connect live in-app design sessions to campaign creation so user decisions
   can be committed without a separate story-builder script.
4. Add signed release attestations if identity/authorship verification becomes
   necessary; the current SHA-256 hashes detect mutation but are not signatures.

## Post-merge molecular movie increment

Branch `feature/structure-story-movies` adds the first real-coordinate story
renderer. Public RCSB PDB files 7GN8, 7GNR, 3SPF, and 3SP7 are source-hashed; derived
protein, 5 Å pocket, ligand, interaction, and aligned-overlay assets are
reproducibly generated. A standalone Mol* viewer provides deterministic camera
interpolation and frame selection for:

- the experimental `(S)-x1` 7GN8 → `(S)-x38` 7GNR DNDI-6510 comparison; and
- the experimental 3SPF BCL-xL compound-4 starting complex and the API-replayed
  4→6→7→16→21 trajectory, with reconstructed states visibly separated from
  experimental coordinates.

Structure-story MP4s are rendered from every scheduled molecular frame rather
than from repeated slide images. Every frame transition uses the public Chemist
Actions API, and the render manifest pins the complete API audit beside the
story, structure assets, renderer, browser, viewport, frame hashes, MP4 hash,
and exact frame count.

## Development constraints

- Work only in the Molarium development checkout for this public feature.
- Public files must not contain private project or proprietary application
  names.
- Larger features use a PR into `dev`; push progress promptly.
- Do not bypass Chemist Actions by setting coordinates or calling internal
  chemistry/scoring functions from story replay.
- Keep rejected designs and failed replay attempts; never rewrite them away.
- Use local bundled RDKit assets. No new network dependency is required by the
  story viewer.
