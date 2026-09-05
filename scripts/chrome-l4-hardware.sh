#!/usr/bin/env bash
set -euo pipefail

export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/nvidia_icd.json
export __NV_PRIME_RENDER_OFFLOAD=1
export __GLX_VENDOR_LIBRARY_NAME=nvidia

exec /usr/bin/google-chrome \
  --enable-gpu \
  --enable-unsafe-webgpu \
  --enable-features=Vulkan,UseSkiaRenderer \
  --use-angle=vulkan \
  --disable-vulkan-surface \
  --ignore-gpu-blocklist \
  --disable-software-rasterizer \
  "$@"
