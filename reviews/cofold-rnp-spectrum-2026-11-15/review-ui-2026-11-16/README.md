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

A serial software-rendered browser sweep of **all 48 preselected systems** is
running under the [updated frozen UI plan](planned-slots-frozen-cohort-plan.json). It uses the
[already verified 288-prediction exports](cohort-export-manifest.json), reuses
the completed first-case preflight, and attempts the other 47 cases once. Its
deadline is 17 November at 02:00 UTC. This plan is not proof that all 48 cases
have passed; final per-case receipts are still pending. No neural prediction,
provider request, scientific preference or experimental-reference inference is
performed by these UI checks.

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
classified as a scientific failure. The new immutable sweep uses the corrected
source and the new completed first-case preflight. Its deadline remains 02:00
UTC, and the earlier source/receipts remain available for history.

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
