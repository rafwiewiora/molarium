# RCF-13: native startup and portable recovery evidence

Two Boltz MSA controls stopped before any forward call or prediction was saved.
One reported a partially initialized Torch/ONNX diagnostics import; the other
reported a missing canonical ALA component. These failures are preserved as
startup failures, not scored poses. The exact cause of the asset-visibility
failure has not been established.

The [native wrapper](../folding/comparison/native_run.py) now imports the stock
Boltz CLI before obtaining the class it instruments, following the CLI's own
initialization order. It still calls that same official model class and CLI;
no model constructor, parameter, feature or sampling equation is replaced.
A [regression](../folding/comparison/test_native_entrypoints.py) exercises an
actual Python circular import in an isolated fixture process. It establishes
the wrapper's ordering, not a reproduction of every dependency-specific race.
The new native attempt also checks the installed stock class identity and
trusted cached canonical molecules before model execution. Its CPU preflight
passed. Both GPU retries subsequently completed; their six poses are included
in the full [native Boltz MSA phase](cofold-recent-pdb-2026-11-13/native-boltz2-msa256-standard/evidence.json).
[Original failure receipts, inputs and scheduler history](cofold-recent-pdb-2026-11-13/native-msa-startup-failures.json)
remain separate from completed pose scores.

Spot interruptions can leave scientifically complete outputs alongside a CLI
receipt still marked `running`. The [recovery validator](../folding/comparison/native_panel_recovery.py)
now makes these assembled cohorts portable: public archives retain each
source's consumed inputs and runner, original receipt identity/status, saved
coordinates, confidence and stopped-output inventory. Private absolute CLI
argument paths are omitted. The complete cohort is distinguished from its
interrupted source attempts; unavailable total CLI wall time remains null.

The [packager](../folding/comparison/package_native_panel.py) verifies every
source before publication. The [offline checker](../folding/comparison/check_native_panel.py)
reconstructs the source directories, repeats exact input/lineage/unique-seed
checks, reconstructs exported coordinates and recomputes crystal scores.
It never invokes a model or unpickles molecule caches. Different completed
cases can originate in different immutable attempts; each consumed runner is
checked against that case's receipt.

The [recovery regression](../folding/comparison/test_native_cohort.py) round-trips
frozen six-saved/42-resumed output fixtures while retaining the interrupted
status and rejects independently changed runner bytes, saved coordinates and
source inventory. It runs no new folding. The preceding
[alignment-lineage correction](COFOLD_MSA_RECOVERY_2026-11-13.md) remains required.
