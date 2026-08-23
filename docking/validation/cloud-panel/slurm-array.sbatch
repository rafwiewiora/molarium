#!/usr/bin/env bash
#SBATCH --job-name=molarium-panel
#SBATCH --cpus-per-task=4
#SBATCH --mem=14G
#SBATCH --time=02:00:00
#SBATCH --output=molarium-panel-%A_%a.out
#SBATCH --error=molarium-panel-%A_%a.err

set -euo pipefail

: "${PANEL_MANIFEST:?Set PANEL_MANIFEST to an absolute panel JSON path}"
: "${OUTPUT_DIR:?Set OUTPUT_DIR to an absolute output directory}"
: "${ENV_PREFIX:?Set ENV_PREFIX to the prepared conda environment}"
: "${VALIDATOR_SCRIPT:?Set VALIDATOR_SCRIPT to run_independent_validation.py}"
: "${SHARD_COUNT:?Set SHARD_COUNT to the submitted array size}"
: "${SLURM_ARRAY_TASK_ID:?Submit this script as a SLURM array}"

mode="${PANEL_MODE:-cpu}"
mkdir -p "$OUTPUT_DIR"

arguments=(
  --input "$PANEL_MANIFEST"
  --output "$OUTPUT_DIR/shard-$(printf '%05d' "$SLURM_ARRAY_TASK_ID").json"
  --shard-index "$SLURM_ARRAY_TASK_ID"
  --shard-count "$SHARD_COUNT"
  --mmff94
  --openmm-platform Reference
)

if [[ "$mode" == "gpu" ]]; then
  arguments+=(--ani2x --ani-device cuda --openmm-platform CUDA --require-engines)
elif [[ "$mode" != "cpu" ]]; then
  echo "Unknown PANEL_MODE: $mode" >&2
  exit 2
fi

"$ENV_PREFIX/bin/python" "$VALIDATOR_SCRIPT" "${arguments[@]}"
