# SOS1 manuscript / pinned-public-release reconciliation

Reviewed on 2026-09-08. Scope: Appendix A.5 in `paper/revisions/2026-09-08-value-figure-cleanup-a27/main.tex`, its bundled protocol evidence and action scripts, and Figure 2 provenance, against public commit `6d2f620d7d26e3dfd270c018f0a9be7a414f2163` using read-only `git show` / `git grep` checks. Manuscript SHA-256: `cdb14f27bca72abbe89de96d90ed9664bcbfdb5f54f055d51804a8c0f89fc798`.

This is a source-and-evidence reconciliation, not a fresh browser execution or HTTP deployment attestation. No molecular state, scientific result, manuscript, release, or deployed app was changed by this audit. The author's decision to retain the frozen PDB-derived AWW graphs and results is controlling; the prior source-graph finding is historical context, not a renewed publication hold or request to rerun science.

## Result

The condensed procedure, numerical human account, seven-state mapping, and movie timing agree with the pinned release. The significant distinction is **Figure 2's local presentation build versus the pinned public interface**. A smaller provenance clarification concerns compressed versus decoded checkpoint hashes.

### SOS1-DEPLOY-01 — Figure 2 uses local presentation controls

Figure 2 contains genuine full-interface captures of the exact frozen checkpoints, not invented molecular frames. Its provenance identifies a local application build, including `app.js` SHA-256 `d37b367cb43433e8634c458c13dfb50a72049bdc99b25d81c3afef5faa55a960` and `rdkit-worker.js` SHA-256 `ac09dc032bd5d15b92882f6e2c1b5be8d862245b7ef34fa6c9b3fe07446b60f8`.

That build has native enlarged/docked 2D drawings, an eight-atom scaffold-alignment API (`view.setDepictionAlignment`), and chemical-difference highlights displayed in 2D. Searches of the pinned public `app.js`, `chemist-actions.mjs`, and `index.html` confirm these additions are absent. The registered chemical-difference presentation story is also not part of that public app. Public checkpoint replay and the underlying scientific actions are present; the new figure presentation is not yet the interface a reader necessarily sees at the linked public replay.

The caption's claim to show Molarium screenshots is supported. Treating the figure as a screenshot of the currently deployed interface, or promising those particular controls publicly, would not be supported by this pin. Minimal resolution: identify the figure as captured in a local figure-preparation build, or publish and verify the corresponding UI changes before claiming deployed availability. This requires no change to the frozen science.

For the current paper-only reconciliation, use the disclosure option, not app publication. Suggested exact caption replacement:

```json
{
  "find": "Each panel is a full-tool screenshot with the ligand graph in the enlarged 2D panel.",
  "replace": "Each panel is a full-tool screenshot from a local figure-preparation build. Its enlarged, scaffold-aligned 2D panels and orange highlights are display-only additions not present in the reviewed public interface; the saved molecular graphs and coordinates are unchanged."
}
```

### SOS1-PROVENANCE-02 — clarify checkpoint hash scope

`protocol-evidence.json` gives BAY-293's `checkpointSha256` as `247314e796be9c823e0545817bbec55d2b1232d32ae0cb5bfcd7264bb25408f3`. This is the **decoded canonical JSON** hash, correctly matching `release.json.canonicalSha256`, not the `.json.gz` file's byte hash `dbe42835d58b058a68e829412b2c30fbf9332bf8590b03b2a048ab950b991c95`.

Both values verify. The first six checkpoints are uncompressed, so their two hash scopes coincide. A future packaging clarification should add `hashScope: decoded-json` or separate `fileSha256` and `canonicalSha256`; the current ambiguous field must not be mistaken for a corrupted checkpoint.

## Verified action/state correspondence

The bundled executable and checkpoint-review scripts are byte-identical to the pinned public files. The executable has **159 actions** and SHA-256 `7eed2dff0bf3fa127f87b2322aaea4b615d458ad6d8ef3af3c5b5886dc8fe9c3`; the seven-import checkpoint script has SHA-256 `6ab36deb2cab37fd888eff9c2006c8c14e06be351d4cdc160dd173c994393211`. The bundled pseudocode hash also matches its protocol-evidence record.

| Saved checkpoint | Zero-based executable indices, inclusive | Figure 2 |
| --- | --- | --- |
| 1: starting-hit | 0–4 | A |
| 2: scaffold-rewrite / AWT | 5–14 | B |
| 3: fragment-merge / AWZ | 15–28 | C |
| 4: aww-graph | 29–35 | Not pictured separately |
| 5: aww-designer-intent | 36–45 | D |
| 6: aww-phe890-response | 46–140 | E |
| 7: finish-bay-293 | 141–158 | F |

All seven public checkpoint file hashes and decoded canonical hashes verify against the release. Exact snapshot IDs resolve to 7,925 atoms for the hit, then 7,929, 7,933, 7,935, 7,935, 7,935 and 7,937 atoms. The manuscript's four analogue particle counts are correct. The figure's six checkpoint hashes match these same release entries; panel D is checkpoint 5, not graph-only checkpoint 4.

The lineage table matches the registered route's `posePropagationMap`: retained/deleted/added/candidate mappings are 23/4/6/4, 19/10/12/1, 16/15/15/1 and 15/16/17/1. These are **registered lineage counts**, not the orange chemical-highlight counts. The latter appropriately use separately reviewed chemical correspondence and aromaticity normalization; IDs alone do not define chemical changes.

## Procedure and choice points

- Preparation action 2 explicitly specifies pH 7.4, automatic histidine assignment, CCD ligand policy, missing-heavy repair, capped gaps and retained waters. The scientific record and manuscript distinguish coordinate-preserving parameterization from coordinate-changing relaxation.
- AWT and AWZ use eight serial pose-search chains with feature-seeding protocol v5, apply candidate index 0, parameterize, then run `induced-fit-webgpu`. Actions 6–9 and 16–19 have explicit coverage, feasibility, retained-core, atom-count, valence and relaxation expectations. The reading guide correctly condenses repeated inspection, route-resumption and workspace actions.
- AWW contact placement is action 38: fixed primary C12–C15 rotation +150°, upstream N7–C12 range 0–60°, coupled axes CX4–CX5 and CX15–CX16, and only Phe890 CG/CD1/CD2/CE1/CE2/CZ listed as allowed response atoms. The API sets the search and its bounded coordinate domain; donor-H search is documented in the recorded result rather than being a separate `donorHydrogen` action argument. The pseudocode is explicitly labeled abbreviated, so this is not an API-schema discrepancy.
- Contacts N7→Asn879 OD1 and OX3→Tyr884 backbone O are declared separately. The human account correctly avoids claiming that declaration alone proves Asn879 satisfaction. The numerical AWW record has Tyr donor–acceptor distance 2.8287625585 Å and angle 155.2878401936°, consistent with the rounded 2.829 Å / 155.288°. It records zero internal severe contacts and zero contacts outside the allowed response set, with 11 contacts inside it.
- The ligand lock is installed before receptor enumeration. The manuscript correctly describes receptor-only rotamer evaluation, not an induced-fit trajectory or a Tyr884 side-chain flip. Thirteen distinct Phe890 candidates, including input, receive fixed-coordinate OpenMM/OBC2 single-point evaluations with 1.0 nm cutoff and no constraints.
- Candidate evidence files 010–022 confirm two zero-severe-clash states, at χ = (−180°,90°) and (−180°,−90°), with energies −2489.638827864728 and −961.997738319113 kcal/mol. The first is selected; the input has 11 severe clashes. These are whole-system selection energies, not binding free energies.
- The executable applies the recorded χ choice rather than implementing a dynamic argmin action. `scripts/sos1-executable-science.mjs` independently checks the fresh energy winner, complete candidate coverage, fixed ligand, restoration and final BAY gates. Its use in the render/publication verification path is present at the pin. The manuscript correctly calls this a **publication check**, not a check automatically enforced by every ordinary browser playback.
- BAY continuation releases the exact ligand lock, captures a reference, changes the graph, performs eight serial pose-search chains, applies index 0, parameterizes and relaxes. The registered seven-atom feature has a 2.25 Å RMSD tolerance and 20 kcal/mol/Å² penalty weight. The pseudocode retains the tolerance but omits the weight as an abbreviation; the full route remains the parameter source.
- Candidate gate evidence 026 confirms three feasible candidates, four feature failures, and one physical-feasibility failure. Final comparison evidence 034 gives feature RMSD 1.5292697308 Å, centroid displacement 1.2893683804 Å, 32 heavy atoms, no severe ligand-internal or protein–ligand clashes, and Phe890 side-chain RMSD 0.9276314867 Å. Fixed-atom evidence 030 passes using the recorded float32-aware criterion; it should not be paraphrased as exact bitwise equality during BAY relaxation.

The quoted ligand RMSDs (AWW 0.851 Å and BAY 1.880 Å) agree with the separate post-freeze measurement files. Their receptor-aligned/graph-symmetry-minimized interpretation, rather than independently fitting the ligand, is preserved. The manuscript does not claim blinded prediction, affinity improvement, a unique rotamer, or a dynamical flip pathway. Its distinction between saved state, partial attached action history and separately released numerical audits is important and supported.

## Replay and movie reconciliation

The pinned `checkpoint-popups-v2/movie.json` specifies calculation policy `none`, seven-state precomputed footage, 753 frames at 12 fps and **62.75 s**. Its five popup windows each contain exactly 12 frames:

| Stage | Frames inclusive | Recorded status text |
| --- | --- | --- |
| Starting hit | 38–49 | Assigning OpenFF Sage 2.1 parameters… |
| AWT | 127–138 | Minimizing with WebGPU… |
| AWZ | 216–227 | Minimizing with WebGPU… |
| Phe890 response | 512–523 | Collecting OpenMM results… |
| BAY-293 | 630–641 | Minimizing with WebGPU… |

All three distinct status strings occur verbatim in their declared worker source at the public pin. The overlays carry a recorded-calculation label and are composited onto the verified precomputed footage. They are not evidence of real-time computation during the displayed second. The manuscript's “presentation time, not calculation time” qualification is correct.

The immutable original `release.json` still inventories historical base movies, while the manuscript separately links the v2 popup manifest. That distinction is accurate: the v2 manifest, not the original base-video hash, identifies the movie with these popups. This audit inspected the manifest and source contracts, not a fresh MP4 playback or network response.

## Action requested from the coordinating review

Clarify the local Figure 2 presentation-build boundary and the gzip hash scope. No A.5 operation-sequence or numerical-result correction was identified. Keep the author's retained frozen graph/result decision, the existing source-discrepancy history, and the no-rerun scope intact.
