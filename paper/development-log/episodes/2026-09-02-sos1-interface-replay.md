# Debugging episode: fail-closed SOS1 interface replay and publication frames

Date: 2026-09-02 Pacific time

Status: corrected replay source and publication-figure/movie construction; final generated assets require a complete, expectation-passing render

## Trigger

The SOS1 design trajectory had to be shown inside the normal Molarium interface,
with a readable fixed pocket camera, human-paced controls, and visible public API
actions. Iterative framing, caption, and pacing changes made the interface replay
clearer, but also exposed that visual continuity was insufficient evidence that
the intended molecular branch had been replayed.

## Rejected replay

An earlier selected-route script chose Phe890 with the legacy numerical candidate
index. Candidate ordering had changed during implementation development, so the
stored index selected the $\chi_1/\chi_2=+60^{\circ}/90^{\circ}$ branch rather
than the registered $-180^{\circ}/90^{\circ}$ branch. Compound 21 refinement on
that receptor branch did not produce a feasible selected pose. The resulting
replay and any figure assembled from it were rejected; they are debugging
artifacts, not scientific results.

## Diagnosis

Three replay assumptions were mutable but had not been made explicit:

- a candidate-array position was being used as the identity of a physical
  side-chain state;
- pose seeding behavior was not pinned to a named protocol version; and
- pose application did not require the replay to assert that the selected pose
  was feasible.

Together these allowed implementation drift to change the molecular meaning of
a superficially unchanged action sequence.

## Corrections

The selected route now identifies the Phe890 branch by normalized chi angles and
guards both its input and selected coordinate arrays with SHA-256 fingerprints.
The pose-refinement actions explicitly request
`featureSeedingProtocol: "v3"` and require the returned method
`molarium-edit-region-axis-seeding/v3`; this pin reproduces the registered
untargeted edit-region seeding behavior without the later affected-existing-rotor
seeds. Each refinement expects a feasible selected pose, and every subsequent
`pose.apply` expects `appliedPose.feasible: true`. Applying an infeasible pose now
fails closed unless an explicit, audited `allowInfeasible: true` override is used
for a deliberately negative control.

The publication figure builder no longer names action numbers. It resolves five
semantic checkpoints from the completed render manifest: the starting hit and
local pocket; compound 21 clashing with Phe890-in; the selected Phe890-out state;
compound 21 re-fit and relaxed in the opened pocket; and the final relaxed
BAY-293 prediction. Each selected result frame must match its manifest SHA-256.
The interface-story transformation focuses once on the starting pocket and uses
that camera for the later comparisons, so ligand motion is not confounded with a
camera refit.

## Validation and publication boundary

Focused unit tests cover stable chi/hash rotamer selection, coordinate guards,
the distinction between v3 and v4 feature seeding, and fail-closed infeasible
pose application. Syntax checks and manifest-selection checks exercise the
figure construction without running a simulation. The renderer publishes a
movie and QA frames only when replay expectations complete successfully; the
paper builder independently requires a complete render, a completed replay
status, and matching capture hashes. Until the corrected render passes those
checks, the corrected action script and construction code are the result, while
the final movie and five-panel raster remain pending artifacts.

## Remaining uncertainty

The replay pins software-visible protocol identity and exact selected
coordinates, but it does not by itself validate the physical model. The final
post-freeze structural comparison remains a separate evaluation against the
withheld crystal structure.
