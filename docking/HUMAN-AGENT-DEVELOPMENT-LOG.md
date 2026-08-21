# Human–agent development log

This is the curated, version-controlled development record for Molarium's analogue-pose work. It
records conversation-visible observations, screenshot evidence, hypotheses, decisions, code
changes, and validation outcomes. It is intentionally not a reconstruction of hidden model
reasoning, system instructions, credentials, or other private context. A verbatim conversation
supplement, if desired, must be exported separately from the conversation platform.

Entries distinguish observations from interpretations. A hypothesis is not treated as a result
until a regression test or calculation resolves it.

## 2026-08-20 — from manual core docking to edit-lineage pose propagation

### User observation

> “why should we have to be selecting a core, why not just do the MCS of design vs reference?”

> “can't every compound with a consistent core be described as an edit from a reference and we
> would just reproduce the edit->minimize paths as a user would do in the viewer?”

### Interpretation and decision

For structures edited inside Molarium, stable atom identities provide a more exact correspondence
than a newly inferred MCS. Pose Propagation-1 therefore fixes every surviving reference heavy atom,
samples only graph branches containing no inherited atom, and fails rather than silently changing
to a global-docking problem when fewer than three non-collinear inherited atoms remain.

The literature basis, adopted pieces, exclusions, and exact procedure were frozen in
`POSE-PROPAGATION-PROTOCOL.md` and `protocol.mjs`. This is described as an independent experimental
composition, not as a claim that MCS placement, constrained embedding, torsion Monte Carlo, or
H-bond restraints are individually new.

### Validation

The unit and browser gates verify stable lineage, exact inherited coordinates, deterministic replay,
fixed-scaffold relaxation, required-contact feasibility, and hash-linked labbook provenance. See the
git commits and test commands recorded in `DECISIONS.md`.

## 2026-08-20 — methyl edit exposed competing cleanup semantics

### User observation and visual evidence

The user captured a 41-heavy-atom reference ligand, added a methyl group, refined 16 poses, and
reported four screenshots showing:

1. the ligand ring rotated immediately after the methyl edit;
2. refinement returned `0/16 feasible`, with all five visible poses at `171.94 kcal/mol`;
3. applying the first pose produced an implausible-looking bond at the new methyl attachment.

Conversation-visible wording:

> “then add Me … whole ring rotates”

> “high energy poses only”

> “apply 1 … bent bond to Me”

> “I think the initial flip is a conflict between what we did before ('local relaxation') vs this
> constrained approach”

### Root-cause hypothesis

The existing generic edit cleanup expands any touched fused ring into one movable unit. That rule
protects an isolated molecule from a partially fixed, distorted ring boundary, but conflicts with an
active captured analogue reference, where the inherited ring is the experimental pose hypothesis.
The first browser propagation test used a direct test helper that added an atom without scheduling
the real UI cleanup, so it did not exercise the observed failure path.

The identical candidate energies have a separate possible explanation: a methyl-axis torsion moves
only methyl hydrogens, so nominally different deterministic chains can collapse to the same heavy-atom
pose. That observation does not explain or excuse the initial inherited-ring movement.

### Change

- `Preserve reference` is the default cleanup after a pose-propagation reference is captured.
- In that mode, every surviving same-element reference heavy atom is fixed during automatic and
  explicit MMFF94/UFF edit cleanup; only new atoms and hydrogens move.
- `Free local cleanup` retains the older two-bond-neighborhood/fused-ring behavior as an explicit
  alternative.
- Every cleanup is appended to `source.interactivePolishHistory` with its mode and fixed/movable
  counts, and the run labbook embeds that preparation history.
- A browser regression now performs the actual canvas add-methyl path and requires bitwise-invariant
  inherited coordinates plus a chemically plausible attachment length.

### Related donor-H hypothesis and correction

A selected required contact in which the ligand is the donor has one degree of freedom not covered
by the heavy-atom constraint: the explicit donor hydrogen. If earlier cleanup rotates that hydrogen,
fixing the donor heavy atom cannot by itself restore the D–H–A direction. The first implementation
hypothesis was to point that H directly toward the acceptor. Independent review rejected it before
commit because it could manufacture a 180-degree contact while violating an sp2 donor's local
geometry. Pose Propagation-1 v0.3 instead restores a surviving required-contact H to its exact
captured coordinate. This recovers trusted input geometry without inventing chemistry; the ordinary
distance/angle feasibility gate still decides whether the contact exists. Receptor-donor contacts
are unchanged.

The same review found that non-protein fixed contact participants such as crystallographic waters
were stored as coordinates but were not included in the receptor provenance hash or integrity gate.
The capture now hashes the rigid 8 Å protein site plus every fixed receptor/water participant, stores
their stable IDs, and refuses a run if one is missing, changes element, or moves by more than
`1e-6 Å`.

### Validation outcome

All local release gates passed on 2026-08-20:

- `npm run test:docking`: PASS;
- `npm test`: 434/434 browser checks;
- `npm run test:2d`: 5/5 RDKit 2D browser checks;
- `npm run build:web`: PASS, 60 files / 10.30 MiB;
- `npm run test:local-lab`: 14/14 privacy checks, with zero requests reaching the
  pre-network interceptor.

The first Local Lab invocation was attempted inside the restricted process sandbox and timed out
while launching Chrome. It passed without code changes when rerun with local Chrome and loopback-port
permission. This environmental retry is retained here so the validation record does not present the
run as cleaner than it was.
