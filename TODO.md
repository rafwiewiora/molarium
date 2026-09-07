# Molarium roadmap

The broader roadmap is in [NEXT-BEST-IDEAS.md](./NEXT-BEST-IDEAS.md).
The dated [Astra review and remediation log](./reviews/ASTRA_REVIEW_OF_SOL_WORK_2026-09-05.md)
separate confirmed defects, completed fixes, and remaining validation work.
Design findings have their own [public finding-to-fix ledger](./reviews/DESIGN_FINDINGS_AND_FIXES_2026-09-06.md)
with stable `DV-` identifiers and links to original observations and follow-up evidence.

## Simulation correctness and release gates

- [x] Reject empty/incomplete benchmark gates, enforce exact finite 3N force vectors, and verify protocol content and result schemas (R3).
- [x] Correct native original-input scoring and archive new derived scores without overwriting raw evidence (R5).
- [x] Refresh Local Lab hashes, synchronize its privacy UI test, and add a non-mutating manifest freshness check in CI (R6).
- [x] Reject unsupported whole-System force content and unsupported STORMM cutoffs; validate numeric physical domains before GPU dispatch (R1, R7).
- [x] Restrict development-server file exposure and bind loopback by default (R2).
- [x] Validate STORMM frame requests and exact output shapes; wire production-worker numerical smoke tests into explicitly software-labelled CI (R4, part of R8).
- [ ] Add scheduled physical cross-vendor release gates beyond the software correctness smoke job (remaining R8).
- [x] Compare the production STORMM worker directly with independently built native OpenMM Systems; 22/22 supported cases pass on M1 Pro and L4, with 25 unsupported cases retained explicitly.
- [ ] Extend STORMM to matched multi-replica/native ensemble timings and longer-time constrained/OBC2 validation; single-replica job timing is not an ensemble speedup claim.
- [ ] Extend the two-device direct-engine matrix to a third GPU vendor and longer-time dynamics/ensemble gates.
- [x] Trace the rapid-navigation checkpoint hang to a never-settling IndexedDB open; defer blank-story opens, close connections on navigation/version change, and fail explicitly on bounded open timeout. The source-hashed rapid-navigation probe completes 10/10 imports after the fix.
- [ ] Extend the database-navigation regression across browsers; the underlying Chromium storage failure is not independently diagnosed.

## Reference-guided design

- [x] Run the [three-system API and hands-on browser functional panel](./reviews/DESIGN_FUNCTION_VALIDATION_2026-09-06.md); preserve successes, preparation failures, and the failed required-contact-set gate.
- [x] Preserve required-contact decisions through registered graph edits and contact-list rendering, invalidate stale candidate feasibility after requirement changes, and preserve an unchanged single donor H across registered staging; both original CDK2 contacts now survive the source-stable API regression (DV-01).
- [x] Separate cached candidate geometry from live geometry measured using current participant coordinates; commit applied alternative-feature maps with Undo/Redo state (DV-02).
- [x] Distinguish inherited identity, released subsets and actual fixed core in the UI/API; provide concise accessible **i** help for 143 static workspace parameter/action controls plus dynamic Design controls, with explicit navigation exclusions and API-only overrides (DV-04).
- [x] Make carbon-bound F hypotheses explicitly weak and optional by default under a versioned, primary-source-grounded capture policy; preserve explicit requirements and historical feature identities (DV-03). A general fluorine interaction model is not claimed.
- [ ] Diagnose the uncurated full-assembly 1H1Q preparation's modeled-atom 0.098 Å clash without weakening the guard (DV-05).
- [ ] Add a separately labelled, reference-preserving restrained pocket relax: keep protected inherited ligand heavy atoms fixed, move edited/released ligand atoms and nearby receptor side chains, and retain the selected pharmacophore contacts as explicit restraints. Validate it independently from the current unconstrained pocket-relax action (DV-06).
- [ ] Extend full-complex Undo, matched API/UI water-policy, cross-browser, and coupled rotamer/minimization validation; the current panel's limited observations are retained as such (DV-07).
