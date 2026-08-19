# Browser ML potentials

Molarium's first MLIP lane is the official eight-member TorchANI ANI-2x
ensemble. It is restricted to neutral, closed-shell, hydrogen-complete molecules
containing H, C, N, O, F, S, and Cl, with a current 96-atom browser cap. ANI-2x
was trained at the wB97X/6-31G(d) level and is not a protein force field.

`export_ani2x.py` reads TorchANI 2.8.1's official `ani2x_state_dict.pt` and emits
one ONNX graph per element. The browser computes the canonical 1008-component
ANI-2x AEV, asks ONNX Runtime Web for all eight atomic-network energies and
mean dE/dAEV, then contracts analytical AEV derivatives to coordinate forces.
Geometry optimization uses those forces directly; no classical-force-field or
finite-difference force surrogate is involved.

Regenerate the artifacts in an environment containing TorchANI and ONNX:

```sh
python mlip/export_ani2x.py
```

The manifest records the exact source-state hash and every generated artifact
hash. TorchANI's MIT license is included in `TORCHANI-LICENSE.txt`.
