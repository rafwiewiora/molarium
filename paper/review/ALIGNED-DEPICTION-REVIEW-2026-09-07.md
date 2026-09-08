# Shared-scaffold 2D depiction review (a22)

This review addresses the author's request to align Figure 2's ligand drawings
and check the unusual aromatic bonds in step B. It changes presentation, not
the frozen design sequence. The a21 revision remains archived unchanged.

## Findings and linked fixes

| Finding | Cause | Fix and evidence |
| --- | --- | --- |
| Step B's AWT pyrazole had unusual aromatic bond styling. | The app passed a heavy-only graph to the depiction worker, losing the explicit pyrazole N-H information before sanitization. In the bundled RDKit 2025.03.4, parsing the full-H MolBlock with `removeHs: true` also failed on this fixture. The old display path could then use an unsanitized fallback. | `app.js` now appends attached hydrogens to the depiction input while preserving the displayed heavy-atom order. `rdkit-worker.js` sanitizes the full-H graph with `removeHs: false`, obtains the `remove_hs()` MolBlock, and strictly reparses it. The corrected AWT draws conventional aromatic single/double bonds and retains `[nH]`. |
| Independently generated 2D layouts made chemical edits harder to compare. | Unconstrained 2D layout does not ensure a common scaffold orientation across different ligands. | The native `view.setDepictionAlignment` display action constrains eight shared atoms to the starting ligand's 2D scaffold. The human-facing 2D panel exposes the same scaffold alignment control. It does not align, relax, or otherwise alter 3D poses. |

The saved AWT graph was correct. Its isomeric SMILES after strict sanitization is
`COc1cc2nc(C)nc(N[C@H](C)c3cccc(-c4cn[nH]c4)c3)c2cc1OC`.
Its identity is consistent with the [RCSB AWT chemical component dictionary](https://files.rcsb.org/ligands/download/AWT.cif).
The CCD is an identity check here, not a source of coordinates for the design run.
RDKit's [molecular drawing documentation](https://rdkit.org/docs/source/rdkit.Chem.Draw.rdMolDraw2D.html)
describes drawing preparation and Kekule depiction. The exact alignment interface
is defined in the bundled release's [MinimalLib implementation](https://github.com/rdkit/rdkit/blob/Release_2025_03/Code/MinimalLib/common.h).

## Scope and checks

The shared scaffold SMARTS is
`[#6]1~[#6]~[#7]~[#6]~[#7]~[#6]~1~[#7]~[#6]`.
The corresponding retained atom names, in matching order, are
`C1, C2, N6, C11, N8, C3, N7, C12`. The permissive bond queries allow the
same registered scaffold to be used across the series' distinct bond patterns;
they do not assert that every complete ring system is chemically identical.

`paper/scripts/audit-sos1-depiction.mjs` runs the real bundled RDKit WASM and
the actual depiction worker against all seven exact saved checkpoints. It
checks checkpoint hashes, strict sanitization, canonical isomeric SMILES
before versus after drawing, matched atom names, and common-scaffold 2D
coordinates. All seven pass; maximum shared-coordinate deviation is zero
at the MolBlock's written precision. The first AXE layout is the reference;
the six later states are constrained to it. In the browser replay, the
reference is also explicitly aligned to itself so all captures report eight
aligned atoms.

The resulting `worker-audit.json`, input MolBlocks, output 2D MolBlocks, and
worker SVGs are retained in
`paper/review/captures/2026-09-07-aligned-chemistry-a22/`.
Native browser PNGs, extracted native SVGs, and DOM metadata are stored beside
them. The compositor accepts only completed replays with exact captions,
exact persistent-ID highlights, eight aligned atoms, strict sanitization, and
the expected isomeric SMILES. It pastes the full screenshots unchanged and
adds headings outside them. Its figure provenance hashes the inputs, the
worker audit, and the relevant app source files including `rdkit-worker.js`.

No frozen graph, stereochemistry, receptor candidate, energy calculation,
scientific checkpoint, or saved 3D coordinate is changed. The screenshot
presentation imports the original seven campaign objects unchanged and runs
display actions only. `main.tex` is byte-identical to a21, and all other figures
are unchanged. These invariants are checked by
`paper/review/aligned-chemistry.test.mjs` and the a22 packaging script.

## Rebuild

From the repository root, regenerate the display-only story and audit:

```sh
node paper/scripts/build-sos1-interface-highlight-story.mjs design-history/publications/sos1/interface-aligned-chemistry-2026-09-07 --align
node paper/scripts/audit-sos1-depiction.mjs
```

Open the local app with `?story=sos1-chemical-edits-aligned`, play the story,
enlarge the native 2D panel, and capture the seven states at the review indices
listed in the capture plan. Preserve the fixed pocket camera. Then run:

```sh
python3 paper/scripts/compose-sos1-interface-highlights.py --aligned
python3 paper/review/build-aligned-figure-revision.py build
cd paper/revisions/2026-09-07-aligned-chemistry-a22
tectonic --only-cached --untrusted --keep-logs main.tex
```

Back at the repository root, validate and package:

```sh
node --test paper/review/aligned-chemistry.test.mjs
python3 paper/review/build-aligned-figure-revision.py package
```

Render the resulting PDF's Figure 2 page with Poppler and inspect it before
delivery. The final outputs are `output/pdf/molarium-author-approved-a22.pdf`
and `output/prism/molarium-prism-author-approved-a22.zip`. Use `refresh`
instead of `build` only when intentionally replacing the generated a22 assets;
neither command modifies a21.
