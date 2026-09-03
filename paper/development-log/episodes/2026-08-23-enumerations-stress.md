# Episode: difficult analogue ideas became an Enumerations boundary

Date: 2026-08-23

## User direction

The user asked for increasingly disruptive 7KPA modifications, including a
pyrazole, tetrahydropyran, and a spiro replacement spanning the phenyl linker
and pyrrolidone region, then observed:

> “this is starting to think about 'enumerations' module we'll eventually have”

## Engineering interpretation

The request was not treated as three hard-coded benchmark products. It exposed
the need for a reusable separation between:

- transformation proposal;
- visible/audited chemistry execution;
- exact product identity and deduplication;
- edit-disruption stratification;
- contact-driven pose generation;
- absolute physical sanity checks.

`enumerations/` now owns only the first four responsibilities. A catalogue
entry is a versioned plan compiled into the same public Chemist Actions a person
uses in Design mode. Pose code remains downstream and cannot be called as an
enumeration shortcut.

## Debugging result that changed the design

All four selected contact geometries could be satisfied for the spiro product,
but the selected pose still contained 11 receptor–ligand clashes and raw
Lennard-Jones energy of +1870.38 kcal/mol. Its reference-subtracted ranking
score was strongly negative only because its inherited starting interaction
was worse. This showed that contact feasibility and improvement relative to a
bad start cannot serve as physical acceptance criteria.

The implementation therefore records a separate absolute pose screen and
retains the spiro case as `contact-feasible-review-required`. This is a useful
failure, not a hidden or deleted result.

## Evidence

- Transformation catalogue: `enumerations/catalogue.v0.1.json`
- Exact protocols and results: `enumerations/RESULTS.v0.1.md`
- Raw two-replay result SHA-256:
  `80047f9ac6c12a09f37103b7b0e44e6a79cb7033a032044ae95a26f68fdc0f75`
- Focused gates: `npm run test:enumerations`,
  `npm run test:7kpa-high-disruption-results`, and the public Chemist Actions
  browser test.

The curated record reports observations, hypotheses, decisions, and executable
evidence. It does not attempt to publish hidden model chain-of-thought or
private session context.

## Validation-environment diagnosis

A later monolithic browser run initially appeared to report repeated OpenMM
failures. Adding the calculation backend to worker errors showed that the
failure actually belonged to ANI-2x. The checkout lacked two intentionally
untracked prerequisites: ONNX Runtime's installed WASM files and the seven
external ANI-2x network assets. Restoring the pinned ONNX Runtime 1.27.0 package
from Bun's offline cache advanced the test to an explicit missing-model error.

No scientific result was reclassified because of this environment failure.
The OpenMM worker smoke test, focused Chemist Actions and docking browser tests,
real 7KPA contact-capture test, and all asset-independent unit gates passed.
The hash-pinned ANI-2x assets must be fetched separately before the monolithic
ANI parity section can run.

After the assets were fetched and verified, the complete suite reached 446
checks. Two geometry tests were the only failures: valid explicit ammonium at
109.4710–109.47135° failed a 0.00001° identity threshold, and valid bent water
at 103.978° failed an exact 104.52° threshold after force-field polishing. The
assertions were corrected to test chemical geometry rather than a particular
floating-point construction: ammonium within 0.001° of tetrahedral and water
within the explicitly bounded 100–110° bent range. The same correction was
applied to bond lengths: the builder's covalent-radius targets are 1.02 Å for
N–H and 0.97 Å for O–H, while the old tests demanded 1.01 Å and 0.98 Å to a
microångström. The new tests retain strict valence and sanitization checks and
bound N–H to 0.95–1.10 Å and O–H to 0.90–1.05 Å.
