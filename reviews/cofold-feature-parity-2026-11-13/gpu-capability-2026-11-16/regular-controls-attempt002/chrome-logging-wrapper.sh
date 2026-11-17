#!/bin/bash
set -euo pipefail
: "${MOLARIUM_PROBE_ROOT:?Probe directory required}"
exec /workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261115-attempt001/chrome-wrapper.sh --enable-logging=stderr "$@" 2>>"$MOLARIUM_PROBE_ROOT/chrome-stderr.log"
