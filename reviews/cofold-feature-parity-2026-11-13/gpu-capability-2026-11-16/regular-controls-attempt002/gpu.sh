#!/bin/bash
set -euo pipefail
task_root=$(pwd -P)
test -n "${SLURM_JOB_ID:-}"
sha256sum -c source-sha256.txt
python3 verify_sources.py
# Same pinned capability recipe, newly verified on this job's own real GPU.
bash runtime-capability.sh > capability.log 2>&1
mkdir model-controls-started results
tools=/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261113-attempt002
layer=/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261115-attempt001
trunk=/workspacenfs/rafal_wiewiora/molarium-trained-trunk-browser-20261115-attempt001
image=/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261113-attempt005/runtime/browser.sif
phase=$(python3 -c 'import json; d=json.load(open("binding-result.json")); assert d["success"]; print(next(r["phase"] for r in d["records"] if r["exitCode"]==0 and r["result"]["status"]=="complete"))')
mapfile -t extra_binds < driver-bind-arguments.txt
args=(--nv --bind "$task_root:$task_root" --bind "$tools:$tools:ro" --bind "$layer:$layer:ro" --bind "$trunk:$trunk:ro")
for binding in "${extra_binds[@]}"; do args+=(--bind "$binding"); done
unset MOLARIUM_HEADLESS_SOFTWARE_WEBGPU SINGULARITYENV_MOLARIUM_HEADLESS_SOFTWARE_WEBGPU
export SINGULARITYENV_MOLARIUM_BROWSER_TOOLS_ROOT="$tools"
export SINGULARITYENV_MOLARIUM_BINDING_ROOT="$task_root"
export SINGULARITYENV_CHROME_PATH="$task_root/chrome-logging-wrapper.sh"
export SINGULARITYENV_LD_LIBRARY_PATH="$task_root/graphics-libs:/.singularity.d/libs"
export SINGULARITYENV_VK_ICD_FILENAMES="$task_root/$phase/nvidia-icd.json"
export SINGULARITYENV_MOLARIUM_REQUIRE_NVIDIA=1
export SINGULARITYENV_VK_LOADER_DEBUG=error,warn
srun --ntasks=1 singularity exec "${args[@]}" --pwd "$task_root" "$image" bash "$task_root/container-controls.sh"
export OPENBLAS_NUM_THREADS=1
export LD_LIBRARY_PATH="$HOME/miniforge3/envs/openfold3/lib:${LD_LIBRARY_PATH:-}"
python="$HOME/nfs/molarium-native-cofold-20261112-attempt002/environments/openbind0/bin/python"
set +e
"$python" "$trunk/browser-repo/folding/comparison/check_trained_trunk.py" --fixture "$trunk/results/fixture" --measured "$task_root/results/trunk" --output "$task_root/results/trunk-analysis.json" > results/trunk-analysis.log 2>&1
analysis=$?
set -e
python3 - "$analysis" <<'PY'
from pathlib import Path
import json,sys
root=Path.cwd(); codes=json.loads((root/'results/browser-exit-codes.json').read_bytes());codes['trunkOfflineAnalysis']=int(sys.argv[1])
codes['scope']='Fixed-input transition precision and all32trained-trunkseams across4cycles only. No native capture/conversion or complete pose prediction repeated.'
(root/'results/result.json').write_text(json.dumps(codes,indent=2)+'\n');print(json.dumps(codes))
if any(codes[k]!=0 for k in ['transition','trunk','trunkOfflineAnalysis']):raise SystemExit(1)
PY
