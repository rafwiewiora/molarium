# Molarium roadmap

The broader roadmap is in [NEXT-BEST-IDEAS.md](./NEXT-BEST-IDEAS.md).
The dated [Astra review and remediation log](./reviews/ASTRA_REVIEW_OF_SOL_WORK_2026-09-05.md)
separate confirmed defects, completed fixes, and remaining validation work.
Design findings have their own [public finding-to-fix ledger](./reviews/DESIGN_FINDINGS_AND_FIXES_2026-09-06.md)
with stable `DV-` identifiers and links to original observations and follow-up evidence.

## Simulation correctness and release gates

- [x] Freeze a target-diverse, drug-like [recent PDB panel](reviews/cofold-recent-pdb-2026-11-13/README.md) from a complete release-window harvest; check generated biological assemblies before inference and preserve all exclusions.
- [x] Correct SMILES aromatic/bond input features before browser cofolding; retain original predictions and independently verify all nine input graphs and specified stereocentres ([finding RCF-01](reviews/cofold-recent-pdb-2026-11-13/findings.md)).
- [x] Complete both 27-pose provided-MSA browser phases and compare OpenBind alignment residue/deletion rows with the actual official CPU processor; preserve all 135 predictions and failures ([results](reviews/cofold-recent-pdb-2026-11-13/README.md)).
- [ ] Complete 200-step browser controls, native GPU references, and further matched-input feature/numerical comparisons; broad recent-panel reconstruction remains unresolved ([status](reviews/cofold-recent-pdb-2026-11-13/README.md)).
- [x] Complete the 27-pose OpenBind 200-step/MSA256 control; preserve all 162 complete-phase poses and the incomplete Boltz standard evidence, including one lost checkpoint.
- [x] Retrieve and independently validate all 54 recent native single-sequence poses and the nine old-crystal native OpenBind poses; retain stereo failures and poor folds with raw output hashes and public reconstruction checks.
- [ ] Complete and score the queued native exact-MSA256 controls and missing-only old FK5/Boltz retry; single-sequence controls do not establish fixed-tensor parity.
- [x] Recover closing IndexedDB connections once and stop on lost checkpoints without silently repeating completed inference ([RCF-09/10](reviews/cofold-recent-pdb-2026-11-13/findings.md)); verify deletion during an atomic checkpoint in real Chrome.
- [x] Independently compare fixed nonzero transition-layer inputs/weights against actual official CPU FP32 and FP64, retain raw GPU outputs and reproduce errors directly from bytes ([LCP-01](reviews/cofold-layer-parity-2026-11-13/README.md)). Ordinary inputs pass; stress failures stay explicit.
- [x] Exercise the actual fused/ranged/split generators, FP32/FP16 storage and GPU int5 upload against matched official FP64 and independent NumPy; preserve 126 raw measurements and failed candidate stages ([LCP-02/03](reviews/cofold-layer-parity-2026-11-13/production/README.md)).
- [ ] Implement the corrected materialized row shift directly in production generators, then qualify other normalization/factor/matrix paths and full-model throughput before deployment. Current passing evidence is diagnostic component scope.

- [x] Integrate pinned LocalFold AF2 and OpenBind-0 with UI/API inputs, exact ligand graphs and downloadable provenance ([LF-01](reviews/LOCALFOLD_INTEGRATION_2026-11-12.md)).
- [ ] Qualify LocalFold against original native models and known ligand complexes; measure quantization separately, then broaden GPU and molecular coverage (LF-01).
- [x] Add Boltz-2 browser structure inference and compare the 48-pose library with the official native low-step route, retaining raw outputs, seed variability and unscored Foldarium review ([comparison](reviews/cofold-method-comparison-2026-11-12/README.md)).
- [x] Complete the 48-pose OpenBind-0 native FP32/dense-kernel control on T4 Spot; preserve the substantial protein/ligand disagreement as an unresolved finding, with full human-review bundles ([comparison](reviews/cofold-method-comparison-2026-11-12/README.md)).
- [ ] Isolate OpenBind's observed browser/native protein disagreement (median Cα RMSD 7.04 Å) using matched weights, features, sampler and random tensors; current protocol differences do not diagnose a porting error.
- [x] Finish and analyze all 48 native Boltz-2 standard-sampling poses on L4 Spot, retaining raw outputs, timings and review bundles ([results](reviews/cofold-method-comparison-2026-11-12/README.md)).
- [x] Finish only the last two native OpenBind standard poses and assemble all48 with source hashes and interrupted statuses preserved; standard-sampling protein agreement is 1.49 Å and ligand disagreement remains substantial ([results](reviews/cofold-method-comparison-2026-11-12/README.md)).
- [x] Run a predeclared three-complex experimental crystal-reference panel through both actual browser cofolding models, preserving every seed and unselected/confidence-selected/oracle results ([results and limitations](reviews/cofold-crystal-reference-2026-11-13/README.md)).
- [ ] Finish native controls for the crystal-reference panel, investigate OpenBind's poor single-sequence reconstruction, and expand to genuinely held-out complexes; the three old structures may occur in training data.
- [x] Preserve six OpenBind standard-sampling poses after Spot node failure, validate source-side inventory and submit only 42 missing query/seed pairs; require full unique coverage for assembly ([recovery](folding/comparison/README.md#interrupted-native-openbind-jobs)).

- [x] Cancel queued/in-flight old-graph polish when chemistry invalidates the atom mapping ([SR-13](reviews/STALE_POLISH_2026-09-25.md)); retain exact coordinate-preservation assertions.

- [x] Separate prepared-protein provenance from edited-System parameter validity, and minimize new/modified current Systems before MD by default ([SR-08/09](reviews/SIMULATION_READINESS_2026-09-10.md)).
- [x] Refresh Run after preparation, reuse exact saved MD frames, and version deployed code URLs against mixed browser caches ([SR-10/11/12](reviews/SIMULATION_UI_CACHE_2026-09-10.md)).
- [ ] Extend SR-09 beyond the 7KPA short-run reproduction: identify dominant starting-strain terms and test longer-time dynamics across prepared complexes and physical GPU vendors.

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
- [x] Distinguish inherited identity, released subsets and actual fixed core in the UI/API; preserve the full authored help catalogue, with accessible **i** dialogs only for 24 crucial decisions and unobtrusive native descriptions for routine/repeated controls (DV-04; [EH-01](./reviews/ESSENTIAL_HELP_REVIEW_2026-09-07.md)).
- [x] Make carbon-bound F hypotheses explicitly weak and optional by default under a versioned, primary-source-grounded capture policy; preserve explicit requirements and historical feature identities (DV-03). A general fluorine interaction model is not claimed.
- [ ] Diagnose the uncurated full-assembly 1H1Q preparation's modeled-atom 0.098 Å clash without weakening the guard (DV-05).
- [ ] Add a separately labelled, reference-preserving restrained pocket relax: keep protected inherited ligand heavy atoms fixed, move edited/released ligand atoms and nearby receptor side chains, and retain the selected pharmacophore contacts as explicit restraints. Validate it independently from the current unconstrained pocket-relax action (DV-06).
- [ ] Extend full-complex Undo, matched API/UI water-policy, cross-browser, and coupled rotamer/minimization validation; the current panel's limited observations are retained as such (DV-07).
