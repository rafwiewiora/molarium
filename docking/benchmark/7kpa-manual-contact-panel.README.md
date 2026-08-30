# 7KPA manual contact-recapture panel

This preregistered development panel tests a specific medicinal-chemistry workflow: a captured
ligand pharmacophore is deleted, its obsolete H-bond hypothesis is explicitly forgotten, a new
same- or cross-class feature is built, and the desired receptor interaction is asserted before
reference-guided pose refinement.

The panel contains 10 cases: rebuilt pyridone and pyrrolidone carbonyls, two thiones,
cyclohexanone, a cyclic sulfonamide, pyrazole, tetrahydropyran, cyclic urea, and a dual-terminal
identity break. Together with the existing 20-case two-terminus panel and three high-disruption
enumerations, this gives 33 registered 7KPA transformation hypotheses. This is a method stress
test, not an affinity benchmark.

## Forgetting and reasserting a contact

The exact public action sequence is:

1. `pose.captureReference`
2. visible graph edits followed by `chemistry.finish`
3. verify that the old ligand feature is unavailable
4. `pose.forgetContact` for the obsolete captured hypothesis
5. visible graph edits followed by `chemistry.finish` to create the replacement feature
6. `pose.addContact` with one persistent ligand atom ID and one persistent receptor atom ID
7. `pose.refine`
8. `pose.apply` and `session.inspect`

No case calls a scorer, parameterizer, coordinate setter, or internal search function directly.
Fixture loading establishes the prepared reference system; all subsequent chemistry and modeling
steps use the same public Chemist Actions routes available to a designer. The manifest validator
requires every mutation batch to finish before contact actions, every replacement to follow an
explicit forget action, and every operation to map to a public route.

`pose.setContact({required:false})` is different: it omits a still-recorded hypothesis for one run.
`pose.forgetContact` removes an unavailable or manually added hypothesis from the active reference,
while retaining the amendment in molecule provenance and the hash-linked run labbook.

## Gates

```sh
npm run test:manual-hbond-browser
npm run test:7kpa-manual-contacts
npm run run:7kpa-manual-contacts
npm run test:7kpa-manual-contact-results -- --input <result.json>
```

The first real-system smoke run (`pyridone-carbonyl-manual-recapture`, one replay, eight search
chains) matched its preregistered product graph, produced 8/8 feasible poses, satisfied all four
required H-bonds in the selected pose, and passed labbook verification.

The complete panel was then executed twice per case from committed source `b6f18a8` on psiblue.
All 10/10 repeated pairs produced identical scientific replay hashes. Nine cases yielded feasible
poses; the sultam consistently reached refinement but returned `no-feasible-pose`, with two required
contacts unsatisfied in its best candidate. The immutable 13 MB raw result remains on psiblue and is
identified by SHA-256 in
[`7kpa-manual-contact-results.psiblue.v0.1.json`](7kpa-manual-contact-results.psiblue.v0.1.json).
That compact artifact also records preparation, replay, refinement, Chemist Action, scheduler CPU,
wall-clock, and peak-memory timings. The 20 replays are variants of one reference complex, not 20
independent systems, and feasibility is not a binding-affinity claim.
