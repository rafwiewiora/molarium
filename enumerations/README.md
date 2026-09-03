# Enumerations

This directory is the beginning of Molarium's versioned analogue-enumeration
layer. It is intentionally separate from docking and scoring:

- a catalogue describes a proposed molecular graph transformation;
- `action-plan.mjs` executes it only through the public, audited Chemist
  Actions API used by the visible Design tools;
- `edit-difficulty.mjs` reports transparent graph-lineage disruption;
- pose refinement, strain, contact feasibility, and independent energy checks
  remain downstream measurements.

The difficulty number is not an MCS, affinity, synthetic-accessibility, or
pose-quality score. Its full component breakdown and formula travel with the
number. This makes it useful for stratifying validation cases without turning
an implementation heuristic into a scientific claim.

The first development catalogue contains three 7KPA/D84 stress ideas:

1. pyrrolidone to an N-linked pyrazole;
2. ring expansion to a tetrahydropyran;
3. replacement of the phenyl–pyrrolidone region by a spiro[4.5] ketone.

They are hypotheses to test. Registration in the catalogue does not imply that
the product is chemically preferred, synthetically accessible, correctly
protonated, or capable of satisfying the inherited contact.

## Engineering boundary

An enumeration entry is data, not executable application code. Its operations
are validated by `action-plan.mjs` and compiled into the same bounded Chemist
Actions used by the visible Design tools. The runner may inspect persistent atom
IDs, select atoms, stage ordinary graph edits, finish chemistry, capture a
reference pose, choose registered contacts, refine, and apply a pose. It cannot
replace coordinates, call an internal scorer, inject a product graph, or attach
an arbitrary callback.

The intended future workflow is:

1. expand one or more versioned transformation axes into deterministic plans;
2. execute and sanitize every plan through Chemist Actions;
3. deduplicate products by exact product-graph hash;
4. record graph lineage and local/global edit difficulty;
5. run pose/contact generation only for chemically valid products;
6. retain contact feasibility separately from absolute clash/energy screens;
7. shortlist for independent calculation or human review.

Future combinatorial enumeration must add explicit limits, deterministic
ordering, tautomer/protomer identity, charge and stereochemistry policies, and
parent/product lineage. It must not infer that every catalogue product is a
reasonable molecule merely because its graph sanitizes.

See `RESULTS.v0.1.md` for the first real-browser stress run.
