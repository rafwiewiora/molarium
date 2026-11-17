# Distinct NVIDIA numerical controls and fixture-mount correction

**Current: L4-only jobs 20400 and 20402 are queued.** Earlier T4 attempts
stopped at setup gates and produced no numerical comparisons. The chronological
receipts below retain the eligibility mistake and the unchanged rejection gates.

Capability-only job 20285 completed on an actual NVIDIA L4. The requested-FP32 control job 20382 then lost its Spot node before payload startup: NODE_FAIL after 24 seconds, zero markers/logs and no numerical outputs. Its source-identical retry 20391 was subsequently cancelled while still PENDING and unallocated, after a distinct container-data defect was established. Both attempts are retained; no numerical failure is inferred from them.

Strict-FP32 job 20390 obtained a physical L4 adapter and passed the source/device checks, then stopped before its first seam: the container could not open the saved native fixture. TRUNK-MOUNT-01: the logical fixture path is an absolute symlink to the completed conversion in a different attempt directory. Binding only the later wrapper directory hid that canonical target. The original ENOENT, source checks, adapter proof and accounting remain in mount-failure-20390/.

The fix binds only that exact canonical fixture directory read-only. It reuses the existing native capture/conversion; nothing is regenerated. Before sbatch, the actual same-container Bun executable successfully opens every declared fixture file and verifies the original native fixture-receipt hash. The container image SHA-256 is recorded before submission and rechecked on the worker. GPU payloads repeat the small fixture-open preflight before any model/control calculation. Original mathematical sources, inputs and acceptance gates are unchanged.

The mount-corrected requested-FP32 job is 20398 (126 transition configurations plus four trunk cycles). The separate strict-FP32 job is 20399 (four trunk cycles only; pairMatrixKernels=false and observed rejection of f16 shader sources). Each has a separate immutable source manifest and public submission/preflight receipt. No transition sweep, native capture or conversion is repeated by the strict control. No NVIDIA numerical controls completed in these attempts; later setup outcomes and current L4-only attempts are recorded below.

Both use normal-priority managed PSIgreen GPU/L4/T4 Spot queues, one GPU, 4 CPUs, 14 GiB, a 30-minute allocation, no requeue, and the original November 20 deadline. A finite read-only observer preserves results; there is no automatic replacement loop or standalone VM. Device capability, fixture visibility and numerical agreement are separate checks. Apple precision evidence is in ../../trained-trunk-apple/README.md.

A later [eligibility amendment](t4-eligibility-amendment.json) adds the existing managed T4 Spot partition after checking every node's declared 4-CPU/14-GiB/one-GPU resource fit. These nodes were powered down at inspection; no T4 allocation or working WebGPU adapter is inferred. The scheduler may resume managed capacity normally. Source pins, requested resources, Nice=0, finite deadlines and all numerical gates are unchanged. The worker still verifies the actual guest/Slurm identity, genuine device and scientific inputs before calculation. There is no standalone VM request or autoscaling configuration change.

## Observed T4 setup failures and restored target

TRUNK-HW-01: the eligibility amendment checked CPU/memory/GPU-count fit but missed an inherited L4-only capability requirement. Job 20398 ran on a real Tesla T4 in the expected project/zone, passed source checks, and stopped at the explicit `NVIDIA L4` name test before browser or numerical controls. Widening queue eligibility did not qualify T4 hardware. The original gate and actual failure are preserved in T4-hardware-target-failure-20398/.

Job 20399 stopped at the combined project/zone identity assertion before adapter or numerical work. The old producer did not record returned metadata before asserting, so the precise mismatch is unproven. The gate is retained. New source writes the returned identity before assertions so a future rejection is inspectable; T4 is not declared compatible or assigned a looser identity policy. Its original log is in T4-identity-gate-failure-20399/.

Current distinct L4-only jobs are **20400** (126 transition configurations and four requested-FP32 trunk cycles) and **20402** (four strict-FP32 cycles only). All source/numerical/physical-device gates, canonical fixture access, genuine resource requests, Nice=0 and finite deadlines remain. Their immutable new attempt directories retain the same scientific inputs. The only verifier addition records metadata before existing identity assertions. No completed native capture, conversion, component measurement or pose prediction was repeated. A distinct T4 capability experiment is required before extending these controls to that target.
