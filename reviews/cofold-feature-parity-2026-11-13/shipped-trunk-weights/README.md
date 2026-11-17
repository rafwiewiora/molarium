# The shipped trunk weights reproduce the captured native parameters' quantization

**All 66 shipped FP32 tensors match the captured native values bit-for-bit.
Re-encoding the other 103 tensors with the unchanged upstream INT5 quantizer
reproduces every packed code, float16 scale and float16 offset exactly.**
There is no additional effective parameter difference beyond that quantizer
within this captured table. This does not establish full-model or pose agreement.

| Stored representation | Tensors | Native values | Exact identity check | Decoded relative RMS difference |
|---|---:|---:|---|---:|
| FP32 | 66 | 203,904 | All bytes equal | 0 |
| INT5, asymmetric groups of 32 | 103 | 150,993,472 | All re-encoded codes/scales/offsets equal | 0.0385387 |

The **3.85%** relative RMS difference describes quantized parameter values,
not network-output error, ligand RMSD, energies or prediction accuracy. Its
maximum absolute parameter difference is 0.31585145. No parameter-error
threshold has been substituted for the existing numerical model gates.

## What this isolates

The 169 captured tensors cover the trunk/input/MSA/template weight table and
the distogram parameters exported for its loader. The distogram forward was
not executed. All 169 names and shapes match the shipped OpenBind-0 manifest;
237 of its 406 tensor entries remain outside this audit. These are model
parameters, not 169 independent molecular systems.

The reference comes from the existing native OpenBind-0 checkpoint capture
and its unchanged pinned layout conversion. Its FP32 blob is 604,789,504 bytes,
SHA-256 `46df3199346512b29321a7e7dece80b9d701ef695eb24880b217287a812bd709`.
The shipped bundle is pinned to Hugging Face revision
`71ece3571b80e6cdb06f3b95f785187171c718da`. Every required shard's complete
digest was checked against the actual production manifest. Its eight shards
total 234,956,344 bytes; they also include parameters outside the tested table.

The producer calls the production `readTensor` host decoder. An independent
Python decoder reproduces every decoded tensor's byte hash, then applies the
unmodified [LocalFold quantizer](../../../folding/comparison/reference-localfold/quantize_af3.py)
at upstream revision `5ea3d42c911949700401b54003cb28c557fcf2a6`. It compares
packed codes, scale bits and offset bits separately. Both independent decoded
hashes and all 103 re-encodings agree. The [complete measurements](analysis.json)
and [independent results](independent-reencoding.json) retain every tensor,
including exact matches and the largest errors.

This rules out an extra parameter mismatch **for these effective weights**;
lossy quantization cannot prove the identity of an unknown pre-quantized source.
Input preparation, the remaining weights, device INT5 upload/decoding, half
arithmetic, denoising, confidence and complete sampling remain separate checks.
The next causal control must propagate these weights through matched trunk
inputs and arithmetic, rather than infer pose effects from parameter error.

## Execution and original failures

CPU job **21158 completed successfully** in 55 seconds, including remote
downloads, hashing, decoding and independent re-encoding. It requested two
CPUs, 6 GiB, normal priority and zero GPUs. This instrumented, network-inclusive
duration is not a model-speed benchmark. No model forward, native capture or
full-model conversion was repeated. Large inputs stayed remotely; only small
reports were retrieved to the laptop.

Two setup failures are retained in [history](history/): job 21153 stopped at an
invalid export created by a launcher token replacement; job 21154 stopped at
the CPU location assertion. Live GCP inventory showed that PSIgreen's login is
in `us-central1-c`, while its cluster-labelled CPU workers are in
`us-central1-a`. The corrected launch keeps project, controller, assigned-host,
CPU/memory, source and numerical checks, and binds the CPU location to that
verified topology. Neither failed attempt reached the audit or any model call.
The [plan](plan.json), [allocation](allocation.json), [source hashes](source-manifest.json)
and [terminal observation](job-observation.json) preserve the exact boundaries.

The initial CLI upload also stopped with HTTP 400 before any weight part was
published. Its [original output and transport correction](history/upload-transport-finding.json)
remain separate from the completed science. The successful upload uses explicit
content lengths and bounded RAM; it repeats no model calculation.

## Next: propagate parameter rounding under matched arithmetic

Regular-L4 job **21165 is queued at normal priority**, with no result reported.
Its [frozen plan](next-control/parameter-control-plan.json) reuses the captured
native inputs and sampled MSA rows, the same four-cycle loop, original numerical
gates and strict-FP32 shader guard. It supplies the shipped values through the
validated host decoder, exposing the same captured names/shapes and logical
FP32 representation. This isolates parameter rounding from the device INT5
upload and half-arithmetic paths.

The [producer adaptation](next-control/producer-adaptation.json) reverses exactly
to the measured native-weight producer; its actual interpolated browser expression
is parsed before requesting hardware. The completed native-weight control 20535
is not repeated. No new native capture, conversion, complete prediction, Spot
replacement or standalone VM is part of this queued control.

## Complete public inputs and replay

The [public release](https://github.com/rafwiewiora/molarium/releases/tag/cofold-trained-trunk-2026-11-17)
now supplies the exact native weight blob previously omitted from the trunk
array archives. The [verified input index](raw-evidence.json) identifies eight
parts, per-part server digests and the concatenated blob hash. It also attaches
the upstream OpenFold3 license and inventory. Uploading streamed bounded parts
through RAM and wrote no large weight files to the laptop.

To reconstruct the native fixture for this audit, use a new directory and
verify each downloaded part before accepting the joined blob:

```python
from pathlib import Path
import hashlib, json, shutil, urllib.request
report = Path("reviews/cofold-feature-parity-2026-11-13/shipped-trunk-weights")
index = json.loads((report / "raw-evidence.json").read_text())
fixture = Path("REPLAY_NATIVE").resolve(); fixture.mkdir()
shutil.copyfile(report / "native-weights.json", fixture / "weights.json")
shutil.copyfile(report / "native-fixture-receipt.json", fixture / "receipt.json")
whole = hashlib.sha256()
with (fixture / "weights.bin").open("xb") as out:
    for part in index["parts"]:
        h, size = hashlib.sha256(), 0
        with urllib.request.urlopen(part["url"]) as response:
            for block in iter(lambda: response.read(1024 * 1024), b""):
                out.write(block); whole.update(block); h.update(block); size += len(block)
        assert size == part["bytes"] and h.hexdigest() == part["sha256"]
assert whole.hexdigest() == index["archiveSha256"]
plan = json.loads((report / "plan.json").read_text())
plan["relocatedFromPlanSha256"] = hashlib.sha256((report / "plan.json").read_bytes()).hexdigest()
plan["fixture"] = str(fixture)
Path("REPLAY_PLAN.json").write_text(json.dumps(plan, indent=2) + "\n")
```

Relocating the input directory creates a new plan hash; the fixture and all
source/weight hashes still have to match. With Node/Bun and NumPy available:

```sh
node folding/comparison/audit_shipped_trunk_weights.mjs REPLAY_PLAN.json NEW_MEASUREMENT
python folding/comparison/check_shipped_trunk_quantization.py \
  --plan REPLAY_PLAN.json --measurement NEW_MEASUREMENT --output NEW_REENCODING.json
```

Use a machine with space for roughly 0.85 GB of inputs and sufficient working
memory; the original job had 6 GiB. No GPU or neural computation is required.
The scripts reject changed source/input bytes, missing names, shape differences,
non-finite weights and differing independent decoded hashes. Tests also cover
corrupt codes, truncated metadata, partial groups and signed zero.

The native parameters retain the upstream [OpenFold3 terms](SOURCE_LICENSE.txt);
the unchanged quantizer retains its [LocalFold notice](../../../folding/comparison/reference-localfold/LICENSE).
These provenance and parameter checks are separate from the
[strict-FP32 NVIDIA output comparison](../trained-trunk-nvidia/README.md) and
the 480-prediction stock Boltz-2 pose study.
