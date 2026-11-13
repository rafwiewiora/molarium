# Audited LocalFold changes

The base remains LocalFold commit `5ea3d42c911949700401b54003cb28c557fcf2a6`.
`manifest.json` records each local patch separately, including the original,
patch and resulting SHA-256. `transition-5ea3d42c.upstream.txt` preserves the
exact original source. LocalFold code is covered by the accompanying BEER-WARE
Revision 42 notice, retained from Sergey Ovchinnikov. Model parameters have
separate terms; see `vendor/localfold/LICENSE`.

`transition-stability-v1` makes two changes:

- Adds **experimental opt-in** `variance: 'shifted-fast'` to transition shader
  generators. Translating each row before computing its variance avoids the
  cancellation found in the near-constant component fixture. The translated
  values are materialized in existing FP32 workgroup scratch. Default `fast`
  and `two-pass` shader bytes are unchanged for all 126 checked configurations.
- Fixes standalone `Af3TransitionGpu.run` dispatch to pass the channel width to
  `transitionRowTile`, as the shader already does. At 384 channels, the original
  runner leaves 500 of 1000 rows and 1319 of 1761 rows unwritten. Preserved real
  GPU results verify full coverage after the correction.

There is **no UI/request switch or default cofold normalization change**. This
mode belongs only to transition generators. Passing it globally to Pairformer
or MSA variance options would change other unqualified kernels. The standalone
runner is not a demonstrated production-fold caller. Neither component finding
establishes a cause of the observed pose discrepancies. Full-model, NVIDIA
matrix and throughput qualification remain open.

Reproduce the import from an exact upstream checkout:

```sh
bun scripts/import-localfold.mjs /path/to/localfold
node --test folding/comparison/transition-patch.test.mjs
```

The importer verifies the base revision and every changed file, applies the
declared patch, and emits both `vendor/localfold/UPSTREAM.json` and
`folding/localfold-source.mjs`. Predictions carry the exact receipt and patch
hashes. A modified base or patch fails rather than being accepted as upstream.

`direct-proof.json` binds the direct generators to 105 exact shader hashes from
the 63 previously executed candidate configurations. The
[integration evidence](../../reviews/cofold-layer-parity-2026-11-13/integration/README.md)
also retains direct API measurements and both failed and corrected dispatch
stages, with independent raw-byte reanalysis.
