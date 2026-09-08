# SOS1 AWW source-graph discrepancy — investigation and author decision

Status (2026-09-07): confirmed discrepancy between the source paper's medicinal-chemistry drawing and the CCD-derived graph used in the frozen run. An initial a23 figure-publication pause was superseded by the author's explicit decision to retain the existing PDB-derived model and calculations. No corrected scientific rerun is requested. Existing frozen checkpoints and results have not been changed or deleted.

## Discussion and decision record

The discussion began with the author's observation that Figure 2 appeared to highlight an unchanged dimethoxy fused-ring scaffold. The assistant first traced false highlights to reassigned persistent atom IDs, then described the saved AWW structure as partially hydrogenated and the final step as restoring aromaticity. The author challenged that interpretation. Inspection of the original paper's Figure 4B then established that the aromaticity difference in the deposited chemical definition was not a medicinal-chemistry operation reported in that figure. The assistant's initial explanation had conflated faithful reproduction of a deposited input with faithful interpretation of the published design sequence.

The author subsequently confirmed the PDB problem and instructed: “leave it as is,” followed by “just remove that restore aromaticity comment from our description.” The author also asked that this discussion be retained as a potential example of how the workflow supports reproducibility.

The agreed scope is therefore to retain the PDB-derived graph, parameterization, saved coordinates, candidate evaluations, and results; remove the misleading restoration-of-aromaticity description; and preserve this discrepancy and decision in the repository history. This is an informed decision to retain the original input, **not** a finding that the CCD and the published compound are chemically identical. No new scientific result, corrected graph, rerun, or external CCD correction is implied. Any independent chemical-highlight cleanup must likewise leave the numerical inputs untouched.

## Why this is a reproducibility example

The saved inputs and explicit edit history made it possible to trace an unexpected visual annotation back through atom correspondence to the exact chemical graph used for calculation, and then compare that graph with the deposited dictionary and the source paper. The record separates four questions: what the authors drew, what the database encoded, what Molarium actually computed, and what the user chose to retain after inspecting the discrepancy.

This does not show that a reproducible workflow guarantees scientifically correct inputs, or that the software detected the discrepancy unaided: the user's challenge was decisive. It shows how preserved inputs, reviewable depictions, source checks, and an explicit human decision can make a discrepancy discoverable and its consequences auditable without silently rewriting a completed result.

## Finding and evidence

The user noticed that Figure 2 highlighted the dimethoxy fused-ring scaffold even though the medicinal-chemistry sequence retained that scaffold. The first audit found that persistent-ID allocation was being mistaken for chemical change: methoxy branches and the terminal phenyl group were allocated new IDs during graph replacement. Their chemical identity did not change.

A deeper check found a separate scientific-input problem. [Hillig et al., 2019, Figure 4B](https://d-nb.info/1269481576/34) depicts compounds 19, 20 and 21 on the same fully aromatic dimethoxyquinazoline core. The parent review agent inspected the original article's Figure 4B directly (PDF page 7). Compound 21 is linked to [PDB 5OVH](https://www.rcsb.org/structure/5OVH).

By contrast, the [current RCSB AWW chemical-component dictionary](https://files.rcsb.org/ligands/download/AWW.cif), checked on 2026-09-07, explicitly describes a 5,8-dihydroquinazoline. This is not an alternative Kekulé assignment: CCD atoms C26 and C2 each have two attached hydrogens, the component formula is C24H27N3O3S, and its nonaromatic ring bonds encode genuine hydrogenation. The frozen graph agrees with this CCD representation. Agreement with a deposited dictionary therefore did **not** validate the intended medicinal-chemistry structure.

The discrepancy is sufficiently established to stop presenting the hydrogenation/rearomatization as deliberate designer operations. The origin of the CCD discrepancy is not established here; this review does not infer what occurred during deposition or crystallography.

## Exact implementation evidence

`design-history/structures/build-sos1-prospective-campaign.py` contains the AWW target SMILES:

```text
COC1=C(OC)Cc2c(nc(C)nc2N[C@H](C)c2ccc(-c3ccccc3CO)s2)C1
```

Strict full-hydrogen RDKit sanitization of the exact `release.json` snapshot IDs reproduces this graph in `aww-graph`, `aww-designer-intent` and `aww-phe890-response`. It is chemically different from an aromatic quinazoline, regardless of 2D drawing orientation. The final BAY-293 graph is aromatic, but its coordinates and selected receptor state descend from the affected AWW calculations.

The new diagnostic helper `paper/scripts/sos1-chemical-change-map.mjs` uses full-H sanitization, removal of hydrogens only afterward, normalized aromatic bonds, retained lineage, and explicitly reviewed structural atom correspondence. Its output `paper/review/sos1-chemical-change-map.json` was labeled **HOLD** during the initial investigation, before the author's retention decision above. That diagnostic label must not be read as the current author decision. The map explains the existing frozen graphs, not a corrected medicinal-chemistry sequence. Tests in `paper/review/chemical-change-map.test.mjs` demonstrate that equivalent Kekulé assignments produce no difference, conserved methoxy branches are not highlighted, and actual hydrogen/bond changes remain detectable.

## Impact inventory

The following inventory describes what **would require recomputation if a future reproduction substituted the source-paper aromatic compound**. It is not the current work plan; the author chose to preserve this run.

| Artifact or result | Consequence |
| --- | --- |
| AXE, AWT, AWZ checkpoints before AWW | No AWW-dependent input defect identified; preserve and reuse only after verifying their hashes and chemical identities. |
| AWW target graph and generated graph-edit payloads | Must be rebuilt from a reviewed aromatic compound-21 graph in a new provenance-separated attempt. |
| AWW graph/intent/receptor-response checkpoints | Encode the disputed dihydro ligand and cannot stand in for the published aromatic compound 21. |
| AWW parameterization, contact/torsion candidates, energies, clash filtering, rotamer selection and pose validation | Must be recomputed for the corrected graph; changing a figure or SMILES label cannot repair these results. |
| BAY-293 continuation and final candidate selection | Final chemical identity is not the identified defect, but its trajectory, starting receptor state and comparisons inherit AWW; rerun downstream stages. |
| Executable script, checkpoint replay, movies, Figure 2, generated results and manuscript pseudocode/account | Regenerate from the corrected accepted attempt. Remove the unsupported designer hydrogenation/rearomatization narrative. |
| Prior frozen releases, paper revisions and audit results | Preserve as historical artifacts with the discrepancy linked; do not overwrite immutable source data or erase the discovery trail. |

The affected public release family is `design-history/publications/sos1/designer-intent-2026-09-04/`, particularly the three AWW checkpoints and downstream `finish-bay-293-campaign.json.gz`. Relevant implementation entry points include `scripts/run-sos1-prospective.mjs`, `scripts/run-sos1-aww-receptor-only-prospective.browser.mjs`, and `scripts/continue-sos1-axh-from-designer-intent.browser.mjs`; choosing a safe restart requires inspecting their current contracts rather than blindly rerunning them.

## Conditional future correction and acceptance checks

These checks were proposed during the initial pause. They are retained for a possible future aromatic-compound reproduction, not as prerequisites for retaining the present PDB-derived run.

1. Register the aromatic compound-21 graph with explicit source-paper provenance and a note explaining its disagreement with AWW CCD. Check the supplement or an independent primary chemical characterization where available. Verify formula, aromaticity, stereochemistry and connection pattern before calculating.
2. Create a new immutable attempt from the last unaffected AWZ checkpoint. Replace only the intended medicinal-chemistry arm; keep the aromatic core. Record the reviewed structural correspondence separately from persistent object IDs.
3. Reparameterize and recompute the affected AWW pose/contact and receptor-candidate protocol, then the BAY-293 continuation, keeping the declared designer intent and algorithmic settings traceable. Do not transplant old energies, candidate counts, selected rotamers or success claims into the new run.
4. Validate scientific outcomes without assuming the old Phe890 selection or previous numeric results will survive. No later crystal coordinates become generating inputs.
5. Rebuild the three movie forms and paper assets from new verified checkpoints, with native 2D depictions and chemical-difference highlights. Assert that the shared core and methoxy branches are unhighlighted throughout the intended aromatic series.
6. Link any corrected attempt, tests and public fixes back to this finding. A new aromatic-compound result requires scientific and visual QA; a cosmetic highlight change alone cannot establish that result.

No corrected scientific run or replacement publication is claimed by this document.
