# Molarium roadmap

The broader roadmap is in [NEXT-BEST-IDEAS.md](./NEXT-BEST-IDEAS.md).
The dated [Astra review and remediation log](./reviews/ASTRA_REVIEW_OF_SOL_WORK_2026-09-05.md)
separate confirmed defects, completed fixes, and remaining validation work.

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

- [ ] Add a separately labelled, reference-preserving restrained pocket relax: keep inherited ligand heavy atoms fixed, move edited/released ligand atoms and nearby receptor side chains, and retain the selected pharmacophore contacts as explicit restraints. Validate it independently from the current unconstrained pocket-relax action.
