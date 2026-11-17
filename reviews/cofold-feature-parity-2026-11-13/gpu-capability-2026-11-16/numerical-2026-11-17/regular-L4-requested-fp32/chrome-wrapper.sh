#!/bin/bash
set -euo pipefail
: "${MOLARIUM_PROBE_ROOT:?Probe directory required}"
: "${MOLARIUM_PROBE_PHASE:?Probe phase required}"
extra=()
if test "$MOLARIUM_PROBE_PHASE" = enable-gpu; then extra+=(--enable-gpu); fi
# The original pinned wrapper and its GPU flags remain unchanged.
exec /workspacenfs/rafal_wiewiora/molarium-nvidia-layer-20261115-attempt001/chrome-wrapper.sh --enable-logging=stderr --v=1 "${extra[@]}" "$@" 2>>"$MOLARIUM_PROBE_ROOT/chrome-stderr.log"
