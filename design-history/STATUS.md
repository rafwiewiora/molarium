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

- 9 molecular commits, 28 events, 8 decisions.
- Explicitly retains four not-progressed approaches and the eventual archived
  program decision, not only the successful `(S)-x1 → (S)-x38` line.
- Current campaign SHA-256:
  `cb1ed98c6ae0598ae218d05ee8da7d02337414f772c4ee7f2b9a1a91a5eda178`
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

- 4 molecular commits, 13 events, 3 decisions.
- Converts the three high-disruption enumeration plans to scripts containing
  only public Chemist Actions. The tetrahydropyran script demonstrates safe
  capture and reuse of the persistent ID returned for a newly added atom.
- Current campaign SHA-256:
  `a7ec193b1972bc93dd13fa95db4b174d2f03c37393eddebf20dc01cf8cfbbc4f`
- The pyrazole and tetrahydropyran cases progress through the registered
  development screen. The spiro case remains explicitly not progressed because
  contact feasibility coexisted with 11 clashes and +1870.38 kcal/mol raw
  receptor–ligand Lennard-Jones energy.

Literature reconstructions label claims as `reported-in-source` or
`molarium-reconstruction`. They do not falsely imply that the historical
authors used Molarium. The 7KPA story is separately labeled as an executable
infrastructure rehearsal, not a medicinal-chemistry or affinity claim.

## Tests currently passing

```text
node design-history/design-history.test.mjs
node design-history/stories/build-pilot-stories.mjs
```

The first command currently reports:

```text
design-history tests passed: 7 events, 15 movie frames
```

## Remaining work

1. Add generated-story validation tests (source/fact labels, decision counts,
   executable action boundaries, deterministic rebuild).
2. Implement `design-history/viewer/`:
   - campaign and story selector;
   - branch graph plus chronological event rail;
   - human / agent / system / imported-source badges;
   - prominent progressed / not-progressed / deferred states;
   - local RDKit 2D depiction when canonical SMILES is present;
   - play, pause, step, scrub, and deterministic `?cue=` / `?frame=` URLs.
3. Implement `scripts/render-design-story.mjs` with headless Chrome frame capture,
   optional FFmpeg assembly, frame digests, and a render manifest.
4. Add module and threat-model documentation, including redaction/privacy and
   the distinction between historical reconstruction and executable replay.
5. Add package scripts and production-build file entries; run focused tests,
   full scientific CI, production build, and browser visual checks.
6. Create and render at least one deterministic demonstration movie.
7. Commit/push incremental work, open a PR to `dev`, monitor all checks, and
   merge only when green. The user has authorized opening and merging this PR.

## Development constraints

- Work in `/Users/bb/repos/molarium-dev`, never the Marco repository for this
  public feature.
- Public files must not contain private project or proprietary application
  names.
- Larger features use a PR into `dev`; push progress promptly.
- Do not bypass Chemist Actions by setting coordinates or calling internal
  chemistry/scoring functions from story replay.
- Keep rejected designs and failed replay attempts; never rewrite them away.
- Use local bundled RDKit assets. No new network dependency is required by the
  story viewer.

