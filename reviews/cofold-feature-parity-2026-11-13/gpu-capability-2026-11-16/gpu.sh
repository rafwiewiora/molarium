#!/bin/bash
set -euo pipefail
task_root=$(pwd -P)
test -n "${SLURM_JOB_ID:-}"
mkdir gpu-started
sha256sum -c source-sha256.txt
tools=/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261113-attempt002
image=/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261113-attempt005/runtime/browser.sif
printf '%s  %s\n' 8ddec45c00d959cece9f99024412dd06d9487cfd2bdedb719ed32e4721d84a1c "$image" | sha256sum -c -
printf '%s  %s\n' c5305259e6529e29d7cf65029b52cd28a051e492a51391d14333c3956013f651 /workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261115-attempt001/chrome-wrapper.sh | sha256sum -c -
nvidia-smi --query-gpu=name,uuid,driver_version --format=csv > gpu-identity.txt
grep -q 'NVIDIA L4' gpu-identity.txt
scontrol show job "$SLURM_JOB_ID" > slurm-grant.txt
for candidate in /etc/vulkan/icd.d/nvidia_icd.json /usr/share/vulkan/icd.d/nvidia_icd.json; do
  if test -f "$candidate"; then cp "$candidate" nvidia-icd.json; break; fi
done
test -f nvidia-icd.json
unset MOLARIUM_HEADLESS_SOFTWARE_WEBGPU SINGULARITYENV_MOLARIUM_HEADLESS_SOFTWARE_WEBGPU
export SINGULARITYENV_MOLARIUM_BROWSER_TOOLS_ROOT="$tools"
export SINGULARITYENV_CHROME_PATH="$task_root/chrome-logging-wrapper.sh"
export SINGULARITYENV_MOLARIUM_PROBE_ROOT="$task_root"
export SINGULARITYENV_VK_ICD_FILENAMES="$task_root/nvidia-icd.json"
export SINGULARITYENV_VK_LOADER_DEBUG=error,warn
chmod 755 chrome-logging-wrapper.sh
# Diagnostics run inside the same pinned image/--nv binding as the failed controls.
srun --ntasks=1 singularity exec --nv --bind "$task_root:$task_root" --bind "$tools:$tools:ro" --bind /workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261115-attempt001:/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261115-attempt001:ro --pwd "$task_root" "$image" bash -c '
  ldconfig -p > container-libraries.txt
  ldd "$MOLARIUM_BROWSER_TOOLS_ROOT/tools/chrome-linux64/chrome" > chrome-ldd.txt
  for library in libGLX_nvidia.so.0 libnvidia-glvkspirv.so.550.90.07 libvulkan.so.1; do
    path=$(ldconfig -p | awk -v lib="$library" '\''$1==lib {print $NF;exit}'\'')
    if test -n "$path"; then printf "%s\n" "$path"; ldd "$path"; else printf "NOT FOUND: %s\n" "$library"; fi
  done > vulkan-ldd.txt
  ls -l /dev/nvidia* /dev/dri/* > device-files.txt 2>&1 || true
  exec timeout 180s "$MOLARIUM_BROWSER_TOOLS_ROOT/tools/bun-linux-x64/bun" probe.mjs
'
