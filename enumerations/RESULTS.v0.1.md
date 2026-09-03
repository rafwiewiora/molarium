# 7KPA high-disruption enumeration stress run v0.1

Date: 2026-08-23

Catalogue: `molarium-7kpa-high-disruption-enumerations` v0.1.0

Execution: local browser, public Chemist Actions only, eight search chains per product

Raw result SHA-256: `80047f9ac6c12a09f37103b7b0e44e6a79cb7033a032044ae95a26f68fdc0f75`

Exact commands:

```text
npm run run:7kpa-high-disruption -- --replays 2 --search-chains 8 --output /tmp/7kpa-high-disruption-v0.1-r2.json
npm run test:7kpa-high-disruption-results -- --input /tmp/7kpa-high-disruption-v0.1-r2.json --require-complete
```

Both replays of every transformation produced the same stable replay payload
hash. The three case hashes were `8d4524…c6d7`, `071080…9942`, and
`db753b…add0`; the combined case-payload hash was `57aedb…7ff4`.

| Transformation | Difficulty | Contact result | Absolute physical screen |
|---|---:|---|---|
| Pyrrolidone → N-linked pyrazole | 50.00, extreme | 2/8 feasible; all four selected contacts satisfied in the winner | pass: 0 clashes; raw receptor–ligand LJ −66.79 kcal/mol; relative ligand strain −2.38 kcal/mol |
| Pyrrolidone → tetrahydropyran | 78.13, extreme | 2/8 feasible; all four selected contacts satisfied in the winner | pass at the registered boundary: 2 clashes; raw LJ −37.35 kcal/mol; relative strain +3.83 kcal/mol; visual review still warranted |
| Phenyl–pyrrolidone → spiro[4.5] ketone | 33.04, high | 8/8 contact-feasible; all four selected contacts satisfied | **review required**: 11 clashes and raw LJ +1870.38 kcal/mol |

The spiro case is the important negative result. Its reference-subtracted
browser score is −3345.94 kcal/mol because the inherited fixed-core start is
even worse (+5200.75 kcal/mol interaction reference). That improvement does not
make the final pose physically acceptable. The absolute screen therefore keeps
contact feasibility and physical plausibility as separate judgments.

The difficulty number measures graph-lineage disruption, not three-dimensional
difficulty. The spiro product changes a larger coherent region but retains many
persistent atoms; its 33.04 score is therefore lower than the smaller-looking
tetrahydropyran edit. The complete global/local component breakdown is retained
with every result so the scalar cannot hide that distinction.

These three products are development hypotheses, not affinity predictions,
synthetic proposals, or a claim of bioisosteric equivalence.
