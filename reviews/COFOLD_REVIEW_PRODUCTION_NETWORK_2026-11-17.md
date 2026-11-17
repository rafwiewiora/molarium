# Production reviewer network verification

**DN-01 — Resolved in the observed production workflow.** After the user disabled
automatic Cloudflare Web Analytics, the unchanged ten-sample Foldarium review
passed on molarium.org with 22 GET requests to known static assets or the reviewer
and zero extra-origin requests. Scientific outputs and application code are unchanged.

The study was merged in [PR #56](https://github.com/rafwiewiora/molarium/pull/56)
at `5ddf1d2add2eda26cde40cd16fd3fee20c15847c`. Cloudflare reported a successful
production deployment. An HTTP check matched all six delivered reviewer HTML/module
assets to exact build-version transformations of the repository sources.
The actual custom-domain browser check then exposed additional behavior:

| Observation | Original attempt | Follow-up after the setting change |
|---|---|---|
| Existing pose-display, persistence and export assertions | Reached the final network assertion | Passed |
| Extra script origin | Two GET events for `static.cloudflareinsights.com/beacon.min.js` | None |
| Empty-page diagnostic | Script present in DOM; load failed with `blockedReason: csp` | Script absent; zero extra-origin requests |
| Unchanged static-origin guard | Failed | Passed |

The original request events establish an attempted script load. The separate
CSP diagnostic confirms a blocked load on its observed page. Neither observation
establishes script execution or molecular-data transmission. Request bodies and
query values were never captured. No inference, provider job or scientific
selection was performed. The original failed receipt remains intact.

No repository runtime source contains the analytics origin or snippet.
[Cloudflare's setup documentation](https://developers.cloudflare.com/web-analytics/get-started/)
describes automatic injection and **Manage site → Disable**. The user reported
disabling that setting; the dashboard configuration was not independently read.
Fresh browser observations verify the resulting production behavior.

The full follow-up covered ten original predictions, their separate experimental
reference, all six grid pages, exact notes/preferences after reopening,
JSON/shortlist/PDB exports, stable prediction numbers and an explicitly synthetic
earlier-failure-slot regression. Its source and assertions are identical to the
original attempt. This checks one canonical production case. The existing all-48
local browser sweeps retain their original scopes; this observation is not a
general privacy guarantee.

Original sources, plans, file hashes, screenshots and observations are preserved:

- [Original production attempt and HTTP source check](cofold-rnp-spectrum-2026-11-15/review-ui-2026-11-16/production-molarium-org-attempt001/artifact-index.json)
- [Original empty-page CSP diagnostic](cofold-rnp-spectrum-2026-11-15/review-ui-2026-11-16/production-csp-diagnostic-attempt001/result.json)
- [Post-change empty-page diagnostic](cofold-rnp-spectrum-2026-11-15/review-ui-2026-11-16/production-csp-diagnostic-attempt002/result.json)
- [Passing production workflow and exact outcome hashes](cofold-rnp-spectrum-2026-11-15/review-ui-2026-11-16/production-molarium-org-attempt002/remediation-outcome.json)

Both production adapters reverse exactly to the public
`scripts/stock-cofold-review.browser.mjs` source. This case shows why verification
should include the actual custom-domain browser network alongside source hashes
and preview-domain checks.

The automatic post-merge CI run had a separate Chrome-page discovery timeout
before its initial assertions. One source-identical failed-job retry passed at
2026-11-17T05:43:20Z. The main tree equals the fully passing PR tree.
[Actual logs and retry outcome](cofold-rnp-spectrum-2026-11-15/review-ui-2026-11-16/ci-main-5ddf1d2/retry-outcome.json)
preserve both outcomes; helper, timeouts and gates are unchanged. The cause of
that startup timeout remains unproven.
