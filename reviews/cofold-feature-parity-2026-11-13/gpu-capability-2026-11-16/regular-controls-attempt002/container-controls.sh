#!/bin/bash
set -euo pipefail
: "${MOLARIUM_BINDING_ROOT:?Task root required}"
layer=/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261115-attempt001
trunk=/workspacenfs/rafal_wiewiora/molarium-trained-trunk-browser-20261115-attempt001
bun="$MOLARIUM_BROWSER_TOOLS_ROOT/tools/bun-linux-x64/bun"
export MOLARIUM_REQUIRE_NVIDIA=1
mkdir "$MOLARIUM_BINDING_ROOT/results/transition-logs" "$MOLARIUM_BINDING_ROOT/results/trunk-logs"
export MOLARIUM_PROBE_ROOT="$MOLARIUM_BINDING_ROOT/results/transition-logs"
set +e
"$bun" "$layer/scripts/cofold-transition-nvidia.browser.mjs" "$layer/fixtures/original" "$layer/fixtures/precision" "$MOLARIUM_BINDING_ROOT/results/transition.json" > "$MOLARIUM_BINDING_ROOT/results/transition.log" 2>&1
transition=$?
export MOLARIUM_PROBE_ROOT="$MOLARIUM_BINDING_ROOT/results/trunk-logs"
"$bun" "$trunk/browser-repo/scripts/cofold-trained-trunk.browser.mjs" "$trunk/results/fixture" "$MOLARIUM_BINDING_ROOT/results/trunk" > "$MOLARIUM_BINDING_ROOT/results/trunk.log" 2>&1
trunk_code=$?
set -e
python3 - "$transition" "$trunk_code" <<'PY'
from pathlib import Path
import json,sys
Path('results/browser-exit-codes.json').write_text(json.dumps({'transition':int(sys.argv[1]),'trunk':int(sys.argv[2]),'scope':'Independent controls both attempted after physical capability qualification; numerical failures retained, no automatic rerun.'},indent=2)+'\n')
PY
# A mathematical failure in one independent control must not discard the other.
exit 0
