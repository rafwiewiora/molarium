# Figure 2: chemical edits inside the actual tool

This follow-up supersedes the **format** of a20 Figure 2, not its chemistry. The author requested full Molarium screenshots with changed structures highlighted inside the native 2D panel. Revision a20 remains archived.

## Findings and fixes

| Finding | Fix | Evidence |
| --- | --- | --- |
| The standalone molecular drawings in a20 lost the actual-tool context. | Restore six full-interface captures: AXE, AWT, AWZ, placed AWW, fixed-ligand Phe890 response, and BAY-293. | [Capture plan](../../design-history/publications/sos1/interface-chemistry-2026-09-07/capture-plan.json), [composer](../scripts/compose-sos1-interface-highlights.py). |
| The floating 2D drawing was small; enlarging it over the canvas could obscure the ligand. | Native **Enlarge 2D** docks the drawing in the right sidebar. Compact restores the floating panel. Sizing persists while reviewing checkpoints. | `app.js`, `index.html`, `styles.css`; browser captures. |
| Public atom highlighting reached only the 3D view. | Mirror persistent-ID highlights in the displayed ligand's 2D graph, with an orange legend; omit hydrogens and atoms outside the depicted component. | [Regression tests](../../depiction-highlights.test.mjs). |
| The existing geometry lookup for `atom-1` also matched `atom-10`, `atom-11`, etc., producing displaced overlays. | Require an exact atom-class match before using a bond endpoint or glyph position. This also repairs the shared selection-location helper. | Regression fixture proves `atom-1` cannot borrow endpoints from `atom-10/11`. |
| Normal playback discarded the final chemistry caption in favor of only “Story complete.” | Retain the final step caption and place completion text beneath it. | Final BAY-293 capture. |
| Closing an information panel during checkpoint review replaced the current caption with the next action's caption. | Resolve the caption from the completed move being displayed whenever review is available. | Regression test plus the caption checks attached to every capture. |

The new presentation replay is registered as `?story=sos1-chemical-edits`. It uses only seven hash-verified `campaign.import` operations and public display operations. Highlight assertions require the camera and displayed molecular context to remain unchanged. No energy calculation, optimization, coordinate interpolation, or later crystal input is performed. The original executable and checkpoint replay files are unchanged.

Orange identifies atoms outside the registered conserved atom-lineage subgraph, **not** a unique chemical atom mapping or a synthetic reaction. The captured sequence has 27, 29, 31, 31, 31, 31, and 32 ligand heavy atoms. The five distinct graphs have 0, 6, 12, 15, and 17 orange atoms. AWW's graph-edit highlights persist through placement and are cleared in the receptor-only panel, where the ligand graph and coordinates stay fixed.

## Reproduction

Generate the presentation with `node paper/scripts/build-sos1-interface-highlight-story.mjs design-history/publications/sos1/interface-chemistry-2026-09-07`. Start the local app with `bun server.js --local-only --port 8792`, open `http://127.0.0.1:8792/?story=sos1-chemical-edits`, and press **Play story**. Use **Enlarge 2D** and the completed-story arrows to inspect the recorded states. Close unrelated information cards through their normal controls. Capture the whole viewport at a consistent size; the capture plan identifies the exact review indices and highlight IDs. The archived PNGs are unaltered browser screenshots; only panel headings are added outside them during composition.

Run `node --test depiction-highlights.test.mjs paper/review/interface-chemistry.test.mjs`, then `python paper/scripts/compose-sos1-interface-highlights.py`. The manuscript builder preserves a20 and changes only Figure 2 and its caption in a21. All appendix prose, pseudocode, and the repaired vector Figure 4 remain unchanged. Builds and source files in this worktree are local until explicitly pushed; this document does not assert live deployment.

## Follow-up observation

The PDF check also found the inherited typo “Thia concept,” corrected to “This concept.” This one-word correction is recorded separately from the Figure 2 caption in the a21 edit manifest; all remaining manuscript text is unchanged.

The expanded Molecule Info card displayed a source-level SMILES description that did not obviously follow the final checkpoint's ligand graph. The graph-derived 2D panel is the figure's chemical representation, and that unrelated card is collapsed. The inherited source-description issue should receive a separate metadata audit; immutable scientific snapshots must not be rewritten to repair presentation text.
