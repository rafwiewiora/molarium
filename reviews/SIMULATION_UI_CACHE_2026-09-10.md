# Simulation UI, cached code and saved-frame readiness

Follow-up to [SR-08/09](SIMULATION_READINESS_2026-09-10.md). These are
application-state fixes, not changes to force fields or integrators. Frozen
SOS1 evidence and the submitted manuscript are unchanged.

## SR-10 — Run remains disabled after preparation

Preparation loads the prepared molecule while `state.preparing` is true. That
refresh disables Run; the `finally` block cleared the flag without refreshing
calculation controls. Changing the job dropdown happened to refresh them.
`prepareCurrentPdb` now refreshes controls after clearing the flag, including
failure paths. The [browser regression](../scripts/preparation-button.browser.test.mjs)
tests raw protein → rejected Run → preparation → first retry, without a dropdown
change event. It explicitly injects the CPU-reference engine option for CI;
this does not add that engine to the production interface.

## SR-11 — fresh HTML can coexist with cached older code

Live Chrome inspection found the new pre-minimization checkbox but no readiness
helper among observed loaded modules; the result lacked the new preflight audit.
The user reported improvement after a hard refresh. A separate HTTP check found
production `app.js` served with `Cache-Control: max-age=14400`, although the
repository's deployment headers request `no-cache`. This strongly supports mixed
cached assets; the exact Cloudflare dashboard override was not inspected.

The [build](../scripts/build-web.mjs) now attaches a content-derived release query
to local HTML script/style references and literal module/worker dependencies.
The [versioning helper](../scripts/version-web-code.mjs) leaves external pinned
assets and recorded scientific inputs untouched. The emitted release manifest
records the version and hashes the actual transformed files. Source files remain
untransformed. This is cache busting on a fresh page load, not hot replacement of
an already-open app or immutable archival hosting of old code URLs.

[Unit tests](../scripts/version-web-code.test.mjs) cover URL rewriting and release
identity; a [warm-cache browser test](../scripts/version-web-code.browser.test.mjs)
serves two releases on one origin with four-hour JS caching, then verifies a
normal reload updates the entry module, transitive dependency and worker.
Cloudflare documents [Browser Cache TTL overrides](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/set-browser-ttl/).
No dashboard settings or analytics were changed.

## SR-12 — replaying an MD frame triggers unnecessary minimization

Readiness originally hashed exact coordinates. Displaying a trajectory applies
rigid alignment, so even the saved final frame can differ from the raw worker
endpoint despite unchanged chemistry. Repeated MD then re-minimized it.

`runCalculation` now keeps a separate chemistry/parameter/energy-protocol proof
for the current qualified MD result and accepts only exact matches to its saved
display frames. No positional tolerance is used. Changing elements, topology,
parameters, solvent, constraints, cutoff or engine still invalidates reuse;
arbitrary geometry edits do not qualify. Replacing/clearing the result clears
the proof. Explicitly unminimized MD does not establish it. The result audit
identifies saved-frame reuse. Tests cover final/earlier frame selection,
coordinate edits and changed protocols in the [unit](../calculation-readiness.test.mjs)
and [public API browser](../scripts/calculation-readiness.browser.test.mjs) suites.
The [release smoke test](../scripts/readiness-release.browser.test.mjs) repeats
first/repeated/aligned-frame MD against built files rather than source files.

This is a minimization-startup policy, not a claim of equilibration, trajectory
stability or binding accuracy. Separate MD jobs retain existing velocity
initialization; selecting a saved frame is not full dynamical checkpoint restart.
