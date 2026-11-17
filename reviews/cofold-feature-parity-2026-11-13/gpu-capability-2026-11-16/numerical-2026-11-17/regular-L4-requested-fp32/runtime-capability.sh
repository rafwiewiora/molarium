#!/bin/bash
set -euo pipefail
task_root=$(pwd -P)
test -n "${SLURM_JOB_ID:-}"
mkdir gpu-started
sha256sum -c source-sha256.txt
tools=/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261113-attempt002
old=/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261115-attempt001
image=/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261113-attempt005/runtime/browser.sif
printf '%s  %s\n' 8ddec45c00d959cece9f99024412dd06d9487cfd2bdedb719ed32e4721d84a1c "$image" | sha256sum -c -
printf '%s  %s\n' c5305259e6529e29d7cf65029b52cd28a051e492a51391d14333c3956013f651 "$old/chrome-wrapper.sh" | sha256sum -c -
nvidia-smi --query-gpu=name,uuid,driver_version --format=csv > gpu-identity.txt
grep -q 'NVIDIA L4' gpu-identity.txt
scontrol show job "$SLURM_JOB_ID" > slurm-grant.txt
singularity --version > singularity-version.txt
python3 collect_driver_libraries.py
# Use only the EGL ICD: the consumed GLX test already showed a missing entry point.
python3 - "$task_root" <<'PY'
from pathlib import Path
import json,sys
root=Path(sys.argv[1]);rows=json.loads((root/'driver-library-bindings.json').read_text())['libraries']
row=next(r for r in rows if r['soname']=='libEGL_nvidia.so.0')
for n,p in [('host-egl-icd.json',row['source']),('container-egl-icd.json',row['target'])]:
 (root/n).write_text(json.dumps({'file_format_version':'1.0.0','ICD':{'library_path':p,'api_version':'1.3.0'}},indent=2)+'\n')
PY
VK_ICD_FILENAMES="$task_root/host-egl-icd.json" python3 vulkan_devices.py host-vulkan-device-discovery.json > host-vulkan.log 2>&1
mapfile -t extra_binds < driver-bind-arguments.txt
args=(--nv --bind "$task_root:$task_root" --bind "$tools:$tools:ro" --bind "$old:$old:ro")
for binding in "${extra_binds[@]}"; do args+=(--bind "$binding"); done
unset MOLARIUM_HEADLESS_SOFTWARE_WEBGPU SINGULARITYENV_MOLARIUM_HEADLESS_SOFTWARE_WEBGPU
export SINGULARITYENV_MOLARIUM_BROWSER_TOOLS_ROOT="$tools"
export SINGULARITYENV_MOLARIUM_BINDING_ROOT="$task_root"
export SINGULARITYENV_CHROME_PATH="$task_root/chrome-wrapper.sh"
export SINGULARITYENV_LD_LIBRARY_PATH="$task_root/graphics-libs:/.singularity.d/libs"
export SINGULARITYENV_VK_ICD_FILENAMES="$task_root/container-egl-icd.json"
export SINGULARITYENV_VK_LOADER_DEBUG=error,warn
chmod 755 chrome-wrapper.sh
success=0
for phase in original enable-gpu; do
 mkdir "$phase"
 export SINGULARITYENV_MOLARIUM_PROBE_ROOT="$task_root/$phase"
 export SINGULARITYENV_MOLARIUM_PROBE_PHASE="$phase"
 set +e
 srun --ntasks=1 singularity exec "${args[@]}" --pwd "$task_root/$phase" "$image" bash "$task_root/container.sh" > "$phase/task.log" 2>&1
 code=$?
 set -e
 printf '%s\n' "$code" > "$phase/exit-code.txt"
 if test "$code" -eq 0; then success=1; break; fi
done
python3 - "$success" <<'PY'
from pathlib import Path
import json,sys
r={'schema':'molarium.nvidia-device-discovery.v1','success':sys.argv[1]=='1','modelCalls':0,'controlsRun':0,
 'scope':'Host/container Vulkan instance/device discovery and correct browser-target SystemInfo. EGL ICD only; same pinned Chrome/runtime/helper and physical-NVIDIA integer7 gate. Second phase adds only Chromium documented enable-gpu flag. No scientific code changes or model calls.', 'phases':[]}
for phase in ['original','enable-gpu']:
 p=Path(phase)
 if p.exists():r['phases'].append({'phase':phase,'exitCode':int((p/'exit-code.txt').read_text()),'result':json.loads((p/'probe-result.json').read_text())if(p/'probe-result.json').exists()else None})
Path('result.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
PY
test "$success" -eq 1
