# Current manuscript/API reconciliation — 2026-09-06

Target: `paper/revisions/2026-09-06-current-sos1-api-a05/`. Base: author decisions a04. Public API baseline: `2ab30383d6160349aa3b1e980f7239d6854b329d` (PR #22 merged). The revision's reconciliation manifest records 20 exact replacements and all asset hashes, linking changes to the MR-T findings in [the technical review](TECHNICAL-REVIEW-2026-09-06.md).

## Changes and evidence

- MR-T01–03: current six-panel Figure 2, reference-informed scientific boundary, matching AWW/BAY-293 measurements, and the distinct purposes of recomputation, exact checkpoint inspection, and MP4. Verified against the frozen release, generated SOS1 measurements and popup-movie v2 manifest. No later crystal coordinates were imported into the trajectory; this does not establish blinded prediction.
- MR-T06–09: campaign persistence and explicit Resume; fixed-receptor constrained search versus side-chain pocket relaxation versus whole-residue induced-fit relaxation; hydrogen-bond acceptance checks are not minimization restraints; discrete rotamer search is separate. Corrected example inspection scopes lacking a captured pocket reference. Checked current API definitions and application implementation.
- MR-T10–13: f32 coordinate-mirror limitation, native OpenMM benchmark coverage and precision gates, WASM/native and timing-scope distinctions, and the connected-mode remote MSA exception. Checked repository benchmark records and current implementation. No new benchmark runs are implied.
- New MR-C16: request nesting was documented as eight levels but the code permits twelve. Corrected ordinary request, script-load node, and campaign-import byte limits.
- The author's requested removal of the default 500-entry audit limit is tested locally. It is not yet deployed at the pinned public commit. `chemist-actions-history.test.mjs` covers full retention, explicit bounded retention, invalid limits and defensive copies.

## Checks and limitations

`node --test paper/review/current-api-contract.test.mjs`: 2 tests passed; 52 example envelopes, 35 action names. Evaluates only object literals in an isolated context, checking action names and top-level argument keys. Does not invoke molecular operations, validate all argument values, or establish runtime correctness of every example.

`npm run verify:sos1-publication`: passed local release preflight; 159 public actions, seven exact checkpoints, 62.75 s movie, five one-second calculation-status popups. This is not a new deployment verification.

Tectonic: 71-page PDF, no missing characters, overfull boxes, undefined references/citations or TeX errors. Ordinary underfull table warnings remain. Figure 2 and replay description inspected in rendered output; final bundle QA also checks all page thumbnails and changed appendix pages.

Appendix C and the bibliography are byte-for-byte preserved from the author-reviewed base. Historical claims in C are not silently rewritten as present-day claims. The machine-readable manifest allows independent reconstruction of every current-state edit. Unselected prose suggestions remain unselected.
