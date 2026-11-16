# NVIDIA browser capability diagnostic: operational history

The numerical controls stopped before a measurement: job 19246 timed out
starting a Chrome page; job 19250 reported no compatible WebGPU adapter and
measured zero trunk seams. These are not measured numerical disagreements.
The [control ledger](../control-status-2026-11-16.json) preserves their terminal states.

A separate capability-only probe, job **20182**, received a Spot allocation but
ended in `NODE_FAIL` after 17 seconds, before its task payload began. Accounting
recorded no batch/compute steps; the attempt had no start marker, logs or result.
No browser capability or scientific calculation completed in that attempt.

The [actual retry receipt](retry-submission.json) records one source-identical,
immutable retry, job **20186**, submitted at 21:00:08 UTC on 16 November. At
submission it was pending for resources. It requests one GPU, four CPUs, 14 GiB
and ten minutes at normal priority through PSIgreen's regular/L4 Spot queues.
A scheduler-enforced deadline matches the existing runtime retention deadline,
20 November at 22:30 UTC; the runtime lifetime was not extended. No standalone
VM, priority change, or completed native calculation was introduced.

The [probe](probe.mjs) uses the unchanged shared browser helper and the same
pinned container, NVIDIA driver binding and Chrome wrapper as the failed controls.
A [logging wrapper](chrome-logging-wrapper.sh) captures stderr. Library/device
diagnostics, physical-NVIDIA adapter identity and one integer readback separate
startup/device capability from model correctness. There are no weights,
features or neural calls, and no software-adapter fallback. A successful probe
would still not establish a numerical-comparison result.

These are preserved cluster-specific diagnostic sources, not a portable inference
entry point. Source pins, the guarded [retry controller](retry-controller.py),
the original failure and actual new allocation identity remain attached. Further
results belong in a new dated receipt; this submission record is not a claim
that the queued probe has run or passed.
