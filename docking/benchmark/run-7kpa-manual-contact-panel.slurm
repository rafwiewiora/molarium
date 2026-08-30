#!/usr/bin/env bash
#SBATCH --job-name=molarium-7kpa-hbond
#SBATCH --comment=project:molarium,experiment:7kpa-manual-contact-recapture-v0.1
#SBATCH --partition=compute
#SBATCH --cpus-per-task=2
#SBATCH --mem=7G
#SBATCH --nice=10000
#SBATCH --time=02:00:00
#SBATCH --output=slurm-%x-%j.out
#SBATCH --error=slurm-%x-%j.err

set -Eeuo pipefail

readonly ROOT=${MOLARIUM_JOB_ROOT:?MOLARIUM_JOB_ROOT is required}
readonly SOURCE_ARCHIVE=${ROOT}/input/molarium-source.tar.gz
readonly SOURCE_ARCHIVE_SHA256=${MOLARIUM_SOURCE_ARCHIVE_SHA256:?MOLARIUM_SOURCE_ARCHIVE_SHA256 is required}
readonly SOURCE=${ROOT}/source
readonly RUNTIME=${ROOT}/runtime
readonly OUTPUT=${ROOT}/output
readonly BUN_VERSION=1.3.14
readonly BUN_URL=https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip
readonly PLAYWRIGHT_IMAGE_TAG=v1.55.0-noble
readonly PLAYWRIGHT_IMAGE=${RUNTIME}/playwright-${PLAYWRIGHT_IMAGE_TAG}.sif

mkdir -p "${SOURCE}" "${RUNTIME}" "${OUTPUT}"
echo "${SOURCE_ARCHIVE_SHA256}  ${SOURCE_ARCHIVE}" | sha256sum --check
tar -xzf "${SOURCE_ARCHIVE}" -C "${SOURCE}"

if [[ ! -x "${RUNTIME}/bun-linux-x64/bun" ]]; then
  curl -fsSL "${BUN_URL}" -o "${RUNTIME}/bun.zip"
  unzip -q "${RUNTIME}/bun.zip" -d "${RUNTIME}"
fi
if [[ ! -s "${PLAYWRIGHT_IMAGE}" ]]; then
  mkdir -p "${RUNTIME}/singularity-cache"
  SINGULARITY_CACHEDIR=${RUNTIME}/singularity-cache singularity pull \
    "${PLAYWRIGHT_IMAGE}.partial" "docker://mcr.microsoft.com/playwright:${PLAYWRIGHT_IMAGE_TAG}"
  mv "${PLAYWRIGHT_IMAGE}.partial" "${PLAYWRIGHT_IMAGE}"
fi

readonly BUN=${RUNTIME}/bun-linux-x64/bun
readonly RESULT=${OUTPUT}/7kpa-manual-contact-recapture.v0.1.json
readonly RECEIPT=${OUTPUT}/receipt.json
CHROME=$(singularity exec "${PLAYWRIGHT_IMAGE}" sh -lc \
  "find /ms-playwright -type f -name chrome -path '*chrome-linux*' | sort | head -1")
readonly CHROME
[[ -n "${CHROME}" ]] && singularity exec "${PLAYWRIGHT_IMAGE}" test -x "${CHROME}" \
  || { echo "Playwright Chromium executable was not found" >&2; exit 127; }

"${BUN}" --version
singularity exec "${PLAYWRIGHT_IMAGE}" "${CHROME}" --version
(
  cd "${SOURCE}"
  singularity exec --bind "${ROOT}:${ROOT}" "${PLAYWRIGHT_IMAGE}" \
    env PATH="${RUNTIME}/bun-linux-x64:${PATH}" \
    MOLARIUM_CHROME_PATH="${CHROME}" "${BUN}" \
    docking/benchmark/run-7kpa-two-terminus-panel.mjs \
    --manual-recapture --replays 2 --search-chains 8 --output "${RESULT}"
  singularity exec --bind "${ROOT}:${ROOT}" "${PLAYWRIGHT_IMAGE}" "${BUN}" \
    docking/benchmark/validate-7kpa-two-terminus-results.mjs \
    --manual-recapture --input "${RESULT}"
)

jq -n \
  --arg schema molarium.slurm-validation-receipt/v1 \
  --arg job_id "${SLURM_JOB_ID}" \
  --arg source_archive_sha256 "${SOURCE_ARCHIVE_SHA256}" \
  --arg result_sha256 "$(sha256sum "${RESULT}" | awk '{print $1}')" \
  --arg bun_version "${BUN_VERSION}" \
  --arg bun_sha256 "$(sha256sum "${RUNTIME}/bun.zip" | awk '{print $1}')" \
  --arg playwright_image_tag "${PLAYWRIGHT_IMAGE_TAG}" \
  --arg playwright_image_sha256 "$(sha256sum "${PLAYWRIGHT_IMAGE}" | awk '{print $1}')" \
  '{schema:$schema,job_id:$job_id,source_archive_sha256:$source_archive_sha256,
    result_sha256:$result_sha256,bun:{version:$bun_version,archive_sha256:$bun_sha256},
    browser:{playwright_image_tag:$playwright_image_tag,
      singularity_image_sha256:$playwright_image_sha256},
    panel:"molarium-7kpa-d84-manual-contact-recapture",replays:2,search_chains:8}' \
  > "${RECEIPT}"
sha256sum "${RESULT}" "${RECEIPT}"
