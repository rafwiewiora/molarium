# OpenFF Sage browser parameter data

`sage-2.1.0.json` is a unit-normalized, mechanically generated representation
of the official `openff-2.1.0.offxml` parameter file. It retains the ordered
SMIRKS hierarchy and all numeric valence and van der Waals parameters. The
browser applies those patterns with RDKit, obtains deterministic Gasteiger
charges from RDKit, and hands the same complete numeric System to OpenMM 8.2
WebAssembly or the experimental direct WebGPU evaluator.
SMIRKS assignment uses all symmetry-related matches and the force field's
declared MDL aromaticity model. Ordinary X–H constraints are converted back to
their matching Sage harmonic bond terms for unconstrained 1 fs browser
dynamics, as recommended by the supplied golden schema.

Regenerate the browser asset with:

```sh
python3 openff/build_sage_data.py /path/to/openff-2.1.0.offxml openff/sage-2.1.0.json
```

Gasteiger is an explicit MVP charge model, not Sage's preferred production
AM1-BCC/NAGL charge workflow. The UI names it so results are not overstated.

## Rosemary alpha protein reference

`rosemary-trp-cage.json` is an exact, preparameterized protein reference made
with the official OpenFF stack. The input is the hydrogen-complete 20-residue
Trp-cage structure 1L2Y (304 atoms). Its force field is the published
`openff_no_water_unconstrained-3.0.0-alpha0.offxml` Rosemary alpha and its
charges come from the force field's `openff-gnn-am1bcc-1.0.0` NAGL model. The
OFFXML SHA-256 is
`b64617260a6bdf7befa6920d19e943ba09bb20b12968944fc369dbf86ee44e45`.
The alpha is documented in the official [OpenFF Rosemary workshop][workshop];
its source distributions are the [OpenFF force-field repository][forcefields]
and [2026 virtual-workshop materials][materials].

The fixture contains the complete unit-normalized numeric OpenMM System: 304
particles, 310 bonds, 565 angles, 1,436 periodic torsion terms, 304 nonbonded
particles and 1,687 exceptions. Both browser engines consume those same terms;
neither retypes the protein as Sage nor substitutes Gasteiger charges. Browser
OpenMM reproduces the native OpenFF/OpenMM Reference energy of
`-19.3478174091 kcal/mol`. The experimental f32 WebGPU result on the regression
machine is `-19.34766496 kcal/mol`, a `0.0001525 kcal/mol` difference.

Regenerate the fixture in an environment containing OpenFF Toolkit,
Interchange, NAGL, its model package, and OpenMM with:

```sh
python openff/export_rosemary_fixture.py \
  /path/to/trp-cage-1l2y-prepared.pdb \
  /path/to/openff_no_water_unconstrained-3.0.0-alpha0.offxml \
  openff/rosemary-trp-cage.json
```

This deliberately proves the browser calculation boundary with a real protein
System before attempting a browser port of OpenFF's protein chemical perception
and NAGL inference. It does not imply that arbitrary uploaded or OpenFold
proteins can already be parameterized in the tab. Rosemary remains an alpha;
its provenance must remain visible in results.

[workshop]: https://docs.openforcefield.org/en/latest/workshops/2026/ptm.html
[forcefields]: https://github.com/openforcefield/openff-forcefields
[materials]: https://github.com/openforcefield/2026-virtual-workshops

Validate parameter identities, numeric terms and the OpenMM WASM energy
against OpenFF/Interchange golden JSON with:

```sh
bun openff/validate-golden.js /path/to/goldens-or.zip
```

The validator treats only the schema's documented rigid X–H constraint to
harmonic-bond conversion as an allowed structural difference.
