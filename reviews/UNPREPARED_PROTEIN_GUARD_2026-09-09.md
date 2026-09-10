# Unprepared-protein calculation guard

User report: clicking a simulation button on an unprepared protein produced
`webgpu/dynamics: RDKit could not read the current structure for Sage typing`.
Requested immediate behavior: `Please prepare protein`; button greying deferred.

[app.js](../app.js), `runCalculation`, now rejects current-system calculations
when protein atoms are present but there is no numerical parameterization
System—the same criterion used by the preparation panel's Prepared badge.
This happens before workers or the calculation overlay start and uses the
ordinary UI/API error path. It does not replace later errors on prepared systems.
Small molecules and independent built-in STORMM ensembles are exempt. Protein
structures whose edits invalidate parameters must be reparameterized before
direct calculation; existing preparation and pocket-relaxation workflows are
not modified. No preparation is performed implicitly by this guard.

[Browser regression](../scripts/unprepared-protein.browser.test.mjs) checks all
five engines, the actual dynamics button and exact message, unchanged atoms and
bonds, hidden overlay, and successful small-molecule/prepared-protein energies.
No buttons, force fields, scientific acceptance checks or paper artifacts change.

## Follow-up: edited-system regression (10 September)

The original criterion above was too broad: adding an R group correctly deleted
stale numerical parameters, but then incorrectly required protein preparation
again. See [SR-08 and SR-09](./SIMULATION_READINESS_2026-09-10.md) for the correction,
regression tests and separate 7KPA dynamics-startup investigation. The historical
description above records PR #31's behavior, not the corrected policy.
