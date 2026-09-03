# Contributing to Molarium

Molarium treats source history and validation evidence as part of the scientific record.

## Change workflow

1. Branch from `dev`. Use a focused feature, fix, documentation, or infrastructure branch.
2. Open a pull request into `dev` for review and a permanent record of the change.
3. Require all three CI checks to pass: **Production build**, **Scientific validation**, and **Browser integration**.
4. Merge validated work into `dev`. Promote a release from `dev` to `main` through a separate pull request.

Small emergency fixes should still use a pull request whenever practical. Do not commit generated credentials, proprietary structures, raw private session logs, or external-service secrets.

Unless explicitly stated otherwise, contributions submitted for inclusion in Molarium are licensed
under the [Apache License 2.0](./LICENSE), consistent with section 5 of that license.

## Local checks

Before opening a pull request, run:

```sh
npm run build:web
npm run test:ci:scientific
npm run test:ci:browser
npm run test:ci:webgpu
```

The CI browser suite uses bundled runtime assets only. The broader `npm test` regression additionally exercises large, separately distributed model assets and should be run in an asset-complete checkout. Browser tests use `CHROME_PATH` when set and otherwise select the conventional Chrome path for the current platform.

`test:ci:webgpu` is the explicit hardware gate and requires a machine with a WebGPU adapter; GitHub's standard CPU runners do not provide one. The portable CI suite still validates the registered WebGPU reference evidence and all non-hardware scientific logic. CI dependencies and GitHub Actions are pinned so that validation changes are explicit in repository history.
