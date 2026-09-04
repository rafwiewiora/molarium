#!/usr/bin/env bash
set -euo pipefail

[[ "$#" -ge 4 && "$#" -le 5 ]] || {
  echo "usage: $0 GIT_COMMIT ATTEMPT_ID RUN_RELATIVE SOURCE_ARCHIVE_SHA256 [checkpoint-review|executable]" >&2
  exit 64
}

GIT_COMMIT="$1"
ATTEMPT_ID="$2"
RUN_RELATIVE="$3"
SOURCE_ARCHIVE_SHA256="$4"
REPLAY_KIND="${5:-checkpoint-review}"
ATTEMPT="/home/bb/molarium-renders/$ATTEMPT_ID"
SOURCE="$ATTEMPT/source"
SOURCE_ARCHIVE="$ATTEMPT/source.tar.gz"
OUTPUT="$ATTEMPT/interface-$REPLAY_KIND"
BUN=/home/bb/molarium-runtimes/bun-1.3.14/bun-linux-x64/bun
CHROME_WRAPPER="$SOURCE/scripts/chrome-l4-hardware.sh"
DECLARATION="$SOURCE/design-history/publications/sos1/browser-replay-declaration.json"

[[ "$GIT_COMMIT" =~ ^[a-f0-9]{40}$ ]] || exit 64
[[ "$SOURCE_ARCHIVE_SHA256" =~ ^[a-f0-9]{64}$ ]] || exit 64
[[ "$ATTEMPT_ID" =~ ^[a-z0-9][a-z0-9._-]+$ ]] || exit 64
[[ "$RUN_RELATIVE" != /* && "$RUN_RELATIVE" != *..* ]] || exit 64
[[ "$REPLAY_KIND" == checkpoint-review || "$REPLAY_KIND" == executable ]] || exit 64
[[ -d "$SOURCE" && -f "$DECLARATION" && -f "$SOURCE_ARCHIVE" ]] || exit 66
[[ ! -e "$ATTEMPT/STARTED" && ! -e "$OUTPUT" ]] || exit 73
[[ -x "$BUN" && -x "$CHROME_WRAPPER" ]] || exit 69
for executable in /usr/bin/google-chrome ffmpeg ffprobe git gzip jq nvidia-smi; do
  command -v "$executable" >/dev/null || { echo "Missing $executable" >&2; exit 69; }
done
[[ "$(sha256sum "$SOURCE_ARCHIVE" | cut -d' ' -f1)" == "$SOURCE_ARCHIVE_SHA256" ]] || {
  echo 'Source archive SHA-256 does not match the submitted provenance' >&2
  exit 65
}
[[ "$(gzip -dc "$SOURCE_ARCHIVE" | git get-tar-commit-id)" == "$GIT_COMMIT" ]] || {
  echo 'Source archive was not exported from the requested Git commit' >&2
  exit 65
}
RUN_ABSOLUTE="$(realpath -e "$SOURCE/$RUN_RELATIVE")"
[[ "$RUN_ABSOLUTE" == "$SOURCE/"* ]] || exit 64
[[ "$(jq -r '.sourceRun.directory' "$DECLARATION")" == "$RUN_RELATIVE" ]] || {
  echo "Requested run is not the hash-pinned published source run" >&2
  exit 65
}

finalize() {
  local status="$?"
  trap - EXIT
  date -u +%Y-%m-%dT%H:%M:%SZ > "$ATTEMPT/FINISHED"
  printf '%s\n' "$status" > "$ATTEMPT/exit-status.txt"
  if [[ -d "$OUTPUT" ]]; then
    find "$OUTPUT" -type f -print0 | sort -z | xargs -0 sha256sum \
      > "$ATTEMPT/render-artifacts.sha256"
  fi
  find "$ATTEMPT" -maxdepth 1 -type f ! -name attempt-files.sha256 -print0 \
    | sort -z | xargs -0 sha256sum > "$ATTEMPT/attempt-files.sha256"
  touch "$ATTEMPT/SAFE_TO_STOP"
  exit "$status"
}
trap finalize EXIT

date -u +%Y-%m-%dT%H:%M:%SZ > "$ATTEMPT/STARTED"
{
  printf 'run_id=%s\n' "$ATTEMPT_ID"
  printf 'run_class=%s\n' 'publication-interface-render'
  printf 'git_commit=%s\n' "$GIT_COMMIT"
  printf 'source_archive_sha256=%s\n' "$SOURCE_ARCHIVE_SHA256"
  printf 'source_run=%s\n' "$RUN_RELATIVE"
  printf 'result_class=%s\n' 'complete-frozen'
  printf 'replay_kind=%s\n' "$REPLAY_KIND"
  printf 'calculation_policy=%s\n' \
    "$([[ "$REPLAY_KIND" == checkpoint-review ]] && printf none || printf public-actions)"
  printf 'priority=%s\n' 'nice -n 10'
  printf 'publication_claim=%s\n' 'prediction only; no accepted/success claim'
} > "$ATTEMPT/provenance.env"
printf '%s\n' \
  "$BUN scripts/render-designer-moves-interface.mjs --run $RUN_RELATIVE --result-class complete-frozen --replay-kind $REPLAY_KIND --output $OUTPUT" \
  > "$ATTEMPT/command.txt"
nvidia-smi --query-gpu=name,driver_version --format=csv,noheader \
  > "$ATTEMPT/gpu.txt"
grep -Eq '^NVIDIA L4,' "$ATTEMPT/gpu.txt" || {
  echo 'Publication render requires the preflighted NVIDIA L4 lane' >&2
  exit 69
}
/usr/bin/google-chrome --version > "$ATTEMPT/chrome.txt"
ffmpeg -version | head -1 > "$ATTEMPT/ffmpeg.txt"
"$BUN" --version > "$ATTEMPT/bun.txt"

cd "$SOURCE"
PATH="$(dirname "$BUN"):$PATH" nice -n 10 "$BUN" install --frozen-lockfile \
  > "$ATTEMPT/bun-install.log" 2>&1
PATH="$(dirname "$BUN"):$PATH" CHROME_PATH="$CHROME_WRAPPER" \
  "$BUN" scripts/probe-headless-rendering.mjs \
  > "$ATTEMPT/hardware-rendering-probe.json" \
  2> "$ATTEMPT/hardware-rendering-probe.stderr.log"
jq -e '.softwareFallback == false
  and (((.renderer + " " + .vendor) | ascii_downcase) | contains("nvidia"))' \
  "$ATTEMPT/hardware-rendering-probe.json" > "$ATTEMPT/hardware-rendering-gate.log"

if [[ "$REPLAY_KIND" == executable ]]; then
  PATH="$(dirname "$BUN"):$PATH" CHROME_PATH="$CHROME_WRAPPER" \
    "$BUN" scripts/probe-headless-webgpu.mjs \
    > "$ATTEMPT/hardware-webgpu-probe.json" \
    2> "$ATTEMPT/hardware-webgpu-probe.stderr.log"
  jq -e '.isFallbackAdapter == false
    and .deviceLost == false
    and .maxStorageBuffersPerShaderStage >= 9' \
    "$ATTEMPT/hardware-webgpu-probe.json" > "$ATTEMPT/hardware-webgpu-gate.log"
else
  jq -n '{ required:false, status:"not-run",
    reason:"Checkpoint review imports exact full-system checkpoints and performs no calculation." }' \
    > "$ATTEMPT/hardware-webgpu-probe.json"
  : > "$ATTEMPT/hardware-webgpu-probe.stderr.log"
  jq -e '.required == false and .status == "not-run"' \
    "$ATTEMPT/hardware-webgpu-probe.json" > "$ATTEMPT/hardware-webgpu-gate.log"
fi

PATH="$(dirname "$BUN"):$PATH" "$BUN" \
  scripts/verify-sos1-frozen-browser-publication.mjs \
  > "$ATTEMPT/publication-preflight.log" 2>&1
PATH="$(dirname "$BUN"):$PATH" "$BUN" \
  scripts/render-designer-moves-interface.test.mjs \
  > "$ATTEMPT/renderer-preflight.log" 2>&1
PATH="$(dirname "$BUN"):$PATH" CHROME_PATH="$CHROME_WRAPPER" \
  nice -n 10 "$BUN" scripts/designer-movie-entry.browser.test.mjs \
  > "$ATTEMPT/blank-interface-preflight.log" 2>&1

PATH="$(dirname "$BUN"):$PATH" CHROME_PATH="$CHROME_WRAPPER" \
  nice -n 10 "$BUN" scripts/render-designer-moves-interface.mjs \
    --run "$RUN_RELATIVE" \
    --result-class complete-frozen \
    --replay-kind "$REPLAY_KIND" \
    --output "$OUTPUT" \
    > "$ATTEMPT/render.stdout.log" 2> "$ATTEMPT/render.stderr.log"

jq -e --arg replayKind "$REPLAY_KIND" '
  .complete == true
  and .replay.status == "completed"
  and .sourceRun.resultClass == "complete-frozen"
  and .sourceRun.replayKind == $replayKind
  and (.sourceRun.holdoutAccepted | type) == "boolean"
  and (has("acceptedRun") | not)
  and .presentation.initialInterface.viewerHintVisible == true
  and .presentation.initialInterface.moleculeInfoHidden == true
  and .presentation.initialInterface.sceneHidden == true
  and .presentation.completedInterface.previousEnabled == true
  and .presentation.completedInterface.cueCount == 0
  and .networkPolicy.runtimeMode == "local-lab"
  and .networkPolicy.runtimeLocalOnly == true
  and .video.width == 1600 and .video.height == 1000
  and .video.frames > 0 and .video.durationSeconds > 0
  and (if $replayKind == "checkpoint-review" then
    .sourceScript.calculationPolicy == "none"
    and .sourceScript.exactFullSystemCheckpoints == 4
  else true end)' "$OUTPUT/render-manifest.json" > "$ATTEMPT/render-gate.log"

nice -n 10 tar -czf "$ATTEMPT/$ATTEMPT_ID-artifacts.tar.gz" \
  -C "$ATTEMPT" "$(basename "$OUTPUT")" \
  provenance.env command.txt gpu.txt chrome.txt ffmpeg.txt bun.txt \
  hardware-rendering-probe.json hardware-rendering-probe.stderr.log \
  hardware-rendering-gate.log \
  hardware-webgpu-probe.json hardware-webgpu-gate.log \
  publication-preflight.log renderer-preflight.log blank-interface-preflight.log \
  render.stdout.log render.stderr.log render-gate.log
