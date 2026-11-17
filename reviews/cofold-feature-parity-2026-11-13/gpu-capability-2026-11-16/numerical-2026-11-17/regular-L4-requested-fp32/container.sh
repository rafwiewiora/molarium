#!/bin/bash
set -euo pipefail
python3 "$MOLARIUM_BINDING_ROOT/vulkan_devices.py" vulkan-device-discovery.json
exec timeout 180s "$MOLARIUM_BROWSER_TOOLS_ROOT/tools/bun-linux-x64/bun" "$MOLARIUM_BINDING_ROOT/probe.mjs"
