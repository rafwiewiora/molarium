#!/bin/bash
set -euo pipefail
: "${MOLARIUM_BINDING_ROOT:?Task root required}"
trunk=/workspacenfs/rafal_wiewiora/molarium-trained-trunk-browser-20261115-attempt001
bun="$MOLARIUM_BROWSER_TOOLS_ROOT/tools/bun-linux-x64/bun"
export MOLARIUM_REQUIRE_NVIDIA=1
"$bun" "$MOLARIUM_BINDING_ROOT/container-fixture-preflight.mjs" "$MOLARIUM_BINDING_ROOT/fixture-mount-plan.json" "$MOLARIUM_BINDING_ROOT/results/container-fixture-preflight.json"
mkdir results/trunk-logs
export MOLARIUM_PROBE_ROOT="$MOLARIUM_BINDING_ROOT/results/trunk-logs"
set +e
"$bun" "$MOLARIUM_BINDING_ROOT/trunk.browser.mjs" "$trunk/results/fixture" "$MOLARIUM_BINDING_ROOT/results/trunk" > results/trunk.log 2>&1
trunk_code=$?
set -e
python3 - "$trunk_code" <<'PYRESULT'
from pathlib import Path
import json,sys
Path('results/browser-exit-codes.json').write_text(json.dumps({'trunk':int(sys.argv[1]),'transitionConfigurationsExecuted':0,'plannedCycles':4,'plannedBoundaries':32,'scope':'Strict-FP32 pair precision and observed shader gate; no native capture/conversion or complete pose run.'},indent=2)+'\n')
PYRESULT
