# Physical NVIDIA browser capability: successful L4 probe

Job 20285 completed on an actual NVIDIA L4. The original EGL-only Chrome phase obtained a physical Vulkan/WebGPU adapter and returned integer probe 7. No model, transition or trunk calculations ran in this capability check. Source pins, GPU information, exact driver bindings, Chrome logs and receipts are retained. The different node and observer/timing prevent attributing success to one isolated runtime change.

The original submission contained unrelated scheduler rows. Its public copy omits only that field and records the original SHA-256 in public-redactions.json. Numerical/device observations are unchanged; the private unredacted tar is not published.

Numerical controls are separate: job 20382 lost its node before any payload and its source-identical retry 20391 is queued for the 126 transition configurations and four trained-trunk cycles. Its original requested-FP32 trunk configuration retains default half-arithmetic pair paths; the Apple strict-precision control and correction are documented in ../../trained-trunk-apple/README.md. No NVIDIA numerical pass is claimed here.
