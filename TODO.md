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
- [ ] Compare the production STORMM worker directly with independently built native OpenMM Systems; preserve supported/unsupported case coverage explicitly.
- [ ] Extend the two-device direct-engine matrix to a third GPU vendor and longer-time dynamics/ensemble gates.
- [ ] Diagnose the intermittent first-checkpoint import hang after rapid replay-route navigation. It reproduced on unchanged pre-fix source and a Linux post-merge CI rerun; instrumented probes pass without establishing the root cause. Keep this separate from the improved server-startup diagnostics.

## Reference-guided design

- [ ] Add a separately labelled, reference-preserving restrained pocket relax: keep inherited ligand heavy atoms fixed, move edited/released ligand atoms and nearby receptor side chains, and retain the selected pharmacophore contacts as explicit restraints. Validate it independently from the current unconstrained pocket-relax action.
