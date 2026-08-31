# A durable design history, not a success-only movie

Date: 2026-08-30

Participants: human project lead and OpenAI Sol

## Human request

The project lead asked for infrastructure that could reconstruct a published
hit-to-lead medicinal-chemistry story as operations a chemist could perform in
Molarium, record a movie of those operations, and preserve decisions for years.
The request emphasized “git for molecules”: designs that were not progressed
must be kept alongside successful designs, and human and agent contributions
must remain distinguishable.

## Agent implementation decisions

The implementation separates three records that answer different questions:

- Chemist Actions: what visible browser operation occurred?
- calculation labbook: what numerical protocol ran?
- design campaign: why did a design progress, stop, fail, or remain deferred?

Campaign objects are content addressed. Events form a hash chain. Molecule
commits form a parent graph with named branch heads. Decisions use explicit
dispositions, including `not-progressed`, rather than deletion. Movie cues are
linked to the finalized campaign hash.

Replay accepts only the frozen public Chemist Actions API. A safe binding
mechanism records values returned by one action—such as a newly created atom's
persistent ID—and passes them to a later public action. It does not expose
coordinate injection, callbacks, modules, or arbitrary code.

## First source-grounded stories

Two public medicinal-chemistry papers were selected as complementary stress
tests:

1. The open-science `(S)-x1` to DNDI-6510 campaign preserves three parallel
   Ames-mitigation approaches, branches that were explicitly discontinued, the
   successful spiro-lactam series, lead selection, and the later discontinuation
   of preclinical development.
2. A BCL-xL/BCL-2 fragment-linking campaign preserves the weak Site 1 and Site 2
   starting compounds, their >10,000-fold affinity gain after linking, and the
   diverging linker branches whose biochemical potency did or did not translate
   into cellular activity.

A third 7KPA story is deliberately labeled as a Molarium infrastructure
rehearsal. Its three graph transformations compile to Chemist Actions, and its
negative spiro result demonstrates why satisfying H-bond constraints cannot be
treated as physical pose validity.

## Provenance boundary

Historical claims are labeled `reported-in-source`; ordering or interpretation
added during curation is labeled `molarium-reconstruction`. The records do not
claim that historical authors used Molarium, and they do not include or imply
private hidden reasoning. They preserve observable requests, hypotheses,
actions, evidence, and decisions.

## Public sources

- Griffen et al., *Open-science discovery of DNDI-6510*,
  DOI `10.1101/2025.06.16.660018`, PMCID `PMC12262575`.
- Zhou et al., *Design of Bcl-2 and Bcl-xL Inhibitors with Subnanomolar Binding
  Affinities Based Upon a New Scaffold*, DOI `10.1021/jm300178u`,
  PMID `22448988`, PMCID `PMC3397176`.
- RCSB PDB entries 7GN8, 7GNR, 3SPF, and 7KPA.

## Review and movie implementation

The campaign record now drives a standalone review rather than a custom story
page. The central record, branch graph, and chronological labbook are three
views of the same verified objects. Selecting a graph node or labbook event
moves the same cue state; a movie is therefore a deterministic schedule over
the public record, not a separately edited account.

Local RDKit WebAssembly draws only snapshots with an asserted canonical
SMILES. Literature designs without a curated exact graph receive an explicit
placeholder. This avoided a visually appealing but scientifically false guess.

The first visual browser run exposed three implementation failures and changed
the tests:

1. The new depiction request lacked the RDKit worker's required `type: run`
   envelope, so the interface waited forever. The browser test now requires a
   local SVG before passing.
2. The local server did not label SVG files as `image/svg+xml`, so `nosniff`
   correctly blocked the logo. SVG and PNG MIME types are now explicit.
3. The fatal-error overlay used an author `display:grid` rule that overrode its
   `hidden` attribute, leaving a verified page blank. The test now checks both
   computed overlay visibility and a painted central workspace.

The initial FFmpeg concat-file implementation also repeated the last cue's
full duration: a 324-frame manifest produced a 420-frame movie. The renderer
now creates one explicitly timed image stream per cue and refuses the result
unless FFprobe reports the exact scheduled frame count.

The resulting render manifest records campaign and movie hashes, source paths,
renderer hash, Chrome build, viewport, each cue PNG digest and frame range, and
the optional MP4 digest. Story records and schedules are byte-deterministic.
Raster bytes are provenance-pinned rather than claimed identical across
different browser, font-rasterization, operating-system, or codec builds.

## Integration result

The feature was reviewed as public pull request
[#5](https://github.com/rafwiewiora/molarium/pull/5). Scientific validation,
browser integration, production build, and the Cloudflare preview all passed.
It was merged into `dev` as commit
`de2a02d089dccf8fc22c102244e254ca0d8a8fbb` on 2026-08-30 Pacific time
(2026-08-31 UTC).
