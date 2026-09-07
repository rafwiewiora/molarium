# DV-04: option help and operation boundaries

This is the UI evidence for [DV-04 in the public finding → fix ledger](../../DESIGN_FINDINGS_AND_FIXES_2026-09-06.md).
The original scientific observations remain in the [validation report](../../DESIGN_FUNCTION_VALIDATION_2026-09-06.md).

## Implemented coverage

[Design help](../../../design-help.mjs) and the [shared workspace catalogue](../../../workspace-help.mjs)
cover **143 static parameter/action controls** in `index.html`, plus dynamic element, fragment,
required-contact/remapping/forgetting, contact-direction, candidate-pose, 2D-tool and frame controls.
The ordinary LSD workspace contains 173 rendered help buttons, including controls in closed panels.
Each is a real keyboard/touch button opening a native dialog. Disabled actions retain explanatory
help; selector help lists authored choices and marks choices unavailable for the current system.
Dynamic scientific results use their current labels and contextual explanations rather than claiming
that every replica, rotamer or plotted point is a separately documented method.

The scope includes Design, preparation and ligand protonation, shared loading/folding and display
parameters, simulation methods/settings, conformer/result/trajectory controls, story playback,
campaign history and export actions. Navigation/disclosure chrome and hidden file-picker plumbing
are explicitly excluded by the source-coverage test. Dynamically generated validation-dashboard,
component-navigation and plotted-result navigation widgets are not claimed as exhaustive parameter
coverage. This is not a claim that every option on every separate Molarium website page was audited.

UI propagation uses **v5 seeding and automatic worker execution**. Earlier protocol versions and
execution overrides remain API-only for replay/diagnostics; i buttons do not invent controls for them.

The descriptions explicitly distinguish:

- Fixed-protein, required-H-bond constrained ligand search from unrestrained pocket minimization.
- The 5 Å side-chain-only receptor shell from the 6 Å whole-residue/backbone-capable shell.
- Inherited atoms from the smaller protected search core, and induced-fit retention from that core.
- Discrete rotamer branches from energy minimization and from measured post-relaxation chi angles.
- Covalent X–H dynamics constraints from noncovalent design H-bond requirements.
- Ligand-only chemistry cleanup, designer whole-ligand pose locks, and named campaign history.

The actual protected/released counts appear after a search. Required-contact and live-geometry
scientific fixes are tracked separately in the parent ledger; this help does not add H-bond forces
to either minimizer.

## Verification and evidence

```sh
node --test design-help.test.mjs
bun design-help.browser.test.mjs
MOLARIUM_TEST_SCOPE=docking-contact-remap bun browser-test.js
```

Results: **6/6 source tests**, **10/10 isolated browser help checks**, and **79/79 docking browser
checks**. The help regression verifies all 143 static associations, disabled-control help, native
Enter/Escape behavior and focus restoration, no unintended setting/chemistry changes, dynamic
fragment rerendering, and a 390 × 844 mobile dialog. This is functional/UI verification, not another
simulation accuracy benchmark.

The separate hands-on browser-control lane operated the ordinary local LSD workspace, without
mutating hidden application state. Real clicks and keyboard activation checked method comparison,
checkbox help, disabled pose-lock help, and covalent dynamics-constraint help. Opening help kept
the checkbox checked and preserved the displayed LSD graph. Escape restored focus and reset
`aria-expanded` to false.

Final evidence (after all layout fixes):

- [Workspace](final-layout-v4.jpg), [DOM snapshot](final-layout-v4.txt), [measured layout](final-layout-v4.json).
- [Method comparison](method-comparison-v4.jpg), [exact displayed text](method-comparison-v4.txt).
- [Dynamics constraint distinction](covalent-constraints-v4.jpg), [exact displayed text](covalent-constraints-v4.txt).
- [Exact UI source hashes and check counts](final-ui-source-provenance.json).

At the actual **1512 × 805** browser viewport, Add/Select/Move are each 38 px high with unwrapped
labels. The SMILES remains 213 px wide; the 2D panel ends at y=741 and the toolbar begins at y=750.
Earlier images in this directory are intermediate development observations, not the final layout.

Checks during implementation caught and fixed label pollution, disabled help inherited from a
campaign-wide button guard, dialog opening at the bottom, old reserved icon padding causing
tool-label wrapping, a help wrapper squeezing the SMILES, and 2D/toolbar overlap. Those corrections
are implemented in the help module and [styles](../../../styles.css), with the final overlap offset in
[workspace layout CSS](../../../molarium-workspace.css). The browser regression retains corresponding
assertions; the older hover-only docking test was replaced with adjacent-button/dialog assertions,
not deleted.
