# 7KPA D84 two-terminus analogue panel

This preregistered development panel stress-tests Molarium graph editing, pharmacophore remapping,
and reference-guided pose refinement at the pyridone and pyrrolidone ends of D84. It is a method
validation panel, not an affinity calculation.

`7kpa-two-terminus-panel.v0.1.json` fixes 20 chemist-visible edit scripts before pose generation:
nine pyridone cases, eight pyrrolidone cases, and three dual-end cases. Every mutation is expressed
as an atom-name-resolved public Chemist Action. Multi-step transformations retain their explicit
`Finish` boundaries. Every case preregisters the expected final heavy-atom graph, bond orders,
formal charges, and attached-hydrogen counts as a SHA-256 contract. Chemistry validity and canonical
SMILES are still determined by the browser's RDKit sanitization; the manifest does not assume that
every proposed product will pass.

Validate the immutable inputs and harness:

```sh
npm run test:7kpa-analogue-panel
```

Run a small local smoke test:

```sh
npm run run:7kpa-analogue-panel -- \
  --case pyridone-to-cyclohexanone \
  --replays 2 \
  --output /tmp/7kpa-cyclohexanone.json
npm run test:7kpa-analogue-results -- --input /tmp/7kpa-cyclohexanone.json
```

Run a locus as an independent shard:

```sh
npm run run:7kpa-analogue-panel -- \
  --locus pyrrolidone \
  --output /tmp/7kpa-pyrrolidone.json
```

Run the complete preregistered development panel by omitting `--case` and `--locus`. Parallel
shards must use distinct `--port`, `--debug-port`, and `--output` values. The runner uses pinned
local PDB/CCD fixtures and a local-only Molarium server. No external service is required.

To retain every generated pose for independent native-engine validation, add
`--candidate-export-output /tmp/7kpa-pose-exports.json`. Candidate coordinates still come from
public `pose.apply` and `session.inspect` actions. A test-only, read-only attachment adds the exact
numeric Sage System used by the browser run; it exposes no alternate mutation or scoring route.

Each replay records:

- every public action and its result;
- each committed RDKit canonical SMILES and chemistry audit;
- prepared-reference, expected-product, and observed-product graph hashes;
- captured-contact availability and remapping policy;
- pose feasibility and every required H-bond geometry;
- relative Sage ligand strain, Lennard-Jones energy, and clash counts;
- runtime and selected coordinates;
- the verified docking-labbook hash chain; and
- a deterministic replay hash that excludes timestamps, runtimes, run IDs, and the necessarily
  run-specific completed-labbook hash.

A result cannot be reported as a pose success when its observed product graph differs from the
preregistered product identity. Result validation also recomputes every replay hash and verifies
that all mutations passed through the public Chemist Actions boundary.
