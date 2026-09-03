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

Focused unit tests cover stable chi/hash rotamer selection, same-execution coordinate guards,
the distinction between v3 and v4 feature seeding, and fail-closed infeasible
pose application. Syntax checks and manifest-selection checks exercise the
figure construction without running a simulation. The renderer publishes a
movie and QA frames only when replay expectations complete successfully; the
paper builder independently requires a complete render, a completed replay
status, and matching capture hashes. Until the corrected render passes those
checks, the corrected action script and construction code are the result, while
the final movie and five-panel raster remain pending artifacts.

## Remaining uncertainty

The replay pins software-visible protocol identity, persistent Phe890 identity,
the unique selected chi-angle branch, and feasible pose application. It does
not treat byte-level coordinates after WebGPU relaxation as a portable
cross-adapter identity, nor does it by itself validate the physical model. The
final post-freeze structural comparison remains a separate evaluation against
the withheld crystal structure.

A GitHub-hosted software-WebGPU replay made that boundary concrete: it passed
the adapter probe and the first 30 public actions, then rejected the Phe890
enumeration because a raw whole-system Float64 digest differed from the digest
recorded after native-WebGPU relaxation. The portable script was corrected to
guard the persistent Phe890 identity, chi definitions, selection method, and
unique physical branch. The implementation still requires an exact dynamic
coordinate match between enumeration and application within either run.

## Public-API and publication closure

The publication renderer originally used a synthetic browser file-input event
to import the saved action script. That was replaced with the public
`designerScript.load` action, followed by a real press of the visible replay
control. This exposed one final API-parity defect: the generic Chemist Actions
input copier allowed eight nested levels, while Molarium's own valid replay
payload requires nine. The public boundary now allows twelve levels while
retaining its plain-JSON, 2,048-node, and 8-MiB limits and forbidden-key checks.
The renderer therefore uses no unpublished route to establish or mutate
molecular state.

GitHub Actions run `33726810931`, at commit
`903ca5e84923210f86c2fb563e3b0e4e74dc55fc`, completed the corrected replay on
Chrome 152 software WebGPU. The preserved execution contains 51 replayable
actions (33 scientific and 18 presentation actions), 208 completed API audit
records, and 150 hash-verified interface captures. Each of the four pose
searches evaluated 64 deterministic chains on three workers; the selected pose
was feasible in every case. Phe890 was selected by the unique circularly
equivalent $\chi_1/\chi_2=-180^{\circ}/90^{\circ}$ branch, and enumeration and
application agreed on both the same-run input-coordinate digest and the
selected candidate-coordinate digest.

The resulting 1600-by-1000, 12-frame-per-second movie contains 1,207 frames
(100.583333 s) and has SHA-256
`071b7622d2bda301e0c8e029da4d940d9608869013be33f7099c6992ce838591`.
Manual review covered the hit-centered camera, compound-21 edit and clash view,
the interpolated Phe890 motion, the re-fitted and relaxed open-pocket state, and
the final relaxed BAY-293 state. The validated movie, render manifest, and
five-panel paper figure are checked into their public repository destinations;
the temporary CI artifact and local staging directory are not publication
sources.
