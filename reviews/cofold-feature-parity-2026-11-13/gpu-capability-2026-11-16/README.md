# NVIDIA browser capability diagnostic: operational history

Current status (17 November): the [capability-only L4 probe](observed-20285/README.md)
completed successfully with physical NVIDIA WebGPU and integer readback 7.
The [subsequent numerical attempts](numerical-2026-11-17/README.md) preserve a
pre-payload Spot loss and a demonstrated saved-fixture mount failure. Canonical
read-only fixture access is now verified in the actual container before
submission; distinct requested-FP32 and strict-FP32 controls remain queued.
No NVIDIA numerical-agreement result is claimed yet. The dated failure history
below is preserved rather than relabelled as successful science.

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

## Second unstarted loss and regular-queue recovery

Job **20198** also ended in Spot `NODE_FAIL`, from 22:13:58 to 22:14:23 UTC,
before any task payload, logs or result. Dependent job **20203** was automatically
cancelled at 22:14:24 without an allocation. Neither produced a capability or
numerical measurement. These terminal states and the absent start/output markers
are preserved in the [recovery evidence](regular-binding-attempt003/recovery-parent.json).

The [guarded recovery controller](regular-queue-recovery-controller.py) verified
both terminal jobs, empty logs, unchanged source hashes, actual production
identity and the absence of duplicate active controls. It submitted **20206**
for capability qualification and **20207** for the dependent numerical controls
at 22:20:35 UTC. Both were submitted to PSIgreen's regular `gpu` partition at normal
priority. Their later eligibility update and terminal outcomes are recorded
below; the original submission receipts retain the original request. These are managed jobs; no standalone VM or cluster configuration was
created or changed.

The [capability sources and receipt](regular-binding-attempt003/submission.json)
are byte-identical to the binding recipe above. The
[control sources and receipt](regular-controls-attempt002/submission.json)
change only the expected parent attempt path in the source verifier; the exact
[adaptation certificate](regular-controls-attempt002/source-adaptation.json)
records that substitution. All runtime, scientific harnesses, native fixtures,
precision settings and numerical gates remain unchanged. Slurm again cancels
the child if the prerequisite fails. The 10/30-minute limits and 20 November
22:30 UTC deadline are retained. At submission these jobs were pending; their
receipts do not establish successful execution or numerical agreement.

## Actual explicit-binding outcome

The regular queue later estimated a start after the unchanged 20 November
22:30 UTC deadline. At 00:50 UTC on 17 November, the
[same unstarted pair additionally became eligible for L4 Spot](observed-20206/l4spot-eligibility.json).
No job, source, priority, resource, dependency or deadline was replaced. T4 Spot
was excluded because the frozen recipe requires an L4. Requeue remained disabled.

Job **20206** then ran on a genuine NVIDIA L4 from 00:53:28 to 00:54:43 UTC.
Both explicit driver-library variants returned no WebGPU adapter. The GLX ICD
still lacked `vkCreateInstance`; the EGL ICD exposed that entry point and 23
instance extensions, but Chrome still returned null. Thus explicit library
binding alone did not establish browser GPU capability. This does not identify
the cause of the model's pose errors.

Dependent **20207** automatically cancelled without allocation or starting its
controls. **Zero transition cases or trained-trunk seams were measured.**
The finite collector preserved all 32 selected files with hash checks in the
[raw observation](observed-20206/observation.json),
[collection receipt](observed-20206/collection-receipt.json) and
[complete small output archive](observed-20206/terminal-results.tar.gz).
Original sources, logs, driver entry-point records and actual Slurm/GPU identity
remain in [the preserved files](observed-20206/raw). No native capture, conversion
or complete pose prediction was repeated.

## Focused device-discovery diagnostic

The next finite capability-only job, **20230**, was
[submitted](device-discovery-attempt001/submission.json) at 01:01:37 UTC on
17 November. It reuses the pinned container, Chrome and shared helper, and the
same physical-NVIDIA integer-readback gate. It measures host/container Vulkan
instance and physical-device discovery with the explicit EGL ICD; the already
failed GLX path is not repeated. It also corrects the diagnostic observer to
request `SystemInfo.getInfo` on Chrome's browser target rather than its page
target. That observer correction changes no molecular calculation.

If the diagnostic baseline still finds no adapter, one second browser phase
adds only `--enable-gpu`, as described in
[Chromium's headless GPU documentation](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/using-gpu-hardware-in-headless-chrome.md).
The [exact reversible probe adaptation](device-discovery-attempt001/probe-adaptation.json)
preserves the original physical-adapter and integer-7 assertions. This is a
runtime investigation, not a passed numerical comparison. No molecular model,
new native capture, conversion or pose prediction is requested; no dependent
numerical job was submitted.

The allocation is one GPU/four CPUs/14 GiB for ten minutes, at normal priority
on `gpu,l4spot`, with no requeue and the original 20 November 22:30 UTC deadline.
The [submission controller](device-discovery-attempt001/submission-controller.py)
first verifies the previous terminal failures, production identity, source pins
and absence of an active duplicate. It does not create a standalone VM or an
automatic replacement loop. At submission the diagnostic was pending.

## Capacity loss before payload and existing-node retry

Job **20230** ended in `NODE_FAIL` from 01:18:16 to 01:18:33 UTC, before any
task payload, batch step, log or capability measurement. The
[terminal node record](device-discovery-attempt001/terminal-capacity-loss.json)
identifies `ZONE_RESOURCE_POOL_EXHAUSTED_WITH_DETAILS`; no model or Vulkan
probe ran. This is a capacity failure, not a browser or numerical result.

One [source-identical retry](device-discovery-retry-attempt002/submission.json),
**20285**, was submitted at 01:31:40 UTC with the same resource limits, normal
priority, no requeue and unchanged 20 November deadline. It excludes the
17 nodes that were unbooted or unready at submission, leaving 90 already
booted nodes eligible through the same regular/L4 Spot queues. Existing jobs
are untouched; this task waits for a genuine scheduler allocation. It does not
create a standalone replacement VM or change cluster configuration. Source
manifest `1af42b5b…` and all seven diagnostic source hashes remain identical.

The [retry controller](device-discovery-retry-attempt002/recovery-controller.py)
checks the terminal parent, empty logs, absent payload markers, immutable
sources, live cluster identity and absence of an active duplicate. An earlier
[preflight stopped before staging or submission](device-discovery-retry-attempt002/preflight-abort.json)
because the failed node's current reason changed. The successful controller
uses the preserved authoritative failure for history and a fresh ready-node
inventory for eligibility. No calculation was repeated.

Public submission receipts now omit unrelated scheduler queue rows, which were
accidentally included with the diagnostic context. Each redacted copy records
the private original's hash and retains the relevant duplicate-check summary,
source pins and actual Molarium allocation. Original scientific outputs and
Molarium terminal logs are preserved.
