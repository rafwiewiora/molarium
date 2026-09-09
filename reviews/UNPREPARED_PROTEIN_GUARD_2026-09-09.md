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
