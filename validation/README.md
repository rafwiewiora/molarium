# Validation registry

The public **Validation** panel presents only numerical implementation checks.
Its explicit subset includes fixed-input energy/force comparisons and links to
the broader independent-native simulation benchmarks. It excludes docking pose
accuracy, crystal-scored counts, chemistry feasibility and case-outcome tables.
This presentation change does not alter the frozen registries or their evidence.
Numerical agreement is not validation of a force field against experiment.

`registry.v0.2.json` is Molarium's current machine-readable evidence ledger. Version 0.1 remains
available as the earlier frozen record. The ledger deliberately separates:

- biological targets;
- unique PDB/ligand starting complexes;
- preregistered transformations;
- exact coordinate/graph pose instances; and
- automated software assertions.

These denominators are not interchangeable. In particular, multiple poses or chemistry edits from
one protein complex are never presented as independent systems.

The registry is generated from immutable benchmark manifests, result reports and cross-runtime
parity records. Each source artifact is retained with its byte count and SHA-256 digest. Rebuild and
validate it with:

```bash
npm run build:validation-registry
npm run test:validation-registry
```

Do not rewrite a published registry version when evidence changes. Add the new source artifact,
update the builder, and issue the next registry version so papers can cite the exact ledger used for
their claims. A failed or blocked registered case remains in the ledger.
