# Design remediation evidence — 6 September 2026

This directory contains new checks of the fixes tracked in the
[DV-01–DV-07 ledger](../DESIGN_FINDINGS_AND_FIXES_2026-09-06.md).
The original failed observations remain in [the baseline directory](../design-validation-2026-09-06/).

Accepted API attempts contain lossless raw action records, the selected scientific source-file bundle,
the filtered reference PDB, and hashes of both compressed and decoded bytes. Archiving refuses
to replace an existing directory or accept a source-changing run. Source bundles preserve the
tested version even when the working implementation advances; historical-evidence checks do
not pretend to run the current GPU. The bundle is provenance evidence, not a standalone
application distribution; use the linked release and full repository to rerun the browser workflow.

- [API a03](./api-a03/manifest.json) is the source-stable **intermediate** contact-state fix:
  missing required intent blocks refinement until explicit omission, and 23/64 candidate chains
  are then feasible. It also verifies live geometry and optional C–F capture. Subsequent analysis
  identified loss of an unchanged donor-H identity during graph staging as the reason that the
  CDK2 contact looked missing. This intermediate pass is not presented as full-contact recovery.
- [API a04](./api-a04/manifest.json) adds conservative unchanged single-donor-H lineage
  preservation. Both original CDK2 contacts are required and satisfied, with 23/64 feasible chains;
  real PARP2 O28 deletion remains a fail-closed negative.
- [API a05](./api-a05/manifest.json) is the final scientific source-stable attempt. It includes
  the same full-contact correction plus refresh of the derived incident-bond distance after H
  coordinate preservation. Its scientific checks and measured CDK2 contact changes agree with a04.

Earlier local attempts a01/a02 completed their functional checks while sources were still being
edited. They are not accepted release evidence; a03–a05 preserve each source-stable implementation
stage instead. The [frozen regression test](../../docking/benchmark/design-contact-remediation.test.mjs)
verifies all three archives and independently remeasures geometry from raw current coordinates.

```sh
bun docking/benchmark/design-contact-remediation.mjs outputs/a-new-remediation-attempt
node scripts/archive-design-remediation.mjs outputs/a-new-remediation-attempt reviews/design-remediation-2026-09-06/a-new-archive
```

The registered hit supplies coordinate input; no analogue crystal coordinates are admitted.
This is a development functional regression, not a new blinded accuracy or performance cohort.
Hands-on option-help checks and integration/release verification are recorded separately.
