#!/bin/bash
set -euo pipefail
: "${MOLARIUM_BINDING_ROOT:?Task root required}"
layer=/workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261115-attempt001
trunk=/workspacenfs/rafal_wiewiora/molarium-trained-trunk-browser-20261115-attempt001
bun="$MOLARIUM_BROWSER_TOOLS_ROOT/tools/bun-linux-x64/bun"
export MOLARIUM_REQUIRE_NVIDIA=1
mkdir results/transition-logs results/trunk-logs
export MOLARIUM_PROBE_ROOT="$MOLARIUM_BINDING_ROOT/results/transition-logs"
set +e
"$bun" "$MOLARIUM_BINDING_ROOT/transition.browser.mjs" "$layer/fixtures/original" "$layer/fixtures/precision" "$MOLARIUM_BINDING_ROOT/results/transition.json" > results/transition.log 2>&1
transition=$?
export MOLARIUM_PROBE_ROOT="$MOLARIUM_BINDING_ROOT/results/trunk-logs"
"$bun" "$MOLARIUM_BINDING_ROOT/trunk.browser.mjs" "$trunk/results/fixture" "$MOLARIUM_BINDING_ROOT/results/trunk" > results/trunk.log 2>&1
trunk_code=$?
set -e
python3 - "$transition" "$trunk_code" <<'PY'
from pathlib import Path
import json,sys
Path('results/browser-exit-codes.json').write_text(json.dumps({'transition':int(sys.argv[1]),'trunk':int(sys.argv[2]),'scope':'Both independent controls attempted; all numerical outcomes retained; no native capture/conversion/complete pose run.'},indent=2)+'\n')
PY
