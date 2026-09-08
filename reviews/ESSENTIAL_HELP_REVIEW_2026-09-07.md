# EH-01 — reduce help-button clutter

The user reported that the deployed SOS1 checkpoint story and main application
had an **i** button beside nearly every control. The previous DV-04 implementation
met the request for broad explanations but made routine interaction visually busy.
This finding supersedes its everywhere-visible icon policy, not its scientific
descriptions or recorded historical evidence.

## Fix

[The explicit essential-control list](../design-help.mjs) limits separate help
buttons to 24 consequential choices across the application: replay semantics;
pose propagation, cleanup and receptor refresh; required-contact declaration;
relaxation method, rotamer enumeration and ligand locking; connected motion and
automatic chemical finishing; preparation policies and protonation; folding;
simulation job, method, solvent and constraints; replicas, conformer comparison,
and Local Lab integrity verification. Not all appear in the same workspace.

Routine actions, element/tool grids, repeated fragments, contacts and candidates
no longer receive individual icons or layout wrappers. Their existing titles are
preserved; otherwise the authored explanation becomes a native hover description.
The complete help catalogue and choice explanations remain in the source. Crucial
dialogs retain keyboard/touch access, focus restoration and disabled-control
prerequisite help. This change does not alter chemistry, calculation settings,
replay checkpoints or scientific results.

## Regression checks

- [Source tests](../design-help.test.mjs) require valid unique essential IDs,
  preserve full catalogue coverage, and reject routine/dynamic icon expansion.
- [CI browser regression](../design-help.browser.test.mjs) checks exactly 24
  associated help buttons, unwrapped titled routine controls, zero repeated
  fragment icons after rerender, dialog accessibility, mobile fit and unchanged
  molecular/settings state.
- The Local Lab manifest is regenerated because the shipped help module changed.

The prior [DV-04 observations](./DESIGN_FINDINGS_AND_FIXES_2026-09-06.md) and
[screenshots](./design-remediation-2026-09-06/ui/README.md) remain historical evidence,
not screenshots of this revised presentation. CI results are attached to the
pull request implementing EH-01; no new hands-on browser evidence is claimed here.
