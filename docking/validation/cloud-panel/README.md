# Independent analogue-panel validation

This directory is the compute boundary for large Molarium analogue panels.  The browser exports
complete, hashable pose packets; the programs here consume those packets without importing Molarium
application code.  This separation is intentional: an independent engine must not silently share a
scoring implementation with the method under test.

## What is measured

For every pose the runner can report:

- RDKit sanitization, MMFF94 bound-geometry energy, isolated relaxation energy and heavy-atom RMSD;
- exact numeric-System energies and forces from native OpenMM Reference and CUDA; and
- ANI-2x bound-geometry energy, isolated relaxation energy and heavy-atom RMSD.

Only energy differences for the **same molecular graph** are interpreted.  Total MMFF or ANI
energies must not be compared across analogues with different compositions.  ANI-2x is a
ligand-strain check, not a protein-ligand binding score.  OpenMM parity uses the numeric Sage System
exported by the browser so charge assignment and parameterization are held constant.

The input schema is `molarium.analogue-pose-panel/v1`:

```json
{
  "schema": "molarium.analogue-pose-panel/v1",
  "protocol": { "id": "descriptive protocol id" },
  "poses": [
    {
      "id": "unique-pose-id",
      "caseId": "unique-analogue-id",
      "molecule": {
        "atoms": [{ "element": "C", "x": 0, "y": 0, "z": 0 }],
        "bonds": [],
        "parameterization": { "system": {} }
      },
      "requiredContacts": []
    }
  ]
}
```

Do not hand-build the integer atom map.  Capture `session.inspect` through the public Chemist
Actions API with `scope: "ligand"`, `includeCoordinates: true`, and an untruncated atom limit.  A
read-only test exporter may attach the exact ligand numeric System used by refinement, but it may not
mutate the molecule or call a hidden scoring route.  Convert that batch with:

```sh
node docking/validation/cloud-panel/build_pose_packet.mjs raw-exports.json panel.json
```

The converter resolves stable atom-ID bonds and reorders the public coordinates exactly once into
the numeric System's declared atom order. It requires an identical, unique atom-ID set and records
both the public-inspection and numeric-System order hashes plus topology, coordinate and System
hashes. Required H-bond participant identities, pose-specific coordinates, satisfaction, and
geometry are copied from the same public inspection for read-only review; no validation tool
rediscovers them heuristically. The Python oracle recomputes every hash before calculation. Unknown System force classes or
term fields fail closed rather than being silently omitted.

Atom coordinates are Å.  The optional numeric System has the exact field names written by
`openff/sage-parameterizer.js`; its lengths are nm and energies are kJ/mol.

## Local smoke test

```sh
python docking/validation/cloud-panel/test_runner.py
```

## PsiBlue execution

PsiBlue is an autoscaled GCP SLURM cluster.  An `idle~` node is powered down; submitting an array may
start billable VMs.  Prepare the shared environment once, after approval:

```sh
conda env create -p "$HOME/.conda/envs/molarium-panel-v1" \
  -f docking/validation/cloud-panel/environment.yml
```

Run the cheap RDKit and OpenMM Reference controls on CPU first:

```sh
pose_count=$(python -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["poses"]))' panel.json)
shards=$(( pose_count < 25 ? pose_count : 25 ))
sbatch --partition=compute --array="0-$((shards - 1))%8" \
  --export=ALL,PANEL_MANIFEST="$PWD/panel.json",OUTPUT_DIR="$PWD/results/cpu",\
ENV_PREFIX="$HOME/.conda/envs/molarium-panel-v1",SHARD_COUNT="$shards",PANEL_MODE=cpu \
  docking/validation/cloud-panel/slurm-array.sbatch
```

Then run only the shortlisted poses through GPU ANI-2x and OpenMM CUDA:

```sh
node docking/validation/cloud-panel/build_shortlist.mjs panel.json shortlist.json
```

The deterministic shortlist removes exact coordinate duplicates across replays. It retains every
unique browser-feasible pose; when a case has no feasible pose, it retains the lowest browser-score
infeasible pose as a negative control.

```sh
sbatch --partition=gpu --gres=gpu:1 --array="0-$((shards - 1))%1" \
  --export=ALL,PANEL_MANIFEST="$PWD/shortlist.json",OUTPUT_DIR="$PWD/results/gpu",\
ENV_PREFIX="$HOME/.conda/envs/molarium-panel-v1",SHARD_COUNT="$shards",PANEL_MODE=gpu \
  docking/validation/cloud-panel/slurm-array.sbatch
```

Each shard writes one JSON file using an atomic rename.  Inputs, protocol metadata, engine versions,
platform names, device names, timestamps and SHA-256 hashes are retained in every result.
The `%1` GPU limit is the calibration default: this cluster provisions standard (not Spot)
`g2-standard-4` L4 VMs.  Raise the concurrency only after one shard establishes measured wall time
and the resulting maximum spend has been approved.
