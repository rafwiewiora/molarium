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
for candidate in /etc/vulkan/icd.d/nvidia_icd.json /usr/share/vulkan/icd.d/nvidia_icd.json; do
  if test -f "$candidate"; then cp "$candidate" host-nvidia-icd.json; break; fi
done
test -f host-nvidia-icd.json
python3 collect_driver_libraries.py
mapfile -t extra_binds < driver-bind-arguments.txt
args=(--nv --bind "$task_root:$task_root" --bind "$tools:$tools:ro" --bind "$old:$old:ro")
for binding in "${extra_binds[@]}"; do args+=(--bind "$binding"); done
unset MOLARIUM_HEADLESS_SOFTWARE_WEBGPU SINGULARITYENV_MOLARIUM_HEADLESS_SOFTWARE_WEBGPU
export SINGULARITYENV_MOLARIUM_BROWSER_TOOLS_ROOT="$tools"
export SINGULARITYENV_MOLARIUM_BINDING_ROOT="$task_root"
export SINGULARITYENV_CHROME_PATH="$task_root/chrome-logging-wrapper.sh"
export SINGULARITYENV_LD_LIBRARY_PATH="$task_root/graphics-libs:/.singularity.d/libs"
export SINGULARITYENV_VK_LOADER_DEBUG=error,warn
chmod 755 chrome-logging-wrapper.sh
success=0
for name in libGLX_nvidia.so.0 libEGL_nvidia.so.0; do
  if ! test -e "$task_root/graphics-libs/$name"; then continue; fi
  if test "$name" = libGLX_nvidia.so.0; then phase=explicit-bind-glx; else phase=explicit-bind-egl; fi
  mkdir "$phase"
  python3 - "$task_root" "$phase" "$name" <<'PY'
from pathlib import Path
import json,sys
root=Path(sys.argv[1]); data=json.loads((root/'host-nvidia-icd.json').read_bytes())
data['ICD']['library_path']=str(root/'graphics-libs'/sys.argv[3])
(root/sys.argv[2]/'nvidia-icd.json').write_text(json.dumps(data,indent=2)+'\n')
PY
  export SINGULARITYENV_VK_ICD_FILENAMES="$task_root/$phase/nvidia-icd.json"
  export SINGULARITYENV_MOLARIUM_PROBE_ROOT="$task_root/$phase"
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
root=Path.cwd(); records=[]
for phase in ['explicit-bind-glx','explicit-bind-egl']:
 p=root/phase
 if p.exists():records.append({'phase':phase,'exitCode':int((p/'exit-code.txt').read_text()),'result':json.loads((p/'probe-result.json').read_text())if(p/'probe-result.json').exists()else None})
r={'schema':'molarium.nvidia-driver-binding-probe.v1','success':sys.argv[1]=='1','scope':'Container-local bindings of existing NVIDIA driver libraries and GLX/EGL ICD entrypoints only. Zero model calls. Original SIF, Chrome flags and helper unchanged; physical NVIDIA adapter/integer-readback gates unchanged.','records':records}
(root/'binding-result.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
PY
test "$success" -eq 1
