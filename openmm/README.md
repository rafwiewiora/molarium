# Molarium OpenMM WebAssembly module

This directory contains OpenMM 8.2 compiled for WebAssembly and a small C API
used by `openmm-worker.js`. The browser worker supplies the complete particle,
constraint, bond, angle, periodic-torsion, nonbonded and exception arrays
assigned from OpenFF Sage 2.1.0 or exported from the OpenFF Rosemary protein
alpha. The bridge constructs a non-periodic OpenMM
`System` and returns potential energies, coordinates, and force vectors from the
double-precision Reference platform. Runtime options can add X–H constraints,
select a 2 fs `LangevinMiddleIntegrator`, enable a nonperiodic cutoff, and add
the same OBC2/ACE implicit-water model evaluated by the direct WebGPU path.

The old `MolariumFF 0.1` entry point remains in the binary only for compatibility
with earlier saved builds; it is not exposed as a calculation method. The UI
offers real OpenFF Sage/OpenMM and RDKit MMFF94/UFF paths instead.

## Rebuilding

Download the OpenMM 8.2.0 source and install a modern Emscripten toolchain,
then run:

```sh
bash openmm/build-wasm.sh /path/to/openmm-8.2.0 /path/to/emscripten-prefix
```

The pinned source archive URL, SHA-256, toolchain version, patch hashes, bridge
hash, output hashes, and five-pose native parity report are recorded in
`BUILD-PROVENANCE.json`. Verify the downloaded archive against that record
before extracting it. To stage a rebuild without replacing the checked-in
runtime, set `MOLARIUM_OPENMM_OUTPUT_DIR` to an empty directory. If the
Emscripten installation cache is read-only, set `EM_CACHE` to a writable
scratch directory.

The script applies `openmm-8.2-emscripten.patch` plus the browser-only serial
CCMA setup patch in `openmm-8.2-emscripten-ccma.patch`, builds the static OpenMM core
with WebAssembly exceptions, and replaces `molarium-openmm.js` and
`molarium-openmm.wasm`. The generated module has no embedded molecule or force
field and does not use Emscripten's virtual filesystem; the worker provides
the fully parameterized numeric `System`.

The CCMA patch is required because this build intentionally omits pthreads;
unpatched OpenMM tries to create a Reference-platform thread pool while
constructing a constrained `Context` and deadlocks in browser WebAssembly.
Native OpenMM builds are unaffected.

`docking/validation/cloud-panel/score_openmm_wasm.mjs` scores an integrity-
checked pose packet with any staged WASM build. The companion
`validate_openmm_wasm.py` links the same C bridge to a native OpenMM build and
records component-wise energy and force parity without retaining molecular
coordinates or host metadata in the published report. The companion real-browser evidence is
`docking/validation/cloud-panel/browser-sage-openmm-validation-2026-08-23.json`; both report hashes
are pinned in `BUILD-PROVENANCE.json` and checked by `npm run test:openmm-wasm`.

OpenMM is distributed under the MIT license reproduced in
`OPENMM-LICENSE.txt`.
