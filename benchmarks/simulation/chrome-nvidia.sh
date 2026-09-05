#!/usr/bin/env bash
set -euo pipefail
# Equivalent launch flags to the measured L4 run. No driver installation or
# system configuration changes; the benchmark still rejects software adapters.
export VK_ICD_FILENAMES="${MOLARIUM_NVIDIA_ICD:-/usr/share/vulkan/icd.d/nvidia_icd.json}"
test -r "$VK_ICD_FILENAMES"
export __NV_PRIME_RENDER_OFFLOAD=1
export __GLX_VENDOR_LIBRARY_NAME=nvidia
exec "${MOLARIUM_CHROME_BINARY:-/usr/bin/google-chrome}" \
  --enable-gpu \
  --enable-unsafe-webgpu \
  --enable-features=Vulkan,UseSkiaRenderer \
  --use-angle=vulkan \
  --disable-vulkan-surface \
  --ignore-gpu-blocklist \
  --disable-software-rasterizer \
  "$@"
