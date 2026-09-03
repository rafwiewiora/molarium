# Molarium bioisostere pose-propagation benchmark v0.1.0

This dataset tests whether a reference-bound ligand can be edited into an analogue while preserving
an auditable interaction hypothesis and producing a physically credible constrained pose. It is not
a binding-affinity benchmark.

The frozen v0.1.0 cohort contains 25 cases across 15 protein targets:

- **10 paired-crystal cases.** Both the reference ligand and a congeneric analogue have experimental
  complex structures. The analogue crystal is hidden from pose generation and used only for scoring.
- **10 prospective cases.** A bioisostere is proposed before running Molarium. These measure workflow
  completion, chemical validity, contact feasibility, strain, determinism, and failure handling, but
  cannot establish pose accuracy without a later experimental structure.
- **5 adversarial negatives.** Deliberately difficult or impossible replacements test whether the
  workflow reports ambiguity, strain, or infeasibility rather than manufacturing a success.

The cohort is append-only. A frozen release never changes; corrections create a new manifest version
and identify the superseded case. Every source coordinate/CCD file and every result artifact is
SHA-256 addressed.

## Pre-registration rules

Before a case is run, its manifest entry fixes:

1. the reference PDB entry, biological assembly/model, ligand component and chain;
2. retained waters, ions, alternate locations, pH, tautomer and protonation assumptions;
3. the product molecular graph and the exact recorded graph edit;
4. the transferable receptor interaction hypothesis and allowed donor/acceptor role;
5. search seeds, pose count and protocol version;
6. success metrics and failure categories; and
7. for paired crystals, the hidden analogue structure and atom mapping used only by the scorer.

No case may be removed because it fails. Human intervention after seeing a result is a new protocol
arm, not a correction to the original run.

## Primary measurements

All cases record chemistry sanitization, stereochemistry, inherited-core RMSD, required-contact
feasibility, each alternative contact geometry, ligand strain relative to the fixed-core seed,
receptor interaction components, deterministic replay, runtime, peak memory, warnings and a terminal
failure category.

Paired-crystal cases additionally record protein-CA-aligned, frozen atom-label heavy-atom RMSD and
edited-group RMSD for top 1 and top 5 poses. v0.1.0 does not claim symmetry correction; the exact
product-index/CCD-atom-name scoring map is frozen in the hidden-answer manifest. Prospective cases
report no crystal RMSD. Adversarial cases pass only when the pre-registered failure is exposed.

Aggregate reports must show every case, stratify the three tiers, and report success with confidence
intervals. A prospective feasibility rate must never be described as docking accuracy.

## Frozen v0.1.0 result

The first registered 25-case run is complete. Five paired cases reached withheld-crystal scoring;
their median-of-repeats best-of-five heavy-atom RMSD was 3.163 Å, with 2/5 at or below 2 Å. The
single best pose observed across all three seeds gave a 1.905 Å median and 3/5 at or below 2 Å, and
is reported separately rather than used as the primary estimate. Seven of ten
prospective proposals were feasible, while all four runnable adversarial negatives remained
infeasible. Five paired structures exposed strict preparation blockers, and the remaining stopped
cases are retained under their registered failure categories. See [`RESULTS.v0.1.md`](RESULTS.v0.1.md)
for the complete stratified result, uncertainty intervals, limitations, and artifact hashes.

## Files

- `study-plan.v0.1.json` fixes the cohort size, tier counts, protocol and terminal outcomes.
- `curation.v0.1.json` is the frozen human-readable case selection.
- `fixtures/index.v0.1.json` and `fixture-validation.v0.1.json` pin every public PDB/CCD byte.
- `atom-maps.v0.1.json` records the exact product graph, common atoms, edit boundaries and hidden
  paired-crystal atom labels.
- `interaction-scan.v0.1.json` records the reference interactions observed after the registered
  preparation protocol.
- `run-input.v0.1.json` is the blinded browser input; paired analogue coordinates are absent.
- `manifest.v0.1.json` combines the frozen inputs and hidden scoring records.
- `run-browser-benchmark.mjs` performs real browser preparation, OpenFF Sage parameterization,
  reference capture, product staging, role-compatible contact transfer and pose refinement.
- `score-results.mjs` aligns the ligand-assigned protein chains and evaluates withheld analogue
  coordinates only after pose generation.
- `benchmark-results.v0.1.json` is the complete registered result with per-repeat coordinates and
  hash-linked labbooks; `benchmark-results.v0.1.scored.json` is its compact withheld-crystal score.
- `RESULTS.v0.1.md` is the human-readable registered report.
- `validate-results.mjs` rejects hash drift, incomplete registered runs, broken labbooks, implausible
  bond lengths, extreme energies, fabricated negative-control transfers and incomplete paired scores.

The cohort is intentionally heterogeneous. Five paired cases retain preparation blockers found
before execution; they remain counted. The 7KPA/D84 cyclohexanone case is prospective because no
cyclohexanone analogue crystal is used as a hidden answer.

## Reproduce locally

The frozen atom-map builder records RDKit 2025.09.5. Activate an environment that provides it, or set
`MOLARIUM_RDKIT_PYTHON` to that environment's Python executable.

```sh
npm run test:docking-benchmark-curation -- --write
npm run fixtures:docking-benchmark
npm run test:docking-benchmark-fixtures -- --write
npm run build:docking-benchmark-atom-maps
npm run test:docking-benchmark-atom-maps
npm run scan:docking-benchmark-contacts
npm run test:docking-benchmark-interactions
npm run build:docking-benchmark-manifest
npm run test:docking-benchmark-manifest
npm run run:docking-benchmark
npm run score:docking-benchmark
npm run test:docking-benchmark-results
```

The browser runner is local-only. Its run input contains no hidden analogue coordinates. Smoke runs
use `bun docking/benchmark/run-browser-benchmark.mjs --case CASE_ID --smoke` and are never mixed with
the registered report.
