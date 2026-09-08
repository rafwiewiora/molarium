# Figure 2 chemical-difference correction (a23)

The author identified misleading highlights on retained parts of the ligand.
The earlier overlay compared persistent atom identifiers, which describe object
lineage rather than chemical equivalence. Replacing a graph could allocate new
identifiers to unchanged methoxy groups or a retained phenyl ring. Equivalent
Kekule bond assignments also must not be interpreted as chemical edits.

## Fix and evidence

The helper `paper/scripts/sos1-chemical-change-map.mjs` builds a reviewed chemical
correspondence between the exact saved graphs. It uses strict full-hydrogen
sanitization, removes hydrogens afterward, and normalizes aromaticity with the
bundled RDKit. Retained lineage and explicit structural correspondence identify
equivalent atoms; added atoms and endpoints of actual normalized atom or bond
changes are highlighted. The mapping is not a synthetic reaction mechanism or
an assertion of a unique atom mapping.

`paper/review/sos1-chemical-change-map.json` records the correspondence, normalized
changes, exact highlighted atom identifiers, source checkpoint hashes, and scope.
The chemical-map tests check that equivalent Kekule assignments produce no
difference, all retained methoxy groups remain unhighlighted, and actual graph
changes remain detectable. The same AWW highlights persist through ligand
placement and are cleared for the receptor-only response panel.

## Retained-source limitation and author decision

The frozen AWW graph agrees with the deposited CCD's 5,8-dihydro representation,
but differs from the aromatic compound drawn in the source medicinal-chemistry
paper. That difference is not an alternative Kekule assignment. The author
explicitly chose to retain the existing PDB-derived model and calculations,
without a new scientific run, and to remove the unsupported description of
restoring aromaticity as a designer operation.

The complete finding, discussion, source checks, and decision are retained in
[the source-graph discrepancy record](SOS1-AWW-SOURCE-GRAPH-DISCREPANCY-2026-09-07.md).
The new highlights describe differences in the retained frozen graphs. They do
not establish that those graphs reproduce every chemical feature in the original
paper, or that every highlighted difference was intended by its designers.
The initial publication hold on a cosmetic-only correction was superseded by
the explicit retention decision, not by evidence resolving the source mismatch.

## Paper scope and reproduction

Revision a23 preserves all a22 text except two Figure 2 caption sentences: the
highlight description now explains chemical differences, and step F no longer
claims restoration of the aromatic core. Every other figure and all saved
scientific inputs are unchanged. The source discrepancy discussion remains
repository provenance, not a new manuscript appendix. The Prism README points
to that record.

The seven native browser capture states are specified in
`design-history/publications/sos1/interface-chemical-difference-2026-09-07/capture-plan.json`.
The replay imports the original frozen campaigns and performs display operations
only. Captures are archived in
`paper/review/captures/2026-09-07-chemical-difference-a23/`.
The common eight-atom scaffold alignment and strict sanitized depictions are
retained from a22; no screenshot is painted over to alter a molecular structure.

After native browser capture, compose and build from the repository root:

```sh
python3 paper/scripts/compose-sos1-interface-highlights.py --chemical-difference
python3 paper/review/build-chemical-difference-revision.py build
```

Compile `main.tex` in `paper/revisions/2026-09-07-chemical-difference-a23/` with
`tectonic --only-cached --untrusted --keep-logs main.tex`. Then, from the root:

```sh
node --test paper/review/chemical-change-map.test.mjs paper/review/chemical-difference.test.mjs
python3 paper/review/build-chemical-difference-revision.py package
```

The regression tests verify frozen input hashes, native screenshot highlights,
strict alignment and canonical molecular identity, the exact two-sentence text
diff, and preservation of all other figure assets. Render and inspect the final
PDF with Poppler before delivery. The outputs are
`output/pdf/molarium-author-approved-a23.pdf` and
`output/prism/molarium-prism-author-approved-a23.zip`.
