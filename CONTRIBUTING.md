# Contributing to Molarium

Molarium treats source history and validation evidence as part of the scientific record.

1. Branch from `dev` for normal development.
2. Open a pull request into `dev`; do not place a larger feature directly on a shared branch.
3. Require **Production build**, **Scientific validation**, and **Browser integration** to pass.
4. Promote a release from `dev` to `main` through a separate pull request.

GitHub Actions and runtime dependencies are pinned. The hardware-only WebGPU test remains explicit as `npm run test:ci:webgpu`; standard GitHub CPU runners do not provide a WebGPU adapter. Do not commit credentials, proprietary structures, or raw private session logs.
