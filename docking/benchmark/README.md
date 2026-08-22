# Molarium bioisostere pose-propagation benchmark

This dataset tests whether a reference-bound ligand can be edited into an analogue while preserving
an auditable interaction hypothesis and producing a physically credible constrained pose. It is not
a binding-affinity benchmark.

The first frozen cohort targets 25 systems:

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

Paired-crystal cases additionally record symmetry-corrected analogue heavy-atom RMSD, edited-group
RMSD, torsion error, and contact recovery for top 1 and top 5 poses. Prospective cases report no
crystal RMSD. Adversarial cases pass only when the pre-registered failure or warning is exposed.

Aggregate reports must show every case, stratify the three tiers, and report success with confidence
intervals. A prospective feasibility rate must never be described as docking accuracy.

## Files

- `study-plan.v0.1.json` defines the cohort before case selection.
- `manifest.v0.1-draft.json` contains the locally available seed case and will grow to 25 entries.
- `validate-manifest.mjs` enforces identity, provenance, tier counts for frozen manifests, and the
  separation between prospective feasibility and paired-crystal accuracy.

The checked-in 7KPA/D84 case seeds the harness. It is a prospective transformation because no
cyclohexanone analogue crystal is currently used as a hidden answer.
