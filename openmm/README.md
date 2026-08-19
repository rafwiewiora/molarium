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

OpenMM is distributed under the MIT license reproduced in
`OPENMM-LICENSE.txt`.
