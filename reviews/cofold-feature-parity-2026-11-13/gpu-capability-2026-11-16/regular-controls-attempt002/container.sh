#!/bin/bash
set -euo pipefail
: "${MOLARIUM_BINDING_ROOT:?Task root required}"
python3 "$MOLARIUM_BINDING_ROOT/inspect_vulkan.py" "$VK_ICD_FILENAMES"
ldd "$(python3 -c 'import json,os; print(json.load(open(os.environ["VK_ICD_FILENAMES"]))["ICD"]["library_path"])')" > icd-ldd.txt
exec timeout 180s "$MOLARIUM_BROWSER_TOOLS_ROOT/tools/bun-linux-x64/bun" "$MOLARIUM_BINDING_ROOT/probe.mjs"
