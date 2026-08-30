#!/usr/bin/env bash
#SBATCH --job-name=molarium-7kpa-hbond
#SBATCH --comment=project:molarium,experiment:7kpa-manual-contact-recapture-v0.1
#SBATCH --partition=compute
#SBATCH --cpus-per-task=2
#SBATCH --mem=8G
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
readonly CHROME_VERSION=152.0.7977.64
readonly CHROME_URL=https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-headless-shell-linux64.zip

mkdir -p "${SOURCE}" "${RUNTIME}" "${OUTPUT}"
echo "${SOURCE_ARCHIVE_SHA256}  ${SOURCE_ARCHIVE}" | sha256sum --check
tar -xzf "${SOURCE_ARCHIVE}" -C "${SOURCE}"

if [[ ! -x "${RUNTIME}/bun-linux-x64/bun" ]]; then
  curl -fsSL "${BUN_URL}" -o "${RUNTIME}/bun.zip"
  unzip -q "${RUNTIME}/bun.zip" -d "${RUNTIME}"
fi
if [[ ! -x "${RUNTIME}/chrome-headless-shell-linux64/chrome-headless-shell" ]]; then
  curl -fsSL "${CHROME_URL}" -o "${RUNTIME}/chrome-headless-shell.zip"
  unzip -q "${RUNTIME}/chrome-headless-shell.zip" -d "${RUNTIME}"
fi

readonly BUN=${RUNTIME}/bun-linux-x64/bun
readonly CHROME=${RUNTIME}/chrome-headless-shell-linux64/chrome-headless-shell
readonly RESULT=${OUTPUT}/7kpa-manual-contact-recapture.v0.1.json
readonly RECEIPT=${OUTPUT}/receipt.json

"${BUN}" --version
"${CHROME}" --version
(
  cd "${SOURCE}"
  MOLARIUM_CHROME_PATH="${CHROME}" "${BUN}" \
    docking/benchmark/run-7kpa-two-terminus-panel.mjs \
    --manual-recapture --replays 2 --search-chains 8 --output "${RESULT}"
  "${BUN}" docking/benchmark/validate-7kpa-two-terminus-results.mjs \
    --manual-recapture --input "${RESULT}"
)

jq -n \
  --arg schema molarium.slurm-validation-receipt/v1 \
  --arg job_id "${SLURM_JOB_ID}" \
  --arg source_archive_sha256 "${SOURCE_ARCHIVE_SHA256}" \
  --arg result_sha256 "$(sha256sum "${RESULT}" | awk '{print $1}')" \
  --arg bun_version "${BUN_VERSION}" \
  --arg bun_sha256 "$(sha256sum "${RUNTIME}/bun.zip" | awk '{print $1}')" \
  --arg chrome_version "${CHROME_VERSION}" \
  --arg chrome_sha256 "$(sha256sum "${RUNTIME}/chrome-headless-shell.zip" | awk '{print $1}')" \
  '{schema:$schema,job_id:$job_id,source_archive_sha256:$source_archive_sha256,
    result_sha256:$result_sha256,bun:{version:$bun_version,archive_sha256:$bun_sha256},
    chrome:{version:$chrome_version,archive_sha256:$chrome_sha256},
    panel:"molarium-7kpa-d84-manual-contact-recapture",replays:2,search_chains:8}' \
  > "${RECEIPT}"
sha256sum "${RESULT}" "${RECEIPT}"
