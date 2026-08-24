# Independent analogue-panel validation

This directory is the compute boundary for large Molarium analogue panels.  The browser exports
complete, hashable pose packets; the programs here consume those packets without importing Molarium
application code.  This separation is intentional: an independent engine must not silently share a
scoring implementation with the method under test.

## What is measured

For every pose the runner can report:

- RDKit sanitization, MMFF94 bound-geometry energy, isolated relaxation energy and heavy-atom RMSD;
- exact numeric-System energies and forces from browser OpenMM/WASM, browser Sage WebGPU,
  native OpenMM Reference, and native OpenMM CUDA; and
- browser and native ANI-2x bound-geometry energies and forces, plus native isolated relaxation
  energy and heavy-atom RMSD.

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
read-only test exporter may attach the exact ligand numeric System used by refinement and invoke the
same production single-point workers on an atom-ID-ordered ligand copy. It may not mutate the live
molecule, parameterize a replacement System, or bypass the production worker boundary. Convert that
batch with:

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

Atom coordinates are Å. The optional numeric System has the exact field names written by
`openff/sage-parameterizer.js`; its lengths are nm and energies are kJ/mol. Browser Sage and OpenMM
force arrays are explicitly labelled kJ/mol/nm; ANI-2x force arrays are kcal/mol/Å.

## OpenMM WASM rebuild gate

`score_openmm_wasm.mjs` evaluates an integrity-checked pose packet with a
selected OpenMM WebAssembly build. `validate_openmm_wasm.py` evaluates the same
packet through the identical C bridge linked to a native OpenMM build and
applies the fixed energy/force parity thresholds used elsewhere in this lane.
The sanitized five-pose result for the pinned OpenMM 8.2.0 rebuild is archived
in `openmm-wasm-native-validation-2026-08-23.json`; it contains hashes and
metrics but no coordinates, host names, or proprietary inputs. A separate real-Chrome run is
archived in `browser-sage-openmm-validation-2026-08-23.json`. It fixes the runtime configuration to
vacuum, no constraints and no cutoff, and records the WASM, numeric-System, coordinate and packet
hashes needed to bind the browser comparison to the native report.

## Local smoke test

```sh
python docking/validation/cloud-panel/test_runner.py
```

## GCP Slurm execution

The validation lane supports an autoscaled GCP Slurm cluster. An `idle~` node is powered down; submitting an array may
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
ENV_PREFIX="$HOME/.conda/envs/molarium-panel-v1",SHARD_COUNT="$shards",PANEL_MODE=cpu,\
VALIDATOR_SCRIPT="$PWD/docking/validation/cloud-panel/run_independent_validation.py" \
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
sbatch --partition=gpu --gres=gpu:1 --array="0-0%1" \
  --export=ALL,PANEL_MANIFEST="$PWD/shortlist.json",OUTPUT_DIR="$PWD/results/gpu",\
ENV_PREFIX="$HOME/.conda/envs/molarium-panel-v1",SHARD_COUNT=1,PANEL_MODE=gpu,\
VALIDATOR_SCRIPT="$PWD/docking/validation/cloud-panel/run_independent_validation.py" \
  docking/validation/cloud-panel/slurm-array.sbatch
```

Each shard writes one JSON file using an atomic rename.  Inputs, protocol metadata, engine versions,
platform names, device names, timestamps and SHA-256 hashes are retained in every result.
The `%1` GPU limit is the calibration default: this cluster provisions standard (not Spot)
`g2-standard-4` L4 VMs.  Raise the concurrency only after one shard establishes measured wall time
and the resulting maximum spend has been approved.
