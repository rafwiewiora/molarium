#!/bin/bash
set -euo pipefail
task_root=$(pwd -P)
sha256sum -c source-sha256.txt
python3 verify_sources.py
bash runtime-capability.sh > capability.log 2>&1
phase=$(python3 -c 'import json; r=json.load(open("result.json")); assert r["success"]; print(next(p["phase"] for p in r["phases"] if p["exitCode"]==0 and p["result"]["webgpu"]["integerProbe"]==7))')
mkdir model-controls-started results
tools=/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261113-attempt002
layer=/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261115-attempt001
trunk=/workspacenfs/rafal_wiewiora/molarium-trained-trunk-browser-20261115-attempt001
image=/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261113-attempt005/runtime/browser.sif
mapfile -t extra_binds < driver-bind-arguments.txt
args=(--nv --bind "$task_root:$task_root" --bind "$tools:$tools:ro" --bind "$layer:$layer:ro" --bind "$trunk:$trunk:ro")
while IFS= read -r fixture_binding; do args+=(--bind "$fixture_binding:$fixture_binding:ro"); done < <(python3 -c 'import json; print("\n".join(json.load(open("fixture-mount-plan.json"))["extraReadOnlyBinds"]))')
for binding in "${extra_binds[@]}"; do args+=(--bind "$binding"); done
unset MOLARIUM_HEADLESS_SOFTWARE_WEBGPU SINGULARITYENV_MOLARIUM_HEADLESS_SOFTWARE_WEBGPU
export SINGULARITYENV_MOLARIUM_BROWSER_TOOLS_ROOT="$tools"
export SINGULARITYENV_MOLARIUM_BINDING_ROOT="$task_root"
export SINGULARITYENV_CHROME_PATH="$task_root/chrome-wrapper.sh"
export SINGULARITYENV_LD_LIBRARY_PATH="$task_root/graphics-libs:/.singularity.d/libs"
export SINGULARITYENV_VK_ICD_FILENAMES="$task_root/container-egl-icd.json"
export SINGULARITYENV_MOLARIUM_PROBE_PHASE="$phase"
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
r=json.loads(Path('results/browser-exit-codes.json').read_bytes());r['trunkOfflineAnalysis']=int(sys.argv[1]);r['newNativeCalls']=0
Path('results/result.json').write_text(json.dumps(r,indent=2)+'\n')
if any(r[k]!=0 for k in ['transition','trunk','trunkOfflineAnalysis']):raise SystemExit(1)
PY
