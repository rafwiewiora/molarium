# Episode: a required contact outlives its ligand atom

Date: 2026-08-21
Branch: `dev`
Protocol: `molarium-pose-propagation-1` version `0.4.1`

## Observation

During a 7KPA design exercise, the user replaced the ligand pyridone group with a different cyclic
carbonyl intended to retain the same receptor hydrogen bond. Molarium displayed the captured contact
as unavailable because the old oxygen's stable atom ID had been deleted.

> “that is when it's really useful, when we're scanning for new R groups that can do the same thing!”

This exposed the distinction between atom identity and a medicinal-chemistry interaction
hypothesis. The receptor donor was unchanged; the intended complementary ligand acceptor had moved
to a newly constructed atom.

## Alternatives considered

1. **Always drop a contact when its atom ID disappears.** Safe but defeats the principal R-group
   replacement use case.
2. **Choose the nearest heteroatom in the current 3D coordinates.** Rejected because a distorted
   intermediate could silently define the chemistry and because several symmetric candidates may
   be equally close.
3. **Match any donor or acceptor of the right element.** Rejected because formal charge,
   protonation, aromaticity, and local valence can change donor/acceptor behavior.
4. **Exact chemical feature plus recorded edit boundary.** Adopted. It uses the completed graph,
   preserves the receptor participant, and makes ambiguity visible.

## Locked decision

Contact remapping runs only after the whole staged edit passes sanitization. The replacement must
match the captured donor/acceptor role, element, charge, aromaticity, heavy-neighbor/bond-order
signature, feature class, and surviving edit-boundary IDs. One candidate maps automatically;
several require a user choice; none leaves the contact unavailable. Current geometry is recorded but
never selects the candidate.

For a ligand donor, donor and explicit hydrogen are indivisible. A newly created hydrogen has no
trusted captured coordinate, so the implementation must not point it at the acceptor or invoke the
captured-hydrogen restoration path.

The audit found three additional identity hazards before release: a same-ordinal replacement could
reuse a deleted ID; a surviving donor with a newly reconciled H could move the inferred edit
boundary through the donor; and Undo could restore the molecule without restoring its contact map.
The final rule therefore uses an append-only atom-ID ledger, treats a replacement donor H as a tuple
anchored to the surviving donor, and snapshots molecule plus contact-resolution state atomically.

## Interface consequence

An unfinished chemical graph is not a valid input to parameterization or pose refinement. While a
transaction is pending, Molarium preserves the selected-contact intent, disables Optimize and
Refine, hides secondary viewer utilities, and places **Finish chemistry** and **Discard** in the
central viewer toolbar. After Finish, the 2D depiction, feature map, parameterization, and pose
workflow all consume the same sanitized graph.

The posing language was also clarified:

- **Reference-guided pose** is the interface section.
- **Refine edited group** runs several deterministic torsion-search chains against the rigid
  receptor and then constrained local relaxation.
- Results report distinct heavy-atom poses rather than calling every search chain a pose.

## Reproducibility record

Each applied mapping records its algorithm version, original and replacement ligand IDs and exact
feature signatures, immutable receptor participant IDs, edit-boundary IDs, complete candidate set,
before/after topology SHA-256 values, decision method, geometry evidence, and timestamp. The run
copies the complete mapping chain into a hash-linked `captured-contact-feature-mapping` event.
Unresolved proposals keep their originating edit and candidate identities across later edits.

## Tests

- unique carbonyl-oxygen replacement;
- ambiguity from two exact carbonyl candidates;
- rejection of a chemically incompatible oxygen;
- ligand donor plus explicit-hydrogen tuple replacement;
- surviving donor plus one or two reconciled replacement hydrogens;
- deleted-ID non-reuse across repeated same-ordinal replacements;
- shared alcohol/F feature perception and rejection of changed feature roles;
- unresolved ambiguity retained and resolved by a later candidate deletion;
- atomic remap/proposal restoration through Undo and Redo;
- monotonic labbook event timestamps;
- pending-transaction action guards and central Finish/Discard toolbar;
- browser-local end-to-end feature transfer, immediate-edit revalidation, and labbook inclusion.

## Live follow-up: the replacement crossed two completed edits

The first implementation passed a one-batch replacement test but failed the user's actual
pyridone-to-cyclohexanone workflow. The old group had been deleted and finished before the new ring
was constructed. Only the deletion batch still knew the removed acceptor's attachment boundary;
only the later addition batch contained the new carbonyl oxygen. The later batch typed that oxygen
correctly, but discarded it because its own comparison graph no longer contained the deleted atom.

Molarium now retains the unresolved deletion proposal and its topology hashes, exact feature
signature, attachment-boundary IDs, and originating edit ID. A later completed batch may resolve it
only with an exact feature created or changed in that batch at the same boundary. The applied audit
records both the originating deletion edit and the later resolving edit. A synthetic browser case
now performs the two finishes separately and verifies automatic transfer to the replacement C=O.

The same live test exposed two independent presentation defects. Newly attached atoms lacked the
PDB ligand's `HETATM` residue metadata, so the component model classified a covalently bonded new
oxygen as a separate one-atom molecule and the 2D panel could depict the wrong component. Attached
fragment atoms now inherit their anchor ligand's residue identity. Separately, constraining a new
RDKit depiction to the previous complete 2D MolBlock could over-constrain a large graph rewrite and
produce a flattened pseudo-3D-looking diagram. Each redraw now computes fresh RDKit 2D coordinates;
only a screen-space similarity transform preserves the panel's overall orientation and location.

A final transient failure came from array-index selections surviving atom deletion and hydrogen
reconciliation. Commit now tracks selected atom objects through reconciliation and remaps them to
live indices; UI descriptions also reject stale indices defensively.

Focused validation after these fixes:

- contact/remap unit protocol: pass;
- docking browser integration: 64/64 pass, including two completed replacement batches;
- RDKit 2D browser integration: 18/18 pass;
- production web build: pass.

## Live follow-up: Finish chemistry encountered an anonymous atom

A subsequent live edit reached **Finish changes** with one pending change and raised
`Cannot read properties of undefined (reading 'localeCompare')`. The chemistry was not the source
of the exception. A canvas or fragment addition can create an atom before a staged chemistry
transaction starts; the topology hash then attempted to sort that atom by a stable ID which had
not yet been assigned.

Stable identity is now a transaction invariant rather than a commit-time repair. When a docking
reference is active, Molarium assigns append-only IDs before taking the transaction snapshot and
again immediately after every mutation. Canonical topology serialization rejects an anonymous atom
with a descriptive error instead of leaking a generic JavaScript exception. This order matters:
the pre-edit snapshot and the staged graph must both be independently hashable.

The focused browser suite now includes (1) an atom added outside a transaction and deleted in a
one-change staged batch, and (2) a replacement carbonyl whose new oxygen is verified to have its
final stable ID before Finish. Docking browser integration passes 65/65; the 2D browser suite
passes 18/18; the docking unit protocol and production web build pass. The unrelated full browser
suite currently stops later when ONNX Runtime's WASM backend fails to initialize; none of the
changed files touch that runtime path, so this is recorded as a separate test-environment failure
rather than counted as validation of this edit.

## Live follow-up: one replacement preserves one contact and deletes another

The complete 7KPA pyridone-to-cyclohexanone example made the earlier carbonyl-only test look like a
failure. It is a paired chemical outcome. An initial live interpretation incorrectly assigned
`SER A60 N → D84 O2` to the edited pyridone. Inspection of the official D84 CCD corrected that
assignment: D84 contains two different lactam carbonyls. O2 belongs to the 2-oxopyrrolidone group
and contacts Ser A60; O3 belongs to the edited pyridone and accepts from Lys A11. The actual
transfer target is therefore `LYS A11 NZ-H → D84 O3`. The separate
`D84 N3-H → HOH C307 O` contact requires the pyridone N-H donor; cyclohexanone has no nitrogen
donor, so that hypothesis cannot transfer. A carbonyl oxygen must never be silently substituted for
the lost donor merely because it is nearby.

The exact unit fixture now carries both hypotheses through the same pyridone-to-cyclohexanone
replacement and requires the acceptor transfer plus donor rejection. The interface names the
chemical feature (`carbonyl acceptor`, `aromatic N acceptor`, or `N–H donor`) and tells the user to
uncheck that specific contact when omission is scientifically intended. Unavailable contacts remain
selected and blocking by default so a lost interaction cannot disappear silently.

This browser extension exposed a separate labbook timing race: pose generation reused the run's
earlier start time after several method events had already been appended. Labbook append now rejects
non-chronological events, and pose generation records its actual start time. Focused docking browser
validation passes 66/66 after both changes.

## Live follow-up: the missing Lys contact was a capture truncation

The user noticed that the Required contacts panel showed the pyridone N3-H-to-water contact,
the pyrrolidone O2-to-Ser contact, and the benzimidazole N2-to-Tyr contact, but not the expected
Lys A11-to-pyridone O3 contact. A clean 7KPA preparation proved that the geometry and feature
perception were already valid: `LYS A11 NZ-H → D84 O3` was detected at 2.268 Å H···O with cosine
-0.899. The loss occurred later. Reference capture reused the viewer helper, which sorted every
H-bond in the fully hydrated complex and sliced the list to the closest 96 drawing primitives.
The 1.70 Å N3-H-to-water contact survived; the longer Lys-to-O3 contact did not.

Reference capture now asks for the uncapped interaction set, while ordinary rendering keeps its
bounded list. The new checked-in real-structure gate prepares 7KPA with all waters and requires four
captured ligand contacts, including both pyridone hypotheses. This is a protocol correction, not a
display enhancement: a graphics budget is no longer able to modify the scientific constraint set.

## Live follow-up: a completed alcohol preceded the replacement carbonyl

The next live attempt was more realistic than the two-batch synthetic gate. The user first changed
the two pyridone C=C bonds to single, then deleted the ring, rebuilt a saturated six-membered ring,
and finally selected the new C–O pair to assign C=O. The replacement oxygen was visibly and exactly
typed as a carbonyl acceptor, but the Required contacts panel still reported the original O3 feature
as removed.

The defect was not chemical perception. The final transaction knew only that C–O had changed to
C=O, so its immediate edited subgraph ended at the neighboring ring carbons instead of the original
C23 scaffold attachment. The earlier test had created the complete replacement carbonyl in one
addition commit and therefore never exercised this loss of lineage.

The unresolved proposal now carries the cumulative live edit region across completed commits.
Bond-order changes contribute both surviving endpoints; the immutable original boundary is removed
from the accumulated region; and candidate traversal must reach exactly that original boundary.
No coordinate or distance criterion participates. This allows an interaction hypothesis to survive
an intermediate chemically complete alcohol without admitting unrelated carbonyls elsewhere.

An independent code review then found a provenance edge case before commit: candidates retained
from an earlier ambiguous proposal still carried their cached boundary. A candidate detached in a
later edit could therefore outlive its competitor and become spuriously unique. The final rule
re-perceives every retained feature, recomputes its boundary on the live graph, requires every
originating anchor to remain present, and drops cumulative edit components no longer connected to
that anchor. New unit gates cover detachment, anchor deletion, and disconnected edit pollution.

The new real-structure browser gate performs the exact 7KPA sequence: saturate pyridone, delete and
finish, build and finish cyclohexanol, then assign C=O. It proves that the Lys-to-O3 acceptor
hypothesis maps to the new stable oxygen ID while the deleted N3-H-to-water donor hypothesis stays
unavailable. The accompanying unit gate explicitly demonstrates that the final transaction's local
boundary is insufficient and the cumulative boundary is required. Validation after the fix:

- contact/remap unit protocol: pass;
- focused docking browser integration: 66/66 pass;
- hydrated 7KPA capture and edit regression: 3/3 pass;
- RDKit 2D browser regression: 19/19 pass;
- web distribution build: pass (69 files, 10.46 MiB).

The unscoped browser suite was also attempted twice. It reached the unrelated ANI-2x test and
stopped because this checkout has the vendored ONNX Runtime JavaScript bundle but no local
`node_modules/onnxruntime-web/dist` WebAssembly payload; ONNX Runtime therefore reported that no
WASM backend was available. The docking-focused suites do not invoke ANI-2x and pass in the same
browser harness. This environmental asset gap is recorded rather than misreported as a passing
full-suite result.
