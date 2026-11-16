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

## Observed retry result and next diagnostic

Job **20186** subsequently ran on an NVIDIA L4 and ended with no adapter.
The [result](observed-20186/probe-result.json) shows that Chrome 157 starts in a
secure context and exposes `navigator.gpu`, but adapter acquisition returns null.
The [stderr log](observed-20186/chrome-stderr.log) identifies a Vulkan ICD loader
failure: `libGLX_nvidia.so.0` does not supply `vkCreateInstance` through its ICD
entry point. No molecular model ran. The [preservation receipt](observed-20186/preservation.json)
binds the original logs, actual GPU identity and genuine Slurm grant.

The container's `ldconfig` cache does not list NVIDIA graphics libraries; that
alone does not establish whether files or dependencies are missing. One new
[binding diagnostic](driver-binding-attempt001/submission.json), job **20188**,
therefore inventories installed host NVIDIA libraries, fingerprints them, and
binds the individual 64-bit files read-only into a task-local directory. It
tests explicit GLX and, if needed, EGL ICD paths, stopping at the first physical
NVIDIA integer-readback success. At submission it was pending. The existing
container image, Chrome flags, shared helper and hardware gate are unchanged.
No host driver installation, global library/configuration change or model call
is involved. Its time limit is ten minutes and its scheduler deadline remains
20 November at 22:30 UTC.

This follows the driver-library injection model in the
[Apptainer documentation](https://apptainer.org/docs/user/main/gpu.html).
NVIDIA also documents the
[EGL ICD alternative for environments without X11 client libraries](https://http.download.nvidia.com/XFree86/Linux-x86_64/555.58.02/README/installedcomponents.html).
The sources and receipt preserve a proposed runtime remedy, not a passed GPU
calculation or an established cause of the pose differences.

## Guarded follow-up measurements

The first binding allocation, **20188**, ended in another Spot `NODE_FAIL`
after 23 seconds, before the task payload began. It produced no start marker,
driver inventory, logs or binding result. The
[source-identical retry receipt](driver-binding-attempt001/unstarted-retry-20198.json)
records job **20198**, with the same source pins, real resource request, normal
priority and existing deadline.

One [new numerical-control job](qualified-controls-attempt001/submission.json),
**20203**, depends on successful completion of 20198. Slurm is configured to
cancel it automatically if that prerequisite fails. It rechecks physical
capability on its own assigned GPU, then runs the preserved transition-layer
harness and all 32 trained-trunk boundaries across four cycles. Native captures,
fixture conversion, equations, precision settings and predeclared error gates
are reused read-only. No complete pose prediction is requested. Its 30-minute
limit allows both controls and setup; the same 20 November retention/deadline
applies. This is a queued protocol, not a numerical result.

The [source reuse certificate](qualified-controls-attempt001/runtime-source-reuse.json)
binds the unchanged runtime recipe; a filename substitution preserves its original
bytes. Independent control failures are retained separately, and a failure in
one control does not discard the other. No repeated native calculation,
software adapter, priority change or standalone VM is involved.
