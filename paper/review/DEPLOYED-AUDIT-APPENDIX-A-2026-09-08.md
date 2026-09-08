# Appendix A and main-text technical audit

Audit date: 8 September 2026. Manuscript: `paper/revisions/2026-09-08-value-figure-cleanup-a27/main.tex`. Implementation and retained evidence: public commit [`6d2f620d7d26e3dfd270c018f0a9be7a414f2163`](https://github.com/rafwiewiora/molarium/tree/6d2f620d7d26e3dfd270c018f0a9be7a414f2163). All implementation checks used pinned Git objects, not the dirty development checkout. This is a static source/evidence audit, not a new numerical benchmark or browser-runtime test. Live deployment asset reconciliation is a separate audit by the parent reviewer.

## Findings and exact corrections

Eight narrowly scoped replacements are provided in [the machine-readable replacement list](deployed-audit-appendix-a-replacements-2026-09-08.json). Each original string has exactly one occurrence in a27; the audit itself does not modify the manuscript. Evidence line numbers below refer to the pinned implementation and a27 manuscript, not subsequent revisions.

1. **Backend units were overgeneralized (main.tex:332).** OpenMM and direct WebGPU use nm/kJ units; the replica engine internally uses angstroms/kcal. `stormm/README.md:143` gives its units, and `stormm-worker.js:288` documents force conversion at the public boundary. RDKit energies also use kcal/mol (`rdkit-worker.js:1–2`). Describe the backends separately.

2. **Long direct requests do not automatically route to ensembles (main.tex:366).** `webgpu-worker.js:621–625` rejects more than 5,000 dynamics steps; `app.js:16620–16628` disables/clamps oversized direct UI requests. The separate replica workflow also has a 512-atom topology limit. Remove the implied automatic routing, retaining the 5,000-step request limit.

3. **Replica constraint iterations were a default, not a maximum (main.tex:382).** `stormm/engine.mjs:80` defaults to 32 iterations, but lines 91–94 accept 1–256. Describe the default. The direct engine's separate maximum of 32, stated in the preceding table, is correct (`webgpu-worker.js:348`).

4. **The main event-history description implied exhaustive capture (main.tex:152).** `design-history/live-campaign.mjs:204–231` explicitly records `complete:false`, `public-actions-only`, and `directUiMutationsCapturedOnlyInSnapshot:true`, with an audit-truncation flag. Say selected graph-and-coordinate states and captured completed public actions, not every edit/selection/manipulation/interaction. This aligns the main text with the more careful limitations already in A.4 and A.5.

5. **OpenMM's API availability was omitted (main.tex:435).** `chemist-actions.mjs:232–235` exposes `calculation.run` with `method:'openmm'`; `app.js:16156–16158` dispatches it to `runOpenMMJob`. OpenMM is absent from the selectable Simulate menu, not restricted to internal validation/fixed-scaffold operations.

6. **The two bounded action histories need distinction (main.tex:446).** `chemist-actions.mjs:419–420,456–457` retains 500 API entries by default. `app.js:9314` independently keeps the last 500 scene-audit entries. Clearing the scene clears the latter (`app.js:17798`), not the API closure's history; the API is created once at `app.js:12056–12059`. Campaign scripts use the scene audit and explicitly disclose partial/truncated coverage. IndexedDB campaign persistence is not equivalent to automatically persisting either entire transient history.

7. **Allow-listed scripts can carry coordinates (main.tex:491).** `session.loadStructure` accepts PDB, XYZ and MOL content (`chemist-actions.mjs:6–9`), and `calculation.selectFrame` restores saved coordinates (lines 239–240). Campaign restoration is another allowed state-restoration path. Keep the important no-arbitrary-code boundary, but do not imply that all allowed actions recompute coordinates. This also prevents conflation of the frozen replay with the recomputable SOS1 protocol.

8. **The minimizer displacement cap is configurable (main.tex:365).** `webgpu-worker.js:346` reads `options.maxDisplacement` with a default of 0.001 nm. Label the table entry a default displacement cap, not an invariant worker limit. The 750 default/2,000 maximum iteration counts remain correct.

## Main state-completeness boundary

The live-session statement at main.tex:133 is not equivalent to a persistence guarantee. Campaign snapshot serialization (`design-history/live-campaign.mjs:80–107`) contains graph, coordinates, canonical SMILES and selected molecular/source/provenance metadata. It does not serialize the full numerical recipe, trajectory collection or workbench state. Restoration reconstructs the recorded molecular state, not an entire suspended calculation session. The main-history replacement above is required; if adding another clarification, use: “A campaign snapshot preserves the molecular graph and coordinates, not the complete live workbench; numerical records and trajectories require their corresponding exports.”

A.4 correctly says explicit export is required for portable handoff and that scripts are not the complete workbench. Optional hypothesis/evidence fields and explicit campaign/decision operations must not be reinterpreted as automatic scientific annotation of every ordinary action. The ledger's schema capabilities are valid; their availability does not establish that every published snapshot contains every category of record.

## Numerical results checked and retained

The five-pose report maxima were recomputed directly from pinned JSON records; all rounded manuscript numbers are correct:

| Comparison | Maximum absolute energy difference, kcal/mol | Maximum relative force RMS |
| --- | ---: | ---: |
| Native OpenMM Reference versus the same bridge compiled for WASM | 2.842170943040401e-14 | 3.759617606058098e-15 |
| Browser Sage/WebGPU versus WASM, vacuum | 0.0001241858136609153 | 0.000011620411611590664 |
| Browser Sage/WebGPU versus WASM, OBC2 | 0.0002764284744642964 | 0.0000116333855863668 |

Reports are `docking/validation/cloud-panel/openmm-wasm-native-validation-2026-08-23.json`, `browser-sage-openmm-validation-2026-08-23.json`, and `browser-sage-openmm-obc2-diagnostic-2026-08-23.json`. Each contains the same five pose identifiers: two pyrazole, two tetrahydropyran and one spiro-ketone control. The manuscript correctly limits this historical comparison to three analogue chemistries from the 7KPA/D84 target, not five independent protein systems. Native/WASM agreement here is vacuum, no constraints, no cutoff; it is not all-options equivalence.

The SHA-256 hashes of both pinned OpenMM runtime assets and all three report files match `openmm/BUILD-PROVENANCE.json`. Recorded OpenMM 8.2.0, Emscripten 6.0.6-git and CMake 3.31.0 match A.1. No new build or external archive download was performed.

The separate production-worker benchmark retains 47/47 direct fixed-f32-input passes and 42/47 original-input passes on both M1 Pro and L4; STORMM retains 22 supported original-input passes and 25 explicit unsupported cases. `benchmarks/simulation/results/README.md` and `STORMM.md` distinguish these precision gates and the unsupported cutoff/size boundary. Browser timings include fresh production-job overhead; native timings use resident Contexts. The manuscript correctly avoids a matched-kernel speedup interpretation or transitive reliance on WASM for these native comparisons.

The benchmark implementation/results are unchanged between manuscript benchmark pin `2ab30383d6160349aa3b1e980f7239d6854b329d` and this audit pin: the intervening nine-file diff affects help, help tests, reviews, TODO and the local asset manifest. Keeping the immutable benchmark link to 2ab is appropriate; it need not be cosmetically advanced to the newest help-only commit.

Earlier timings remain explicitly historical: direct Trp-cage 214.9 versus 102.8 ns/day, ubiquitin 65.18 versus 7.11, and energy/force latency 25.5 versus 5.7 ms match `webgpu/README.md`. Replica crossover ratios 13.3 and 3.5 in favor of WASM at one replica, versus 10.3 and 24.1 in favor of aggregate WebGPU throughput, match `stormm/README.md` and remain qualified as different-integrator comparisons. The 46%/17% neighbor-list slowdowns match the fixed Trp-cage/ubiquitin protocols in `LESSONS-LEARNED.md:47–48`.

## Other checked sections requiring no substantive rewrite

- **A.1 numerical architecture:** RDKit 2025.03.4, ETKDGv3, Sage 2.1.0 and labelled Gasteiger preparation, preservation of prepared Rosemary/NAGL fixture inputs, missing-parameter rejection, nonperiodic Reference OpenMM, OBC2/ACE and the serial CCMA build patch are supported by the pinned worker, parameterizer and build sources. Unit conversion requires the correction above.
- **A.1 direct limits:** 64-wide principal force workgroup, four default/32 maximum graph-coloured constraint sweeps, 750 default/2,000 maximum minimizer iterations, and 0.2 nm skin/20-step neighbor rebuild defaults are supported by `webgpu-worker.js`. No periodic/PME production workflow is established by these tests.
- **A.1 replica representation:** paired-word scales 2^22 energy, 2^18 force and 2^32 coordinate, maximum 50-step command chunks, shared topology, 512-atom cap and explicit fault statuses agree with `stormm/README.md`, `stormm/engine.mjs` and the worker. The residual approximately 3e-4 relative translation sensitivity at 500 angstroms is retained as a working-coordinate limitation, not claimed fixed by the wider store.
- **A.2 validation method:** pinned evidence supports matched numerical inputs, term-level tests, overflow/clash/translation regressions, native comparisons and the distinction between implementation agreement and physical-model accuracy. The external-specialist discussion should continue to be read together with A.3's explicit statement that transport, scheduling, signatures and trust policy are not implemented, not as a demonstrated remote execution pipeline.
- **A.3 pocket semantics:** `app.js:3753–3798,16556–16558` distinguishes the 5-angstrom ligand/side-chain relaxation with backbone fixed from experimental 6-angstrom whole-residue induced fit, including backbone but respecting retention-fixed ligand atoms. Neither minimizer enforces docking H-bond restraints. Discrete rotamer enumeration remains a separate action. The current A.3 wording is correct.
- **A.3 Local Lab:** the pinned policy/test implements disabled external preparation/search controls, restrictive local serving and canary interception checks (`local-lab-test.js:105–200`). This supports the declared tested boundary, not immunity against every possible deployment/network configuration. The manuscript's distinction between a hosted changing deployment and reviewed pinned checkout is appropriate. This audit did not rerun that browser test.
- **A.4 ledger/replay:** schema separation, content-addressed snapshots/commits, parent links, branch decisions, seven stated dispositions, optional evidence/hypothesis references, append-only event linking and finalization verification match the ledger/live campaign modules. Hashes detect alteration of recorded representations; they are not signatures, chemical equivalence or scientific validation. Action-size/depth/node exceptions are correctly differentiated in the manuscript; the only needed script-content correction is coordinate-bearing allowed actions above.

No manuscript, executable route, molecular checkpoint or numerical benchmark result was changed by this audit.
