# Technical manuscript review — 6 September 2026

Status: proposed findings for author review; **nothing is approved or applied**. This is a technical/content audit, not a prose rewrite. Preserve the author's argument and paragraph flow. The technical-review task is outside the sentence-level manuscript-writing-review skill's stated scope; no stylistic rewriting skill was invoked.

## Audit boundary

The reviewed current source is the author's downloaded `main (2).tex`, 2,931 lines, SHA-256 `3de523cc745279a9962cae7d1afb90ccb8867f8d4d086e449e5f146f84fc24ff`, including main text, Appendices A/B, the frozen editorial Appendix C, and bibliography. Source line references below refer to that exact file, preserved as [the current-source artifact](history-2026-09-06/artifacts/3de523cc745279a9962cae7d1afb90ccb8867f8d4d086e449e5f146f84fc24ff.tex). Repository evidence is inspected at base commit `863aebadaa0af6299943846a628e83c94980d85f` in the paper-history worktree. The separate ongoing Design-remediation branch is not assumed to be merged or deployed.

The coordinator independently inspected the supplied PDF and figures. Figure observations attributed to the coordinator below are not independent visual QA by this reviewer. Source/code inspection and numerical/provenance comparisons are this reviewer's work. No molecular calculations were rerun. No new discussion of the previously excluded SOS1 cutoff issue is proposed.

| ID | Priority | Proposed decision |
| --- | --- | --- |
| MR-T01 | High | Choose the SOS1 scientific run; do not conflate crystal-informed intent with blinded prediction. |
| MR-T02 | High | Bind Figure 2, numerical results, and Appendix A.5 to that same run. |
| MR-T03 | Medium | Resolve replay/action-count and movie-version mismatch. |
| MR-T04 | High | Do not attach the newer Local Lab Figure 1 caption to the existing unverified image. |
| MR-T05 | High | Correct OpenFold3 to the implemented OpenFold 2 pathway. |
| MR-T06 | High | Correct Appendix A.4's denial of live campaign persistence. |
| MR-T07 | High | Correct automatic-reload claims: saved campaigns require explicit resume. |
| MR-T08 | High | Distinguish constrained propagation, pocket relaxation, and induced fit. |
| MR-T09 | Medium | Repair pocket-inspection examples' missing captured-reference precondition. |
| MR-T10 | Medium | Correct the source of STORMM translation sensitivity. |
| MR-T11 | Medium | Add or explicitly defer the newer direct-native benchmark evidence. |
| MR-T12 | Medium | Label historical timing baselines; do not turn them into native-GPU speedups. |
| MR-T13 | Low / scope | Qualify blanket local-computation wording around the remote MSA step. |
| MR-T14 | Medium / provenance | Preserve Appendix C as a frozen recovery, not the complete current history. |
| MR-T15 | Medium / provenance | Keep unmatched Source B distinct from the same-named recovered ZIP member. |

## MR-T01 — SOS1 input boundary is not equivalent to a blinded study

**Current source:** line 138, “5OVE/AXE was the sole coordinate-bearing input”; line 483, “The later analogue poses and receptor conformations were withheld during prediction”; line 485, “Later crystal structures were opened only after four prediction checkpoints and the exploration audit had been hashed.”

**Finding:** these statements describe the older hit-only run. The currently packaged designer-intent example uses 5OVE/AXE as its sole imported coordinate-bearing starting complex but infers a ligand-direction/contact hypothesis from inspection of the later crystal series. No later crystal coordinate injection does **not** mean no later crystal information. Updating only the ligand RMSD or figure filename would preserve a false blinding implication for the newer run.

**Evidence:** [repository manuscript](../main.tex), lines 142–149 and 488 onward, explicitly calls the current example crystal-informed/reference-informed and separates designer-directed AWW placement, ligand locking, and calculated Phe890 response. [Current checkpoint-review script](../../design-history/publications/sos1/designer-intent-2026-09-04/checkpoint-review.action-script.json) and [generated measurement provenance](../generated/sos1-designer-intent-results.tex) bind that distinct scientific story. The old run and its measurements remain historical evidence, not invalidated data.

**Minimal proposed fix / author choice:** choose one of two coherent packages:

- Present the current public designer-intent story, minimally changing the Figure 2 introduction/caption and Appendix A.5's input-boundary paragraph to say: “The later crystal series informed the designer hypothesis; only 5OVE/AXE supplied coordinates to the replay. This is a reference-informed demonstration of design logic, not a blinded prediction.” Preserve the distinction between an intended ligand intervention and a calculated receptor response throughout A.5.
- Retain the historical hit-only study, explicitly identify and link its frozen run/figure/replay rather than describing the current public designer-intent movie as its output.

This choice controls MR-T02 and MR-T03. Do not approve a numerical substitution independently of it. Neither package establishes that the workflow predicted a Tyr884 backbone transition; current repository text correctly distinguishes a Tyr884 contact hypothesis from such a transition.

## MR-T02 — Figure 2, table values, and receptor claims belong to different available runs

**Current source:** line 138's four-panel Figure 2 ends with “ligand RMSD of 1.215~\\AA{}” and Phe890 χ1 `−172.43°`/`−166.55°`; A.5's table at lines 540–543 contains ligand RMSDs `0.516`, `1.528`, `2.137`, and `1.215 Å`; line 548 interprets the older χ2 deviations and `0.516–2.137 Å` range.

**Finding:** the coordinator confirms that the supplied PDF uses the older four-panel figure. The repository's current six-panel figure instead shows the inherited AWW arm, the designer-directed ligand, ligand-fixed Phe890 response, and BAY-293 continuation. Its AWW and BAY-293 ligand RMSDs are `0.851 Å` and `1.880 Å`, not `2.137 Å` and `1.215 Å`. These are distinct runs, not rounding corrections. The old four-checkpoint results can be retained only if clearly labeled as a separate historical experiment.

**Evidence:** [six-panel provenance](../figures/fig2_sos1_designer_intent.provenance.json) binds six full-interface source captures and the generated figure. [Generated measurements](../generated/sos1-designer-intent-results.tex), lines 2–4 and 8–19, identify AWW run `sos1-aww-receptor-only-intent-v5-a021`, manifest `e71c8309dd7cc62f642fb699542b0f1c4ff02ac107782a2bbf72f98a8d932dd0`, and separate AXH continuation manifest `3b294e864fa26726455b650535ac43620610f2a22dfc83557629382e83a4b498`. The new ligand comparisons are receptor-aligned, graph-symmetry-minimized, without ligand fitting; see [repository main text](../main.tex), line 147. Historical values remain in [older generated movie assets](../../design-history/structures/generated/sos1-prospective-movie-assets.json).

**Minimal proposed fix:** after MR-T01's author choice, select the matching figure and change only the dependent caption, result statements, and A.5 experiment description/table. For the current story, use `0.851 Å` for AWW and `1.880 Å` for BAY-293 with the explicit comparison definition. Do not carry over old Phe890 χ values, old four-row table, old candidate-selection account, or old timing as though measured for this new run. Keep historical numbers in an explicitly separate archived table if useful. No wholesale main-text rewrite is needed.

## MR-T03 — Replay counts and MP4 duration are internally/version inconsistent

**Current source:** line 485 says “33 recorded API actions,” “89 completed API calls,” and “16 display-only actions for 49 replay steps”; line 550 calls it a “48-action rendered sequence” lasting `62.58 s`, with `908.5 s` operation duration.

**Finding:** the `49` versus `48` rendered-action count is internally unresolved even if the old run is retained. For the current movie, the larger issue is changed artifact semantics: the MP4 is a calculation-free checkpoint overview with short recorded-calculation popups, not a full calculation-by-calculation playback. Different action/audit/visual counts must not be merged. Appendix C also retains older timing alternatives; those are history, not interchangeable measurements.

**Evidence:** [current popup movie manifest](../../design-history/publications/sos1/designer-intent-2026-09-04/checkpoint-popups-v1/movie.json), lines 2–21, identifies schema `molarium.checkpoint-popup-movie/v1` and duration `62.75 s`; its output record identifies `checkpoint-overview.mp4`. It records input hashes and calculation-popup sources. [Current precomputed render manifest](../../design-history/publications/sos1/designer-intent-2026-09-04/precomputed.render-manifest.json) and [checkpoint-review script](../../design-history/publications/sos1/designer-intent-2026-09-04/checkpoint-review.action-script.json) are separate from the executable computation script.

**Minimal proposed fix:** replace only the fragile count/timing sentence with “Action counts and calculation timings remain attached to the frozen audit and render manifests; the calculation-free checkpoint movie is not a performance benchmark.” If the duration is important, use `62.75 s` only when explicitly naming this exact popup-movie manifest. Explain the three deliverables once: executable recomputation, precomputed checkpoint replay, and MP4 of that review. Do not silently change `48` to `49` without identifying which historical sequence was counted.

## MR-T04 — Figure 1's newer repository caption is not verified against its image

**Current source:** line 125 says the figure shows the normal View workspace after browser-local Sage/CCD preparation, with solvent/cofactors/hydrogens hidden. It does **not** claim a network-locked Local Lab or exclusion of glycerol from the prepared graph.

**Finding:** a tempting restoration from repository `paper/main.tex:135` would add “running as the network-locked Local Lab,” a hash-pinned registered ligand graph, and “Preparation excludes crystallographic water and unregistered glycerol.” The coordinator's visual inspection reports that the tracked figure instead displays a **Connected features** badge and an unchecked but retained **GOL** component. Hidden component and excluded-from-preparation component are different states. Therefore the newer caption must not be accepted just because it exists in the repository.

**Evidence:** tracked [Figure 1](../figures/fig1_molarium_interface.png) SHA-256 is `e7bc14fa9f4f520c76131cd09309740d223441d71e157e411d84509af68de765`. [Capture script](../../scripts/capture-paper-figure1.mjs), lines 36–133, validates the registered BQ5 graph and 2D depiction; lines 258 and 296–329 describe registered-only preparation and output a `capture-manifest.json` plus action audit. At the inspected base, neither corresponding `paper/figures/fig1_molarium_interface.capture-manifest.json` nor `.chemist-action-audit.json` is tracked. A valid capture script does not prove the existing image was produced by that script.

**Minimal proposed fix / author choice:** retain wording consistent with the actual image, without adding network-locked or excluded-glycerol claims; **or** create a new verified screenshot with its capture manifest/audit and then adopt the registered-graph/Local Lab description. The latter is new figure work requiring explicit selection in the review, not something this audit performed. The current caption's CCD/depiction claims should be bound to actual capture evidence before submission rather than strengthened from an unexecuted script.

## MR-T05 — OpenFold model identity is incorrect

**Current source:** line 167, “OpenFold3 supports a separate protein-structure prediction pathway.”

**Finding:** the implemented model is the OpenFold 2/AlphaFold2-style monomer pathway, not OpenFold3. The current B.8 scope is otherwise appropriately narrow: one short protein chain, no ligand co-folding or multimer prediction.

**Evidence:** [README](../../README.md), line 397 onward, labels the pathway OpenFold2. [Exported model card](../../openfold-export-results/trained/MODEL-CARD.md), lines 5–21, pins OpenFold revision `be2ec1841f16c966c65ae0e7599ebbadc725757d`, `model_3_ptm`, checkpoint `finetuning_no_templ_ptm_1.pt`, and fixed 64/128-residue inference buckets. The manuscript's Ahdritz citation is for OpenFold's AlphaFold2 work.

**Minimal proposed fix:** replace `OpenFold3` with `OpenFold 2` (or simply `OpenFold` if matching the original authors' preferred nomenclature). Do not edit identical text inside frozen Appendix C historical listings; annotate its obsolete model name in the review instead.

## MR-T06 — Appendix A.4 falsely describes live campaign promotion as unavailable

**Current source:** line 432, “Durable provenance therefore requires explicit export of API moves or a replay log” and “one-click promotion of a live session into ledger commits is not currently exposed in the main interface.”

**Finding:** this contradicts both the implemented live Design History interface and B.10's correct statement that campaigns, commits, branches, decisions, import, and export are live. The 500-entry in-memory action audit is not the entire persistence mechanism. However, the existence of explicit commits is not automatic preservation of every transient calculation or interface state.

**Evidence:** [app.js](../../app.js), live campaign UI around lines 9349 onward; `campaign.create`, `campaign.commitCurrent`, and related public handlers around lines 11400 onward; [live campaign module](../../design-history/live-campaign.mjs). Current source line 1119 already gives the more accurate live-feature description. Appendix C at lines 2317 onward preserves an earlier paragraph with the live-campaign distinction.

**Minimal proposed fix:** retain the in-memory audit limit, but replace the unavailability sentence with: “The live Design History interface and public campaign actions can commit graph-and-coordinate snapshots and completed molecular actions to browser IndexedDB; explicit export remains necessary for portable handoff.” Keep the existing caveats about partial action coverage, snapshot authority, and absence of a complete workbench/session archive. Review any related B.1/B.10 export wording for the same qualification, without claiming automatic capture of all activity.

## MR-T07 — Reload does not automatically restore the campaign molecule

**Current source:** line 1121, “Reload restores the graph and coordinates at the active branch head.”

**Finding:** current startup verifies and discovers a saved campaign, but intentionally does not replace the visible molecule. Loading it is an explicit Resume/campaign.resume operation. This preserves the user's current system when entering Design; an automatic-reload description reintroduces the behavior the interface fix removed.

**Evidence:** [app.js](../../app.js), lines 9440–9452, loads and verifies the saved campaign into `savedLiveCampaignWorkspace` and explicitly says that opening Design/history must never check out a different molecule. Lines 9349–9353 show Resume UI; lines 11473–11479 implement `campaign.resume`.

**Minimal proposed fix:** “Reload makes the saved campaign available to resume. Explicit Resume restores the graph and coordinates at its active branch head; it does not restore parameter tables, docking candidates, calculation frames, view state, or the complete workbench session.” Preserve the remainder of the import/export/integrity paragraph. This correction also applies if an earlier live-campaign paragraph is restored under MR-T06.

## MR-T08 — Motion and contact policies need a small but substantive distinction

**Current source:** line 340, “only the ligand and explicitly selected pocket atoms move”; line 422, “changed ligand branches are sampled while the receptor remains fixed” and “induced-fit action releases the ligand and all atoms of protein residues within a 6 \\AA{} pocket shell”; line 1024, “searches the degrees of freedom introduced by an edit.”

**Finding:** the three workflows are not interchangeable. Constrained propagation keeps the receptor fixed and applies required contact feasibility tests; newer edit-associated torsions may release some inherited atoms, not only newly added atoms. The fast Pocket WebGPU lane automatically selects ligand plus nearby protein side chains, with backbone fixed. Induced fit releases whole nearby residues, including backbone, but excludes ligand atoms protected by registered pose-retention rules. Neither minimizer adds the docking hydrogen-bond constraints as explicit restraining forces. A required-contact search hypothesis must therefore not be described as automatically maintained by subsequent relaxation.

**Evidence:** [app.js](../../app.js), `interactivePocketMovableAtomIndices` at lines 3749–3768 uses the 5 Å pocket and excludes backbone names `N/CA/C/O/OXT`; `currentRegisteredPoseRetentionPlan` and `inducedFitPocketMovableAtomIndices` at lines 3771–3793 use a 6 Å whole-residue shell and filter out protected indices. Optimizer setup at lines 16675–16714 passes those movable sets to the mechanics worker and checks registered retention. It can additionally select eligible displaceable waters. [Feature seeding](../../docking/feature-seeding.mjs), lines 628–639, releases affected-rotor inherited core atoms for v4/v5. [Registered retention module](../../docking/registered-pose-retention.mjs) defines the protected/retained feature behavior. These are code-policy findings, not experimental validation of induced fit.

**Minimal proposed fix:** add a compact A.3 distinction: “Constrained propagation searches the edited region and eligible edit-associated torsions with a fixed receptor and selected required-contact checks. Pocket relaxation moves the ligand and side chains in a 5 Å pocket while holding the backbone fixed. Experimental induced-fit relaxation permits whole-residue motion within 6 Å, except for protected ligand atoms under registered retention. The relaxation lanes do not impose the docking hydrogen-bond restraints.” In line 340 replace “explicitly selected” with the actual automatic side-chain policy. In B.9 line 1024 include edit-associated existing torsions. Keep these details in the appendices rather than expanding the conceptual main-text paragraph.

## MR-T09 — Two example inspection calls require an unstated captured reference

**Current source:** B.2 lines 708–713 runs `protein.prepare` and immediately `session.inspect` with `scope:"pocket"`; B.6 lines 924–929 runs `optimization.run` and then the same pocket inspection. Neither example's stated preconditions establish a captured reference.

**Finding:** `session.inspect(scope:"pocket")` is not a generic nearby-atom query. It requires the captured pose reference. Preparation does not implicitly create that capture; these snippets can therefore throw after a successful preparation/optimization.

**Evidence:** [app.js](../../app.js), lines 9521–9535, validates scopes `ligand`, `selection`, `pocket`, and `all`, then throws “Capture a reference pose before inspecting the pocket” when the reference is absent.

**Minimal proposed fix:** use `scope:"all"` or `scope:"ligand"` in these generic examples, retaining the 500-atom reporting bound. If pocket-reference inspection is the intended lesson, state the prerequisite and show explicit capture in that workflow. Do not silently add reference capture as though it were mandatory preparation; B.9 already teaches when to capture.

## MR-T10 — STORMM recentering explanation attributes the error to the wrong representation

**Current source:** line 949, “Recenter the structure before tight STORMM positional comparisons, because fixed-point spatial precision degrades far from the working origin.”

**Finding:** the fixed-point storage resolution does not progressively degrade with distance from the origin. Force evaluation uses an f32 coordinate mirror; loss of relative coordinate precision there causes the observed translation sensitivity. A.1.3 line 372 already gives the correct explanation, so B.7 is internally inconsistent.

**Evidence:** [STORMM README](../../stormm/README.md), lines 34–51, distinguishes authoritative fixed-point coordinates (`2^32` counts/Å) from the f32 mirror and identifies the mirror as the known force-accuracy limitation. The current source's own line 372 agrees.

**Minimal proposed fix:** replace only the causal clause with “because the f32 force-evaluation coordinates lose precision far from the working origin.” No additional experimental claim or new limitation discussion is needed.

## MR-T11 — Current benchmark evidence goes beyond the older WASM bridge checks

**Current source:** A.1.1 line 332 describes native/WASM C-interface parity and five hash-selected protein–ligand poses. A.1.2/A.1.3 discuss the older WebGPU comparisons, but do not report the new multi-adapter direct-native panel.

**Finding:** the existing limited-parity statement is appropriately scoped, not false. It should not be stretched into “OpenMM WASM is validated over all benchmarks.” A more recent, independent validation lane now compares the production browser workers directly with native OpenMM-built Systems, avoiding transitive reliance on the WASM bridge. Given the author's stated interest in benchmarking, this is a useful small scientific update rather than a reason to rewrite the paper.

**Evidence:** [benchmark entry point](../../benchmarks/simulation/README.md) describes independently built native OpenMM Systems and exact input/model provenance. [Direct-worker results](../../benchmarks/simulation/results/README.md), lines 15–43, report Apple M1 Pro and NVIDIA L4: 47/47 fixed-f32-input cases pass, while 42/47 original-input comparisons pass the same tolerances. These gates answer different questions and must be named. [STORMM results](../../benchmarks/simulation/results/STORMM.md), lines 5–28, report direct native-OpenMM comparison of energies and all 3N forces: 22/22 supported cases pass on each adapter, with 25/47 explicitly unsupported rather than omitted. Tested native builds are identified as `8.2.0.dev-5377094` in the raw-environment summaries, not an unspecified latest OpenMM. These are implementation comparisons, not force-field validation against experiment.

**Minimal proposed addition / author choice:** a short paragraph in the validation appendix could state: “A separate production-worker benchmark compares WebGPU directly with independently constructed native OpenMM Systems on Apple M1 Pro and NVIDIA L4. The direct worker passes all 47 fixed-f32-input cases (42 of 47 with original double-valued inputs); the STORMM-style worker passes all 22 supported cases, with 25 unsupported cases retained explicitly. The repository archives every energy, Cartesian force vector, precision contract, timing sample, and source/input hash.” Link the pinned result package; do not imply this covers every GPU, arbitrary OpenMM Systems, or the entire WASM option surface. Author may instead leave this as a clearly linked repository supplement, but should decide deliberately.

## MR-T12 — Historical speed comparisons need explicit engine and timing identities

**Current source:** line 362 reports `25.5 ms` WebGPU versus `5.7 ms` OpenMM Reference, and `214.9/102.8` and `65.18/7.11 ns/day`; line 374 reports `13.3×`, `3.5×`, `10.3×`, and `24.1×` crossovers for different replica counts.

**Finding:** these are historical workload-specific observations, not the newer native OpenCL/CUDA baseline measurements. “OpenMM Reference” must not be interpreted as GPU OpenMM, and the older ensemble throughput ratios must not be attached to the new single-replica production-job numbers. Existing acknowledgement of nonidentical integrators is valuable and should remain. New native-GPU tables have different timing boundaries: fresh browser jobs include packing/transfer/readback, while native Contexts are resident.

**Evidence:** [STORMM README](../../stormm/README.md), lines 72 onward, explicitly identifies the older bundled WASM Reference comparison. [Current direct-worker timings](../../benchmarks/simulation/results/README.md), lines 56–89, identify five warmed samples, job/block size, production-job versus resident-Context scope, and integrator differences; they explicitly prohibit matched-kernel speedup claims from column ratios. [Current STORMM timings](../../benchmarks/simulation/results/STORMM.md), lines 30–43, are **one-replica** production-job measurements and retain initial-coordinate jitter, not multi-replica throughput. Only M1 Pro and L4 are measured in these new panels; other-vendor coverage remains open.

**Minimal proposed fix:** keep older values only with their exact historical platform/implementation, workload, and manifest identification. If replacing them with newer timings, replace the protocol description with the numbers as a unit. Prefer a short qualitative crossover statement and a link to the full current tables if avoiding manuscript expansion. Do not calculate broad “WebGPU versus native OpenMM” speedup claims from unmatched timing scopes. This decision can be combined with MR-T11.

## MR-T13 — Browser-local wording should not imply every supported workflow is offline

**Current source:** line 101, “operates exclusively in a standard web browser”; line 120, “Calculations execute on the user's local device” and “avoids remote job submission, cloud-compute charges.” B.8 line 987 explicitly says the sequence is transmitted to a configured remote MSA endpoint.

**Finding:** “browser application” is accurate; a blanket inference that all computation/network handling stays on-device is not. Protein inference is local, but its connected-mode MSA step is remote and Local Lab disables that path. The source already states this correctly in B.8; a small main-text qualifier removes ambiguity without weakening the local-first argument.

**Evidence:** current source lines 983–987; [OpenFold README section](../../README.md), lines 397 onward; [model card](../../openfold-export-results/trained/MODEL-CARD.md), intended-use section.

**Minimal optional fix:** in line 120 use “Most supported calculations execute…” and “for supported local calculations, can avoid remote job submission…”. “Runs in a standard web browser” can replace “operates exclusively…” if the latter is being read as an offline claim. Do not add an extensive privacy discussion or imply the application itself executes outside the browser.

## MR-T14 — Appendix C is a frozen, incomplete recovery, not the current full inventory

**Current source:** lines 1222–1224 describe 38 changed groups, 190 single-version records, and say “The 4--5 September commits inspected in an earlier session are no longer available in this checkout.” Line 1230 retains the live-campaign conflict “without deciding which is correct.” Lines 1232–1235 bind “current” paragraph labels to baseline SHA `61e57f2d6944b25becb1c033e97c098d1848fa35d90027485f838c8baca6cc8f`.

**Finding:** those statements can accurately describe the earlier reconstruction's available evidence, but not the expanded recovery now being assembled. More Git snapshots and local artifacts are available; runtime evidence resolves the campaign behavior. “CURRENT” inside Appendix C means current at its frozen baseline, not automatically the author's preferred wording today. History counts are evidence-set dependent, not proof that every edit has been recovered.

**Evidence:** [current recovery manifest](history-2026-09-06/manifest.json), including Git snapshots and exact content-addressed source aliases; MR-T06/MR-T07 provide the code evidence resolving the campaign conflict. The coordinator is extending this manifest, so this review does not freeze a transient inventory count as a final total.

**Minimal proposed fix / review-UI requirement:** preserve the verbatim historical blocks and their original source claims. Add a short editorial note identifying C as an earlier frozen recovery and linking the expanded manifest. In the review UI, label its CURRENT text “Current in the archived baseline” and show unresolved/missing sources explicitly. Apply newly accepted factual corrections to the live manuscript only after author selection, not retroactively to historical quotations. Preserve the Apache-2.0 choice and the existing caution that Crixet Sandbox/Git timestamps do not establish an individual paragraph's authorship.

## MR-T15 — Appendix C Source B is not the same bytes as the recovered same-named ZIP member

**Current source:** Source B, lines 1254–1265, names `Molarium_paper_source_2026-09-02.zip :: Molarium_paper_source_2026-09-02/Molarium_complete.tex`, member timestamp `2026-09-02 21:06:42`, and SHA-256 `bb47e79e91b413c1b81ceb1047de0ba7aff0ca03e4987d9e853c75654ec486f6`.

**Finding:** the locally recovered member with that same archive/member name is 141,068 bytes with SHA-256 `d098f3738d0e07df1b915761abc5f6576a7df91ad4d4455269ec12b7c184e2a9`, not the claimed Source B hash. The coordinator reports a different ZIP member timestamp (`2026-09-03 00:49`) and no recovered match for the `bb47…` artifact so far. This establishes different snapshots with the same filename, **not** that the older Appendix C hash was invented or incorrect. Source A's recovered hash does match its claim.

**Evidence:** [manifest](history-2026-09-06/manifest.json), artifact record `d098f373…` and its Downloads/archive aliases; [the actual recovered complete source](history-2026-09-06/artifacts/d098f3738d0e07df1b915761abc5f6576a7df91ad4d4455269ec12b7c184e2a9.tex). The current manuscript itself preserves the different Source B hash and the caveat that sources are not a proven chronological chain.

**Minimal proposed fix / review-UI requirement:** label the recovered item “same-named local bundle, different snapshot” and keep the exact old Source B artifact marked missing/unmatched. Never substitute `d098…` under a `bb47…` identity, or mark its paragraph coverage as verified Source B. This is an editorial provenance annotation, not a reason to overwrite Appendix C's frozen hash. Source recovery may eventually resolve the gap; current evidence does not.

## Checked boundaries and non-findings

- The manuscript correctly distinguishes the STORMM-inspired WGSL worker from a port of the complete STORMM application. Do not replace that distinction with a claim that native STORMM itself was reproduced wholesale.
- The older five-pose native/WASM parity sentence already says “specified fixtures and protocols”; preserve that scope. The new direct-native comparisons supplement it rather than retroactively proving every WASM option.
- The B.8 statement that the current OpenFold workflow is not co-folding is correct. Only the model identity in the main text needs MR-T05's correction.
- The direct-worker versus replica-worker constraint-failure wording was checked: do not strengthen the direct worker's recorded diagnostic into an unsupported universal fail-closed constraint claim.
- The STORMM bibliography's journal, year, volume, and article number match the [publication record](https://pubmed.ncbi.nlm.nih.gov/39007368/) and [paper DOI](https://doi.org/10.1063/5.0211032). No correction is proposed on that point; this was not a full bibliography audit.
- Historical Appendix C typos, obsolete labels, and discarded license alternatives should remain historical evidence, not automatic restoration candidates. This technical audit intentionally does not undertake sentence-level polishing.

## Handoff

All fifteen IDs are review items, not merge instructions. MR-T01–T04 require coherent artifact/experiment choices; MR-T05–T10 are bounded factual/behavioral corrections; MR-T11–T13 are scoped publication choices; MR-T14–T15 protect editorial provenance. No manuscript, figure, scientific source, benchmark artifact, or historical record was changed by this audit.
