# Debugging episode: chemist actions and a transformed ring

Date: 2026-08-22

Branch: `feature/constraint-guided-conformers`

Protocol: `molarium-pose-propagation-1` version `0.8.0`

Status: focused implementation and validation complete

## Trigger

The user proposed a simpler medicinal-chemistry route for the difficult 7KPA replacement: do not
delete and reconstruct the pyridone ring. Change its two C=C bonds to single bonds to make the
lactam, then change N-H to CH2 to make cyclohexanone. The user also asked that agents be able to
operate Molarium only through routes available to chemists:

> “introduce a kinda API, I want agents to be able to 'use' the tool themselves, but be strictly
> constrained to routes available to chemists, no picking parts of code they like”

These are the same methodological issue. A trustworthy automated regression should reproduce an
auditable chemical operation, not call whichever internal function happens to make a desired test
pass.

## Incorrect inherited-core assumption

Pose Propagation 0.7 fixed every surviving same-element reference heavy atom. That is correct for a
new methyl attached to an unchanged ring, but wrong when the chemist changes the ring itself. After
the two C=C→C-C edits, all six ring atom IDs survive; fixing them all forces the saturated lactam to
retain the planar pyridone coordinates. Changing N→C then releases only one atom, still preventing
the cyclohexanone ring from reaching ordinary saturated-ring geometry.

The v0.8 rule is topological and deterministic:

1. Compare the pre-commit and post-commit graphs by persistent atom ID.
2. If an existing ring atom changes element/formal charge, or an existing ring bond changes order
   or aromaticity, release the complete touched ring system.
3. Release directly multiply bonded exocyclic atoms, such as the carbonyl oxygen, and attached
   hydrogens with that ring.
4. Keep every external single-bond heavy-atom boundary fixed.
5. Record changed atoms/bonds, ring/release/boundary IDs, edit ID, and commit time. Accumulate the
   release across successive commits.

Attaching methyl to an unchanged phenyl therefore does not release the phenyl. Saturating the 7KPA
pyridone releases its ring and O3; C23 remains exact. The later N→C operation retains the release.

## Closed-ring generator boundary

A standalone `molarium-closed-ring-conformer-generator/v1` module was added as a future swappable
generator, not silently inserted into the current product path. It accepts a local conformer-backend
callback, fits and hard-snaps the external core, attaches noncore regions, de-duplicates ring
conformers, scores them with a caller-supplied restraint/physical objective, and rejects candidates
that violate ring/boundary bond geometry, configured stereochemical handedness, or carbonyl
planarity. The browser can later supply the bundled RDKit ETKDG worker without changing the
placement, safety, ranking, or provenance contract.

This does not claim a native concerted ring algorithm and does not reproduce ICM BPMC. Keeping it
backend-neutral makes the missing scientific component explicit rather than disguising a ring chord
rotation as a conformer method.

## Chemist Actions v1

`window.MolariumChemistActions` is a frozen, versioned action dispatcher. It exposes inspection by
persistent IDs and only UI-equivalent mode, tool, connected selection, atom/bond/H edits,
Finish/Discard, Undo/Redo, reference/contact, refinement/application, and visible optimization
routes. It has no fixture load, state replacement, coordinate injection, score callback, arbitrary
function, network, or module route. Inputs are bounded plain JSON and commands execute serially.

During final review, the old `window.molariumTest` fixture harness was still installed on ordinary
page loads. Although it was not part of Chemist Actions, leaving it available would make the stated
automation boundary too easy to bypass. The production entry point is now an ES module, and the
fixture harness is installed only when a local server is explicitly started with `--test-api`.
An automation host must still grant the agent only the JSON dispatcher: no in-page API can constrain
a caller that already has arbitrary DevTools or page-JavaScript execution.

Every recognized action is timestamped and copied to the current molecule's bounded audit ledger.
The calculation's hash-linked protocol labbook remains separate: the action ledger records how the
chemist or agent operated the application; the calculation labbook records the numerical method and
hashed inputs/results.

## Defect found by the chemist-route regression

The first real 7KPA run sanitized the saturated lactam but refused to commit with:

```text
After graph atom 6970 has no stable designAtomId
```

Finish reconciliation had added new hydrogens after the last staged mutation. The transformed-ring
audit correctly required identities for the complete post-commit graph, exposing that these new
hydrogens had never received IDs. The fix assigns stable IDs after hydrogen reconciliation and
before graph hashing/ring analysis. The exact same public action sequence then passed; the test was
not weakened or routed around the provenance gate.

## Focused evidence

- Chemist Actions unit gate: pass.
- Chemist Actions real-browser gate: 9/9.
- Production-boundary browser gate: 3/3 (public frozen API present, privileged harness absent,
  internal modeling functions absent from `window`).
- Closed-ring generator unit gate: pass, including carbonyl-planarity and stereochemical-inversion
  rejection.
- Hydrated 7KPA gate: 4/4. It includes the direct C=C saturation then N→C sequence through the
  public action API, exact external C23 preservation, motion of the released ring, retained C28=O3,
  retained Lys→O3 hypothesis, explicit loss of the removed N-H donor hypothesis, plus the older
  delete-and-rebuild cross-class feature-remapping regression.

The result validates edit semantics, graph identity, release/fixation behavior, contact lineage,
and local cleanup. It does not yet establish prospective pose accuracy or validate the standalone
closed-ring generator as a released product path.

## Matched strain check

The first question after this gate was whether the resulting cyclohexanone was merely a valid graph
but internally strained. Scoring only the edited bound geometry would be misleading because the
crystallographic parent itself is not an isolated-vacuum minimum. The browser regression therefore
gained an explicit validation-only export of both exact coordinate sets.

Native RDKit 2023.09.6/MMFF94 converged both isolated-ligand controls. The parent released 39.5465
kcal/mol and moved 0.9639 Å heavy-atom RMS; the edit released 23.6955 kcal/mol and moved 1.0465 Å.
When the unchanged molecule was fixed and only the transformed ring plus attached hydrogens could
move, the parent released 13.7316 kcal/mol and the cyclohexanone only 1.2240 kcal/mol. On this force
field, the edit does not introduce excess local strain. It is nevertheless not a successful docked
pose: the edited carbonyl is 3.8565 Å from the captured Lys donor hydrogen. This debugging step
separated three claims that must remain separate in the paper and product: valid chemistry,
low-strain internal geometry, and satisfaction of the receptor restraint.
