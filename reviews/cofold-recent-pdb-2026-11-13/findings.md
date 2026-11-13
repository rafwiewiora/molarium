# Recent-panel findings and linked fixes

An independent [fixed-input transition-layer audit, LCP-01](../cofold-layer-parity-2026-11-13/README.md)
also found a fast-variance failure on a near-constant stress input. Its exact
arrays and experimental row-shift correction are preserved separately. No causal
connection to these pose errors is established; the correction is not deployed.

| ID | Evidence / finding | Change | Regression / remaining work |
| --- | --- | --- | --- |
| RCF-01 | KIT's inter-ring single bond was flagged aromatic; YTHDF2's equivalent Kekule spelling differed in raw model bond/aromatic features. Sanitized identity alone passed. Original baseline graphs are retained. | [RDKit WASM canonicalization](../../rdkit-worker.js), [worker client](../../folding/ligand-normalization.mjs) and [inference boundary](../../folding/localfold.mjs) normalize before conformer generation/features; preserve source/canonical hashes and charge/stereo. | [Actual browser chemistry probe](../../scripts/cofold-ligand-chemistry.browser.mjs), [independent RDKit feature/stereo check](../../folding/comparison/validate_ligand_inputs.py), [worker lifecycle tests](../../folding/ligand-normalization.test.mjs), [real-case regressions](../../folding/comparison/test_recent_pdb.py). All nine input graphs pass. Pose improvement is not established. |
| RCF-02 | Scoring exact bond types before sanitization rejected equivalent Kekule/aromatic representations. | [Scorer](../../folding/comparison/pose_metrics.py) restores only omitted bracket H through element/connectivity correspondence, preserves actual bonds/charges, sanitizes, and requires exact declared non-stereo chemical state. No coordinates determine chemical identity. | [Real KIT/YTHDF2 tests](../../folding/comparison/test_recent_pdb.py) accept equivalent spellings and reject changed formal charge or a carbonyl bond order. |
| RCF-03 | An asymmetric-unit-only selection can miss biological symmetry partners. Cached lower-ranked sources can also bias selection if higher-ranked sources are missing. | [Selection policy v2](../../folding/comparison/recent_pdb.py) checks generated deposited biological assemblies; unavailable higher-ranked sources block that release date. This amendment preceded inference and retained the same nine identities. | [Generated-partner and cache-order regressions](../../folding/comparison/test_recent_pdb.py); original v1/v2 preparation history in [archive](selection-evidence.zip). |
| RCF-04 | Poor crystal reconstruction persists with valid input chemistry. Original Boltz: 1/27 within 2 Å; normalized Boltz/OpenBind: 0/27 each. | Retain every result, global protein-frame scoring, separate protocol labels, and [all-candidate Foldarium review](index.html). No accuracy claim is inferred from a successful execution or chemistry check. | [Per-seed scores](browser-scores.json). Provided-MSA and native controls remain necessary; current results do not identify the cause. |
| RCF-05 | Benchmark API launch sent an internal case ID absent from the public schema. It was rejected before any library/inference started. | [Harness](../../scripts/cofold-library.browser.mjs) keeps case IDs in the report, sends only public action fields, surfaces API errors, saves failed bundles before assertions and checkpoints completed poses. A distinct corrected attempt completed 27/27 OpenBind predictions. | Runtime API execution and export/review checks passed. A later Chrome startup failure also occurred before any inference and was retried separately. No completed poses were repeated for either retry. |
| RCF-06 | A native MSA control can silently become a single-sequence task if paths, query flags or parser filenames are wrong. | [Portable input writer](../../folding/comparison/prepare-native.mjs) writes exact A3M bytes and explicit query flags; [native wrapper](../../folding/comparison/native_run.py) resolves paths into new output configs without changing source inputs; [official pipeline preflight](../../folding/comparison/preflight_native_msa.py) requires actual row consumption. | The actual pinned official CPU processor read all nine alignments. Its 257 stacked residue/deletion rows exactly match browser OpenBind ([comparison](msa256/openbind-feature-comparison.json), [source/environment](msa256/official-source.json)). [Writer](../../folding/comparison/prepare-native.test.mjs) and [source-integrity/path tests](../../folding/comparison/test_native_msa_inputs.py) pass. Native model inference is still pending; row agreement is not full-model parity. |
| RCF-07 | The first new input checker measured an untagged graph without a conformer, so it could report zero specified centres and pass vacuously. This was found during review before publication. | [Checker](../../folding/comparison/validate_ligand_inputs.py) now maps actual supplied coordinates onto the declared stereochemical template. It reports the expected centre count. | [Exact-count regression](../../folding/comparison/test_recent_pdb.py) requires 0,1,3,0,2,0,0,0,2 centres across the panel. All [162 saved browser input conformers](all-input-conformers.json) have the declared stereochemical identity. |
| RCF-08 | sEH's cage produced fixed mapped CIP label differences despite matching the declared stereochemical graph. Unspecified centres assigned from 3D and equivalent atom mappings can change those labels. | [Stereo diagnostic](../../folding/comparison/experimental_reference.py) requires a chirality-aware graph mismatch before calling a mapped label difference an inverted stereoisomer. It retains mapped differences separately. | [Real cage and true KIT inversion regressions](../../folding/comparison/test_recent_pdb.py) pass. [Previous diagnostic output](analysis-history/scores-before-stereochemical-graph-check.json) is retained; RMSD values are unchanged. A genuine OpenBind STARD4 seed-2 configuration failure remains reported. |
| RCF-09 | A long Boltz standard run stopped because its cached IndexedDB connection was closing. | [Molarium storage adapter](../../folding/library-store.mjs) invalidates closed/version-changed handles and retries a closing-connection operation once. Quota and unrelated errors propagate. [Host monitor](../../scripts/checkpoint-cofold-browser.mjs) now closes its read-only connections. Vendored Foldarium bytes remain unchanged. | [Actual Chrome regression](../../scripts/cofold-storage.browser.mjs) closes a connection before checkpointing, then verifies exact counts, no repeated predictions, concurrent reads and decisions. Quota is attempted once. |
| RCF-10 | A recovery run reported three NSP3 poses complete, but only seeds 1/2 remained. All host snapshots were checked: seed 0 is unavailable. An earlier handoff incorrectly called a seed-1 snapshot a seed-0 backup. Low disk space was observed; the underlying browser data-loss cause is not proven. | [Execution guard](../../folding/library.mjs) checks previous durable checkpoints, and [atomic storage writes](../../folding/library-store.mjs) repeat that validation inside the write transaction. On loss, preserve the current result, stop, record missing IDs/hashes and block automatic resume. [Partial receipt](boltz-standard-partial-receipt.json) distinguishes 14 available, one lost and 12 not-run poses. | [Unit regression](../../folding/library.test.mjs) and [actual IndexedDB deletion during the validation/write gap](../../scripts/cofold-storage.browser.mjs) retain the new result, stop before the next prediction and reject automatic reruns. [Recovery assembler](../../folding/comparison/assemble-browser-panel.mjs) preserves PDB bytes/source statuses and rejects missing or duplicate seeds. |

## RCF-11: native single-sequence controls

All 54 recent native poses are now preserved and included in the interactive
review. Boltz has three KIT placements within 2 Å, but each has the wrong
specified stereochemical identity. OpenBind has no pose within 2 Å and large
protein-fold errors in eight systems. Zero native poses pass the joint geometric
and limited stereochemistry/clash checks. These are protocol controls, not
matched-tensor numerical parity; no change to model mathematics is made to
improve the benchmark result. The exact-MSA native controls remain separate.

[Public raw evidence](native-boltz2-single-standard/evidence.json) includes
mmCIF coordinates, explicit named ligand graphs, source inputs and scientific
receipts. The [reconstruction checker](../../folding/comparison/check_native_panel.py)
and [regression](../../folding/comparison/test_native_panel.py) verify source
hashes, reconstruct all exports from native coordinates/topology and recompute
every crystal score. Cache pickle files are hashed but never executed by the
public-data checker. Every failed pose remains visible.

## RCF-12: provided-MSA recovery inputs

The native recovery planner retained the alignment declaration but omitted its
A3M file, and could accept a descendant with a different alignment. The
[linked finding and fix](../COFOLD_MSA_RECOVERY_2026-11-13.md) preserve exact
verified bytes in retry inputs and reject alignment drift. Existing saved poses
and interrupted-source receipt statuses remain unchanged. No inference is
repeated to test this correction.

## RCF-13: startup initialization and inspectable recovered cohorts

Two MSA Boltz controls failed before inference (an incomplete dependency import
and a missing canonical component). The wrapper follows the stock CLI import
order; new attempts verify official canonical assets before model execution.
Public recovered cohorts now carry each original status, exact source inputs,
runner, coordinates and stopped-output inventory. Offline validation rejects
changed source evidence and verifies full unique seed coverage without folding.
[Finding, scope and linked fixes/tests](../COFOLD_NATIVE_RECOVERY_EVIDENCE_2026-11-13.md).

## RCF-14: full native OpenBind MSA and old-crystal Boltz controls

The exact-MSA/200-step native OpenBind phase now contains all 27 predictions.
Eight meet 2 Å; one KIT pose has the wrong specified stereochemistry, leaving
seven passing the limited stereo/clash checks (STARD4, sEH and WDR5). Across
nine systems the median seed-paired mean browser/native ligand disagreement
is 3.47 Å despite matching declared alignment and sampling effort. Complete
input tensors, precision, conformers and random draws remain unmatched.
[Results, per-pose evidence, timings and limitations](README.md#native-msa-control-matched-alignment-and-sampling-effort).

The old native Boltz panel is also complete: all nine poses pass the 2 Å and
limited stereo/clash checks, including FK5's missing-only retry. Its agreement
with the browser is close for JQ1/benzene but poor for FK5; different sampling
effort precludes attributing the difference to the port alone.
[Crystal results and every saved prediction](../cofold-crystal-reference-2026-11-13/README.md).
The [public reconstruction regressions](../../folding/comparison/test_native_panel.py)
check all new raw outputs, source hashes, recovered cohorts, scores and timings.

Original predictions and reference files are immutable evidence. Review assembly
adds display labels and reference cards while retaining original PDB bytes,
coordinate hashes and source-library identities. Public review decisions start
empty; preferences made later remain local and exportable.
