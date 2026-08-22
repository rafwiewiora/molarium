# Debugging episode: a 25-case bioisostere benchmark becomes a product test

Date: 2026-08-22

Branch: `dev`

Dataset: `molarium-bioisostere-pose-propagation-25` version `0.1.0`

Status: frozen run complete; implementation and evidence committed together

## Trigger

The user asked for an expanding test set built from experimental complexes:

> “shall we get more testing examples, like a large (25 systems?) set for now and ever growing,
> where you take a xtal and suggest the bioisostere yourself then see if they ‘dock’ with the
> constraints”

The immediate risk was constructing an anecdotal success gallery. The benchmark therefore froze
every case before the registered browser run, retained failures, separated prospective feasibility
from paired-crystal accuracy, and added deliberate negative controls.

## Frozen design

The cohort contains ten paired-crystal transformations, ten prospective bioisostere hypotheses,
and five adversarial negatives over fifteen targets. Every input PDB and CCD file is stored locally
with a SHA-256 digest. The blinded browser input omits paired analogue coordinates. Each runnable
case uses 16 search chains at three fixed seeds; every run retains its complete hash-linked labbook.

Role compatibility, not exact functional-group identity, defines a transferable hypothesis. A
captured acceptor can therefore be proposed as a carbonyl O, sulfonyl O, nitrile N, tetrazole N, or
another chemically perceived acceptor at the registered edit boundary. Ambiguous features remain an
audited any-of restraint. Whole-pose strain and receptor interaction scoring decide whether any
alternative is geometrically credible.

## Failures found before and during registration

1. **The edited group detached from the snapped scaffold.** RDKit embedded the complete product,
   the workflow aligned it globally, and then inherited core atoms were individually restored to
   their exact reference coordinates. Newly added atoms did not follow their attachment anchor,
   creating stretched bonds and an initial Sage energy near 94 million kcal/mol. New regions now
   follow their anchors before core snapping and use a deterministic local scaffold frame.
2. **Hydrogens did not follow the edited local frame.** Moving only replacement heavy atoms left
   attached hydrogens behind. The same rigid local transform now covers the complete new region.
3. **A negative control falsely found a replacement.** Aromatic/Kekulé representation changes made
   the inferred edited region encompass much of the ligand, admitting distant pre-existing donors
   or acceptors. Registered benchmark staging now limits eligible replacements to the frozen added
   edit region plus hydrogens on its added heavy atoms. The TNF pyridone→phenyl negative then changed
   from a false transfer to the intended infeasible outcome.
4. **A valid score used an invalid receptor superposition.** Fitting every matching Cα in the CDK2
   asymmetric unit mixed independently placed copies and produced a 33 Å receptor RMSD. The scorer
   now aligns the ligand-assigned protein chain, records the correspondence, and rejects any fit
   above 5 Å. CDK2 receptor RMSD became 0.343 Å and ligand RMSD 1.057 Å.
5. **The validator confused early termination with a missing run.** A BRD9 case correctly stopped
   because its frozen reference contact was unavailable, but validation demanded a pose record.
   Every pre-run terminal category now has explicit evidence requirements; unsupported
   parameterization, unavailable contacts, preparation blockers, and genuine runtime failures are
   no longer conflated.

These defects were discovered by heterogeneous cases and negative controls, not by adding more
assertions around the original 7KPA example. The set is therefore already serving as a product
regression suite as well as a scientific benchmark.

## Registered result

- 12/25 cases completed with a feasible pose.
- 7/10 prospective hypotheses were feasible; 7/8 among cases that reached pose search.
- 4/4 runnable negative controls remained infeasible; no false transfer survived.
- 5/10 paired cases reached hidden scoring. Their median-of-repeats best-of-five label-mapped
  heavy-atom RMSD was 3.163 Å; two were within 2 Å. The best pose observed over all three seeds had
  a 1.905 Å median and three within 2 Å, and is explicitly secondary.
- Five paired structures stopped at registered preparation blockers. One prospective ring
  replacement found no feasible pose, one lacked the frozen contact, and two PARP1 cases exposed the
  same unsupported parameterization boundary.

The 7KPA pyridone→cyclohexanone failure remains. A rigid single-anchor ring placement cannot change
the anchor-to-feature radius or explore ring pucker, and the current fixed-scaffold local relaxation
does not impose an H-bond force. The next method revision should add constrained ring embedding; it
must be evaluated as a new protocol arm rather than used to rewrite v0.1.0.

## Validation record

Commands and observed results:

```text
npm run test:docking                         PASS
npm run test:docking-browser                 68/68 PASS
npm run test:docking-benchmark-manifest      25/25 PASS
npm run run:docking-benchmark                COMPLETE, 25 registered cases
npm run score:docking-benchmark              COMPLETE, 25 cases
npm run test:docking-benchmark-results       25/25 PASS
```

The registered result, compact score, frozen manifest, blinded input, atom maps, interaction scan,
and 50 source fixtures are checked artifacts. Per-case restart files and smoke runs remain local and
ignored because their content is duplicated by the aggregate result.

## Remaining uncertainty

- v0.1.0 RMSD is label-mapped and not symmetry corrected.
- Five paired cases are too few for a competitive accuracy claim.
- Prospective feasibility has no experimental pose truth.
- Fixed-receptor scoring cannot establish induced-fit accuracy or binding affinity.
- Parameterization and preparation failures are part of current method coverage, not missing rows.

The public paper should quote only a manually reviewed redacted transcript or this curated episode;
the private raw rollout remains outside Git.
