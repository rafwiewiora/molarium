# YTHDF2: matched native / JavaScript CPU atom features

**The production JavaScript CPU atom-feature encoder agrees with native at
matched inputs and full-FP32 weights for this second diagnostic system.**
This measurement uses Bun, with the GPU device argument omitted and GPU requests
blocked. It is separate from the earlier [STARD4 browser CPU/WebGPU test](../trained-target/README.md).
The YTHDF2 browser/WebGPU measurement and the NVIDIA trunk comparison remain pending.

| Checked values | Count | Relative RMS error | Maximum absolute error |
|---|---:|---:|---:|
| Learned atom-feature channels | 71,040 | 1.46 × 10⁻⁷ | 5.72 × 10⁻⁶ |
| Complete target-feature array | 82,695 | 1.44 × 10⁻⁷ | 5.72 × 10⁻⁶ |

The 63 copied input channels match exactly. All compared values are finite;
the learned native channels have nonzero RMS. The gates frozen before execution
were relative RMS ≤10⁻⁴ and maximum absolute error ≤10⁻³, with finite outputs.
Errors here describe numerical feature values, not pose RMSD in ångströms.

## What was controlled

The completed native job 19248 loaded the official OpenFold3 0.5.1 / OpenBind-0
checkpoint on an NVIDIA L4 and executed one strict-FP32 input-embedder call,
with TF32 disabled and zero whole-model forwards. Its features reproduce the
[same-processed-SMILES capture](../comparison-32qy-a1keo-processed-smiles.json)
byte for byte. No native inference was repeated for this comparison.

The JavaScript call used the exact captured generated reference positions,
elements, formal charges, atom-name features, residue types, MSA profiles and
deletion means. All 44 required trained tensors were mapped with the pinned
upstream OpenFold3 layout converter. The 185-token / 1,381-active-atom fixture
and expected 185 × 447 target array are preserved. The native 449-channel layout
is translated explicitly; the omitted unknown-DNA channels are verified zero.
No bound crystal coordinates or fitting to expected outputs were used.

The original full pipeline used differently generated reference inputs.
Agreement after controlling these inputs does not establish their equivalence,
explain the original pose discrepancy, or test projected single/pair embeddings,
the trunk, denoiser, confidence head, production quantization, complete sampling
or pose accuracy. These are two diagnostic systems selected because their pose
disagreements differed; they are not a representative parity benchmark.

The CPU component took 2.577 s in this run. Native timing covers a larger
input-embedder boundary. Those times do not establish a speedup or screening rate.
The benchmark continued during this CPU control, which made zero GPU requests;
its recorded launcher times remain non-isolated performance measurements.

## Raw evidence and replay

The [archive index](native-evidence.json) describes two parts totaling
23,052,380 bytes, SHA-256
`221298a91cd63cf0c0a121c2523eeb59c65fdc2513f5c86cee9f251c9d378464`.
It preserves complete native exposed arrays, exact trained weights, consumed
producers and inputs, the original CPU runner, converter sources/licenses,
and all 99 imported production/helper files at the recorded Git revision.
Native projected outputs remain in the archive but were not compared here.
The full checkpoint and caches are excluded. OpenFold3/OpenBind-0 authorship and
checkpoint identity remain attached to the [native receipt](native-receipt.json);
the [official release](https://openbind.uk/news/blog-openbind-0-advancing-open-molecular-structure-prediction/)
identifies the code and weights as Apache 2.0.

The [offline checker](../../../folding/comparison/check_trained_target_cpu.py)
validates every archive member, consumed source, input, mapped weight, controlled
feature and native channel correspondence, then recomputes errors from the
[raw measured output](measurement/actual-target.bin). It needs no model, GPU,
PyTorch, JAX or pickle and makes no neural calls:

```sh
python folding/comparison/check_trained_target_cpu.py \
  reviews/cofold-feature-parity-2026-11-13/trained-target-ythdf2-cpu
```

For a new CPU measurement of this fixture:

```sh
bun folding/comparison/run_trained_target_cpu.mjs \
  reviews/cofold-feature-parity-2026-11-13/trained-target-ythdf2-cpu/fixture \
  /tmp/new-ythdf2-cpu-result
```

The tool rejects an existing output directory. The [portable-source certificate](portable-source-adaptations.json)
records two import/repository-root substitutions from the original consumed
runner; arithmetic, data and gates are unchanged. A later runtime or source
revision is a new control, not a replacement for the preserved result. CI replays
the archived measurement and tests changed-output rejection without repeating
the encoder calculation.
