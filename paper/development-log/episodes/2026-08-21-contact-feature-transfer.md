# Episode: a required contact outlives its ligand atom

Date: 2026-08-21
Branch: `dev`
Protocol: `molarium-pose-propagation-1` version `0.4.0`

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
