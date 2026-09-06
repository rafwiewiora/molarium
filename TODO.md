# Molarium roadmap

The broader roadmap is in [NEXT-BEST-IDEAS.md](./NEXT-BEST-IDEAS.md).
The dated [Astra review and remediation log](./reviews/ASTRA_REVIEW_OF_SOL_WORK_2026-09-05.md)
separate confirmed defects, completed fixes, and remaining validation work.

## Simulation correctness and release gates

- [x] Reject empty/incomplete benchmark gates, enforce exact finite 3N force vectors, and verify protocol content and result schemas (R3).
- [x] Correct native original-input scoring and archive new derived scores without overwriting raw evidence (R5).
- [x] Refresh Local Lab hashes, synchronize its privacy UI test, and add a non-mutating manifest freshness check in CI (R6).
- [ ] Reject unsupported whole-System force content and unsupported STORMM cutoffs; validate numeric physical domains before GPU dispatch (R1, R7).
- [ ] Restrict development-server file exposure and bind loopback by default (R2).
- [ ] Validate STORMM frame requests and exact output shapes; wire live numerical GPU tests into CI (R4, remaining R8).
- [ ] Compare the production STORMM worker directly with independently built native OpenMM Systems; preserve supported/unsupported case coverage explicitly.
- [ ] Extend the two-device direct-engine matrix to a third GPU vendor and longer-time dynamics/ensemble gates.
- [ ] Diagnose the intermittent first-checkpoint import hang after rapid replay-route navigation on local Chrome. It also reproduced on unchanged pre-fix source; the rerun, Linux CI, and deployed saved-campaign regression pass.

## Reference-guided design

- [ ] Add a separately labelled, reference-preserving restrained pocket relax: keep inherited ligand heavy atoms fixed, move edited/released ligand atoms and nearby receptor side chains, and retain the selected pharmacophore contacts as explicit restraints. Validate it independently from the current unconstrained pocket-relax action.
