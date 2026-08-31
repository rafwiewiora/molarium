# Design history and reproducible story movies — branch handoff

Last updated: 2026-08-30

Branch: `feature/design-history-movies`

Target branch: `dev`

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

- 10 molecular commits, 32 events, 10 decisions.
- Preserves both the compound 7 route and linker branches that retained
  biochemical affinity but failed to translate to cellular activity.
- Current campaign SHA-256:
  `8668fe791923b32e3358ec13f11232f21da3e545aaedb8f3d53a015f6a89f0f2`
- Primary source: DOI `10.1021/jm300178u`, PMID `22448988`, PMCID `PMC3397176`.
- Exact CCD structure B50 from PDB 3SPF is used for compound 4.

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

## Remaining work

1. Run the complete scientific and browser CI lanes from the finished branch.
2. Commit and push this viewer/renderer checkpoint.
3. Open a PR to `dev`, monitor all checks, and merge only when green. The user
   has authorized opening and merging this PR.

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
