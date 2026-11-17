# Reviewer coverage and reference-label fixes

The first updated end-to-end check passes on the first case from the frozen
cohort, **8cjg__1__1-a__1-d**: all six original predictions and the separate
experimental reference render across every grid page. Exact pose notes and
preferences persist after reopening. Library JSON, shortlist JSON and PDB
downloads preserve the original coordinates and explicit ligand graph. The
[latest actual result](planned-slots-preflight-result.json),
[screenshot](planned-slots-preflight.png) and
[consumed source hashes](planned-slots-source-pins.json) are preserved. The
earlier complete-input preflight remains in `preflight-result.json`.

The serial software-rendered browser sweep **passed all 48 preselected systems**
at six samples per case: 288 prediction records and 48 separate references,
across 192 grid pages in the two library variants. The
[actual cohort receipt](all48-six-sample/receipt.json) retains every per-case
result, log, frozen source and selected screenshot. The completed first-case
preflight was reused; the other 47 cases were each attempted once.
A [saved-receipt check](all48-six-sample-verification.json) independently verifies
input/source hashes and exact pose-page coverage against the original exports.
No neural prediction, provider request, scientific preference or
experimental-reference inference was performed. This six-sample result remains
preserved separately from the completed ten-sample sweep below.

The final **ten-sample workflow also passed all 48 systems**: 480 original
predictions and 48 separate references across 288 grid pages, exercising both
prediction-only and reference-inclusive libraries. Every case passed exact
note/preference persistence after reopening and library/shortlist/PDB exports.
The [actual full-cohort receipt](all48-ten-sample/receipt.json),
[all saved-input checks](all48-ten-sample-verification.json), and
[terminal controller record](all48-ten-sample-completion.json) retain the frozen
sources, every case result/log and selected screenshots. The first completed
preflight was reused and the other 47 cases were attempted once. The independent
verifier reproduces against the final ten-sample exports and runs in CI without
new inference or another browser sweep. The reviewer starts with empty human
decisions; automated sentinel preferences are UI tests, not scientific selections.

## Findings and fixes

**UI-COVERAGE-01 — the previous browser receipt had a narrower scope than the
data checks.** Five posthoc example libraries contain 30 predictions. Their
graphs, coordinates and display alignment were checked for all five cases.
However, the original
[browser receipt](../checkpoint-288/review-examples/browser-check.json) covers
only **8px8__1__1-a__1-d**, with its first four prediction cards and first
reference-inclusive grid. It does not prove that all five examples, all six
seeds, or the entire 48-case cohort rendered. That historical receipt remains
unchanged. The expanded
[browser harness](../../../scripts/stock-cofold-review.browser.mjs) selects an
explicit manifest case, walks every pose page, checks every displayed pose ID,
and exercises persistence and exports. The
[cohort runner](../../../folding/comparison/run_stock_review_cohort.py) requires
every case from the original frozen plan, keeps failures, and refuses incomplete
page coverage or a different input manifest.

**UI-REFERENCE-01 — adding a reference shifted visible prediction numbers and
showed prediction metadata on the experimental card.** The crystal record used
the required numeric placeholder seed zero, which the reviewer displayed as
“Seed 0,” alongside unavailable confidence and inference timing. Inserting that
record also changed prediction 1 into prediction 2. The
[reviewer fix](../../../vendor/foldarium/library-review.js) numbers predictions
consistently across both file variants and presents an explicit experimental
reference card without seed, model-confidence or inference-time fields. PDB
download names use the same stable prediction numbers or an explicit
`experimental-reference` suffix. Original stored IDs, source ordering,
coordinates, chemistry and confidence values are preserved.

**UI-REFERENCE-02 — keep original slots when earlier requests fail.** Computing
an ordinal from completed cards alone could renumber later predictions in a
partially finished library. The final fix uses the original sample slot and
subtracts only explicitly inserted reference slots. The first-case check also
imports an explicitly synthetic UI fixture with its first request marked
failed. The next original prediction retains number 2, and exporting preserves
the failed entry. This synthetic state is confined to a separate temporary
browser library; it is not a model result, inference failure or benchmark case.

The first full-cohort sweep was [stopped by its owner](prior-cohort-stop.json)
after five cases passed, to cover this additional edge case before deployment.
It had no UI failures and made no neural calls. The interrupted UI case is not
classified as a scientific failure. The new immutable sweep used the corrected
source and completed first-case preflight, and passed all 48 systems. Its earlier
source and receipts remain available for history.

**UI-EXPORT-01 — inspect exported scientific state, not only the preference
counter.** The updated check verifies the exact selected pose ID and note after
reopening. It clicks the actual library-export and shortlist controls and hashes
every exported PDB and component graph against the imported originals. It also
checks the prediction and reference PDB-download bytes and filenames. Test
downloads are intercepted inside the isolated browser profile. The sentinel
preference is explicitly a UI test, never a scientific selection; source library
files retain empty decisions and the temporary profile is removed on close.

**UI-PROVENANCE-01 — retain the upstream reconstruction check after local UI edits.** CI correctly rejected the old distributed reviewer hash. The receipt now records the new distributed bytes and an exact reversible presentation patch, while preserving the original Foldarium revision and upstream hash. The existing integrity test reconstructs the original upstream file byte for byte; its assertions were kept intact. The Local Lab manifest was regenerated. This provenance-only follow-up was prepared in an isolated checkout so the active UI sweep retained its frozen sources; the executable reviewer bytes are identical in both checkouts.

## Actual deployed preview check

The [deployed preview result](deployed-preview-6458c742/result.json) passes the same saved-pose workflow for the first frozen system: six predictions, the separate reference, every grid page, exact notes/preferences after reopening, full and shortlist JSON, PDB downloads, stable reference labels and the explicitly synthetic earlier-failure state. The [actual HTML/module comparison](deployed-preview-6458c742/http-source-check.json) matches all six source files after normalizing only release-version queries.

During these observed actions, [22 page requests](deployed-preview-6458c742/network-check.json) were read-only and all targeted the reviewer page or [known static assets](deployed-preview-6458c742/network-static-path-check.json). No upload, unrelated origin or unexpected query key was observed. Query values and request bodies were not recorded. This is a test of one saved-input workflow, not a general privacy or legal guarantee. The isolated browser profile was removed on close.

The [exact consumed adapter](deployed-preview-6458c742/run.mjs) and [reversible source certificate](deployed-preview-6458c742/source-adaptations.json) retain only import/root/URL substitutions and observational network instrumentation with additional assertions. Reversing those changes restores the original browser harness exactly; the shared helper and existing UI actions/assertions were not edited. The adapter records local task paths and this specific preview URL; it is preserved execution evidence rather than a portable application entry point.

## Reproduce

The existing [exporter](../../../folding/comparison/export_stock_review.py)
reconstructs these files from the public six-sample checkpoint without folding.
From the repository root, generate the entire frozen cohort in a new directory:

```sh
python - <<'PY'
import json, sys
from pathlib import Path
sys.path.insert(0, 'folding/comparison')
from export_stock_review import export
root = Path('reviews/cofold-rnp-spectrum-2026-11-15')
cases = [p['caseId'] for p in json.loads((root / 'frozen-stock-plan.json').read_text())['pairs']]
output = Path('/tmp/rnp-all48-review')
export(root / 'checkpoint-288', output, cases, 6,
       attribution_file=root / 'dataset-attribution.json')
(output / 'README.md').write_text(
    'All 48 cases from the pre-inference frozen plan, with six saved samples each.\n'
    'No cases were selected or omitted after seeing the results.\n'
    'See manifest.json for the prediction-only and separate reference files.\n')
PY
```

Then run one selected case through the real reviewer:

```sh
MOLARIUM_STOCK_REVIEW_EXPORTS=/tmp/rnp-all48-review \
MOLARIUM_STOCK_REVIEW_CASE_ID=8cjg__1__1-a__1-d \
MOLARIUM_STOCK_REVIEW_REPORT=/tmp/rnp-case-ui-result.json \
bun scripts/stock-cofold-review.browser.mjs
```

The archived preflight forced SwiftShader WebGL through a task-local Chrome
wrapper and disabled WebGPU. The ordinary command uses the machine's configured
browser graphics path. Neither command runs a folding API. Browser QA timing is
not simulation or inference throughput.

These structures retain the attribution and CC BY 4.0 terms of the
[Runs N’ Poses source dataset](../dataset-attribution.json). UI checks establish
software behavior at saved inputs; they do not validate binding, pose accuracy
or native/browser numerical agreement.

## Preserved CI startup failure

At commit `bdffb43`, the first Browser integration job timed out discovering the
Chrome page before its reviewer assertions ran. One identical failed-job-only
retry passed, with no source, helper, gate or timeout change. All required checks
then passed. The exact original startup cause remains unknown.
[Original log](ci-browser-bdffb43/original-failure.log),
[retry request](ci-browser-bdffb43/retry-request.json),
[actual retry result](ci-browser-bdffb43/retry-result.json) and
[retry log](ci-browser-bdffb43/identical-retry.log) preserve both outcomes.

To verify these saved UI receipts without opening a browser, first regenerate
the six-sample exports with the command above, then run:

```sh
python reviews/cofold-rnp-spectrum-2026-11-15/review-ui-2026-11-16/verify-saved-cohort.py \
  --cohort reviews/cofold-rnp-spectrum-2026-11-15/review-ui-2026-11-16/all48-six-sample \
  --exports /tmp/rnp-all48-review --output /tmp/rnp-saved-ui-verification.json
```

## Final ten-sample input

The [actual first-case ten-sample workflow](ten-sample-first-case/result.json)
now passes on the completed final files: ten original predictions and one
separate reference, all six grid pages across the two file variants, exact
notes/preferences, library/shortlist/PDB exports and the explicit synthetic
earlier-failure regression. The [frozen full-cohort plan](ten-sample-first-case/frozen-cohort-plan.json)
then reuses that completed preflight and runs the remaining 47 systems once.
That full ten-sample sweep completed with all 48 systems passing; its full
receipt and saved-input verification are linked above. The six-sample all-48
result remains separate historical evidence.

To verify the final saved receipts against the published ten-sample inputs:

```sh
python reviews/cofold-rnp-spectrum-2026-11-15/review-ui-2026-11-16/verify-saved-cohort.py \
  --cohort reviews/cofold-rnp-spectrum-2026-11-15/review-ui-2026-11-16/all48-ten-sample \
  --exports reviews/cofold-rnp-spectrum-2026-11-15/checkpoint-480/review-libraries \
  --output /tmp/rnp-final48-saved-ui-verification.json
```

CI additionally regenerates all 96 exports from the original final prediction
archive before running this saved-receipt check. No neural inference or browser
sweep is repeated by the verifier.


## Full ten-sample gate: original startup failure and identical retry

At source `f09ed1b6d47e988861f4ac74ffcba39a35cbe0d8`, CI run
44016665941 first timed out discovering its Chrome page, before the closed-storage
assertions ran (job 133816230980). One failed-job-only retry used the identical
source, shared helper, timeouts and gates. Job **133824840775** then passed all
browser checks, finishing at **2026-11-17T05:03:00Z**. The cause of the original
startup timeout remains unproven; the successful retry does not identify it.
[The original failure](ci-browser-f09ed1b/original-failure.log),
[actual retry outcome](ci-browser-f09ed1b/retry-outcome.json), and
[successful retry log](ci-browser-f09ed1b/retry-success.log) preserve both outcomes.
No native computation, inference output, helper or acceptance gate was changed.
The evidence ZIP is also attached to the
[trained-trunk evidence release](https://github.com/rafwiewiora/molarium/releases/tag/cofold-trained-trunk-2026-11-17).


## Canonical production network finding

The first ten-sample workflow on molarium.org reached the final network guard
after its UI assertions, then failed on an additional Cloudflare analytics-script
origin. No non-read-only requests were observed; script execution or molecular
data transmission is not established. [DN-01](../../COFOLD_REVIEW_PRODUCTION_NETWORK_2026-11-17.md)
preserves the exact original failure and independent CSP-block diagnostic.
After the user-reported analytics setting change, the [fresh production follow-up](production-molarium-org-attempt002/remediation-outcome.json)
passed unchanged assertions on one final ten-sample case, with all six pages and
no extra-origin requests. The original failed attempt is retained; this is not
a new all-48 production sweep or a general privacy guarantee.
